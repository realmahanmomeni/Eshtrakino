import type { SupplierProductMapping } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { env } from "../../../config/env";
import {
  type PurchaseResult,
  type SupplierAdapter,
  type SupplierProduct,
  type SupplierPurchaseContext,
  type ValidationResult,
  SupplierAuthenticationError,
  SupplierInsufficientBalanceError,
  SupplierInvalidResponseError,
  SupplierNetworkError,
  SupplierOutOfStockError,
  SupplierProductNotFoundError,
  SupplierPurchaseUncertainError,
  SupplierRateLimitError,
  SupplierUnknownError,
} from "../SupplierAdapter";
import { acquireCanbosoReadSlot } from "../canboso/canbosoReadLimiter";
import {
  applyCanbosoAuthFailurePause,
  applyCanbosoRateLimitCooldown,
  getCanbosoBlockedUntilMs,
  getCanbosoPenaltyLevel,
  isCanbosoApiRefreshAllowed,
} from "../canboso/canbosoCooldownState";
import { logCanbosoHttpRequest } from "../canboso/canbosoRequestLog";
import { serializeCanbosoDeliveryPayload } from "../../fulfillment/canbosoDeliveryFormat";

export type CanbosoBalance = {
  balance: number;
  currency?: string;
  raw: unknown;
};

/**
 * Normalized row from GET /api/v2/telegram-buyer/products
 *
 * Observed / supported JSON fields on each product item:
 * - id, product_id, productId — supplier product identifier (string or number)
 * - name, title, product_name — display label
 * - stock, stock_count, inventory_count, count, qty, quantity — numeric stock
 * - is_active, isActive, active, available, is_available, in_stock, inStock — availability flags
 * - price — number or { amount, currency, text } (USD when currency is USD or text contains $)
 * - availability — { available, sold } (stock / active derived from available)
 * - supplier_price, supplierPrice, cost, price_toman, priceToman — legacy supplier cost fields
 * - variants, plans, options, skus — nested purchasable plans (each mapped to a local Product)
 * - required_fields, requiredFields, custom_fields, input_fields — checkout inputs (email, etc.)
 *
 * Response wrappers: { data: { products: [] } }, { data: [] }, { products: [] }, { items: [] }
 */
export type CanbosoCatalogProduct = {
  /** Purchasable SKU id sent to POST /purchase as product_id */
  productId: string;
  /** Parent brand/product id when API uses variants[] */
  parentProductId?: string;
  /** Variant/plan id when API uses variant_id on purchase */
  variantId?: string;
  /** Brand/service title (parent product name) */
  brandName?: string;
  name: string;
  stock: number;
  isAvailable: boolean;
  supplierPriceToman: number;
  /** Normalized supplier cost in USD (from price_usd / cost / Toman conversion). */
  supplierCostUsd: number;
  /** Supplier-facing details (white-labeled before customer display). */
  description?: string;
  requiredFields: string[];
  raw: unknown;
};

export type CanbosoPurchaseOptions = {
  mapping?: SupplierProductMapping;
  context?: SupplierPurchaseContext;
};

const DEFAULT_BASE_URL = "https://canboso.com";

/** Shown to callers while Canboso cooldown circuit breaker is open */
export const CANBOSO_RATE_LIMIT_COOLDOWN_MESSAGE =
  "⚠️ سرویس در حال خنک‌سازی است. لطفاً چند لحظه دیگر تلاش کنید.";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pickNumber(...values: unknown[]): number | undefined {
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v.replace(/,/g, "").trim());
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

function pickBool(...values: unknown[]): boolean | undefined {
  for (const v of values) {
    if (typeof v === "boolean") return v;
    if (v === 1 || v === "1" || v === "true" || v === "yes") return true;
    if (v === 0 || v === "0" || v === "false" || v === "no") return false;
  }
  return undefined;
}

function pickString(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === "string" && v.trim() !== "") return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return undefined;
}

function extractProductList(body: unknown): unknown[] {
  const root = asRecord(body);
  if (!root) return Array.isArray(body) ? body : [];

  const data = asRecord(root.data) ?? root;
  const nestedData = asRecord(data.data);

  const candidates = [
    data.products,
    data.items,
    data.list,
    nestedData?.products,
    nestedData?.items,
    root.products,
    root.items,
    data,
  ];

  for (const c of candidates) {
    if (Array.isArray(c)) return c;
    if (c && typeof c === "object" && !Array.isArray(c)) {
      return Object.values(c as Record<string, unknown>);
    }
  }

  return [];
}

function resolveStockAndAvailability(row: Record<string, unknown>): {
  stock: number;
  isAvailable: boolean;
} {
  const availability = asRecord(row.availability);
  const availableCount =
    pickNumber(
      availability?.available,
      row.stock,
      row.stock_count,
      row.inventory_count,
      row.count,
      row.qty,
      row.quantity,
    ) ?? 0;

  const stock = Math.max(0, Math.round(availableCount));
  const isAvailable = stock > 0;

  if (availability?.available != null || row.stock != null || row.stock_count != null) {
    return { stock, isAvailable };
  }

  const isActiveFlag = pickBool(row.is_active, row.isActive, row.active);
  const availableFlag = pickBool(
    row.available,
    row.is_available,
    row.isAvailable,
    row.in_stock,
    row.inStock,
  );

  if (isActiveFlag === true || availableFlag === true) {
    return { stock: Math.max(stock, 1), isAvailable: true };
  }
  if (isActiveFlag === false || availableFlag === false) {
    return { stock: 0, isAvailable: false };
  }

  return { stock, isAvailable: stock > 0 };
}

function extractRequiredFieldNames(row: Record<string, unknown>): string[] {
  const raw =
    row.required_fields ??
    row.requiredFields ??
    row.custom_fields ??
    row.customFields ??
    row.input_fields ??
    row.inputFields ??
    row.user_inputs;

  if (!Array.isArray(raw)) return [];

  const labels: string[] = [];
  for (const entry of raw) {
    if (typeof entry === "string" && entry.trim()) {
      labels.push(entry.trim());
      continue;
    }
    const rec = asRecord(entry);
    if (!rec) continue;
    const label = pickString(
      rec.label,
      rec.name,
      rec.key,
      rec.field,
      rec.title,
      rec.slug,
    );
    if (label) labels.push(label);
  }
  return [...new Set(labels)];
}

function priceObjectLooksUsd(priceObj: Record<string, unknown>, amount: number): boolean {
  const currency = pickString(priceObj.currency)?.toUpperCase();
  const text = pickString(priceObj.text) ?? "";
  if (currency === "USD") return true;
  if (text.includes("$")) return true;
  if (currency && (currency.includes("IRT") || currency.includes("TOMAN") || currency === "IRR")) {
    return false;
  }
  return amount > 0 && amount < 2_000;
}

/** Maps API price fields → USD cost. Logs-friendly when keys missing. */
export function extractSupplierCostUsdFromRow(
  row: Record<string, unknown>,
  usdRateIrt: number,
): { costUsd: number; priceKey: string | null } {
  const priceRaw = row.price;
  if (priceRaw !== null && typeof priceRaw === "object" && !Array.isArray(priceRaw)) {
    const priceObj = priceRaw as Record<string, unknown>;
    const amount = pickNumber(priceObj.amount, priceObj.value);
    if (amount != null && amount > 0) {
      if (priceObjectLooksUsd(priceObj, amount)) {
        return {
          costUsd: Math.round(amount * 10_000) / 10_000,
          priceKey: "price.amount (USD)",
        };
      }
      if (amount > 50_000) {
        const usd = Math.round((amount / usdRateIrt) * 10_000) / 10_000;
        return { costUsd: usd, priceKey: "price.amount (toman→usd)" };
      }
      return {
        costUsd: Math.round(amount * 10_000) / 10_000,
        priceKey: "price.amount",
      };
    }
  }

  if (typeof priceRaw === "number" && Number.isFinite(priceRaw) && priceRaw > 0) {
    if (priceRaw < 2_000) {
      return {
        costUsd: Math.round(priceRaw * 10_000) / 10_000,
        priceKey: "price (number USD)",
      };
    }
    const usd = Math.round((priceRaw / usdRateIrt) * 10_000) / 10_000;
    return { costUsd: usd, priceKey: "price (number toman→usd)" };
  }

  const usdDirect = pickNumber(
    row.price_usd,
    row.usd_price,
    row.priceUsd,
    row.usdPrice,
    row.selling_price_usd,
    row.cost_usd,
    row.costUsd,
    row.cost,
  );
  if (usdDirect != null && usdDirect > 0 && usdDirect < 2_000) {
    return { costUsd: Math.round(usdDirect * 10_000) / 10_000, priceKey: "price_usd/usd_price/cost" };
  }

  const rateUsd = pickNumber(row.rate, row.unit_price, row.selling_price);
  if (rateUsd != null && rateUsd > 0 && rateUsd < 2_000) {
    return { costUsd: Math.round(rateUsd * 10_000) / 10_000, priceKey: "rate/selling_price" };
  }

  const toman = pickNumber(
    row.supplier_price,
    row.supplierPrice,
    row.price_toman,
    row.priceToman,
  );
  if (toman != null && toman > 0) {
    if (toman > 50_000) {
      const usd = Math.round((toman / usdRateIrt) * 10_000) / 10_000;
      return { costUsd: usd, priceKey: "price (toman→usd)" };
    }
    return { costUsd: Math.round(toman * 100) / 100, priceKey: "price (usd-scale)" };
  }

  return { costUsd: 0, priceKey: null };
}

function mapCanbosoProductRow(
  row: Record<string, unknown>,
  overrides?: Partial<CanbosoCatalogProduct>,
  usdRateIrt = 120_000,
): CanbosoCatalogProduct | null {
  const productId =
    pickString(row.product_id, row.productId, row.id, row.key, row.slug, row.sku) ?? "";
  if (!productId) return null;
  const name =
    pickString(row.name, row.title, row.product_name, row.plan_name, row.label) ??
    productId;

  const { stock, isAvailable } = resolveStockAndAvailability(row);

  const priceObj = asRecord(row.price);
  const supplierPriceToman =
    pickNumber(
      row.supplier_price,
      row.supplierPrice,
      row.price_toman,
      row.priceToman,
      priceObj?.amount,
      typeof row.price === "number" ? row.price : undefined,
      row.cost,
    ) ?? 0;

  const { costUsd } = extractSupplierCostUsdFromRow(row, usdRateIrt);

  const requiredFields = extractRequiredFieldNames(row);
  const mergedRequired = overrides?.requiredFields?.length
    ? [...new Set([...overrides.requiredFields, ...requiredFields])]
    : requiredFields;

  const description = pickString(
    row.description,
    row.details,
    row.info,
    row.product_description,
    row.productDescription,
    row.about,
  );

  return {
    productId: overrides?.productId ?? productId,
    parentProductId: overrides?.parentProductId,
    variantId: overrides?.variantId ?? pickString(row.variant_id, row.variantId),
    brandName: overrides?.brandName,
    name: overrides?.name ?? name,
    stock: overrides?.stock ?? stock,
    isAvailable: overrides?.isAvailable ?? isAvailable,
    supplierPriceToman: overrides?.supplierPriceToman ?? Math.round(supplierPriceToman),
    supplierCostUsd: overrides?.supplierCostUsd ?? costUsd,
    description: overrides?.description ?? description,
    requiredFields: mergedRequired,
    raw: row,
  };
}

function mapCanbosoProduct(raw: unknown): CanbosoCatalogProduct | null {
  const row = asRecord(raw);
  if (!row) return null;
  const mapped = mapCanbosoProductRow(row);
  if (!mapped) return null;
  const parentId = mapped.productId;
  return {
    ...mapped,
    brandName: mapped.brandName ?? mapped.name,
    parentProductId: mapped.parentProductId ?? parentId,
  };
}

function mapCanbosoVariantRow(
  parentRow: Record<string, unknown>,
  parentId: string,
  parentName: string,
  parentRequired: string[],
  variantRaw: unknown,
): CanbosoCatalogProduct | null {
  const variant = asRecord(variantRaw);
  if (!variant) return null;

  const variantId =
    pickString(variant.variant_id, variant.variantId, variant.id, variant.key, variant.sku) ??
    pickString(variant.product_id, variant.productId);

  const purchasableId =
    pickString(variant.product_id, variant.productId, variant.id, variant.key, variant.sku) ??
    (variantId ? `${parentId}:${variantId}` : "");

  if (!purchasableId) return null;

  const variantName =
    pickString(variant.name, variant.title, variant.label, variant.plan_name) ??
    variantId ??
    purchasableId;

  const displayName =
    variantName.toLowerCase().includes(parentName.toLowerCase().slice(0, 8))
      ? variantName
      : `${parentName} — ${variantName}`;

  const merged = mapCanbosoProductRow(variant, {
    productId: purchasableId,
    parentProductId: parentId,
    variantId: variantId ?? purchasableId,
    brandName: parentName,
    name: displayName,
    requiredFields: [
      ...parentRequired,
      ...extractRequiredFieldNames(variant),
    ],
  });

  return merged;
}

/** Flatten API products with optional nested variants/plans into purchasable SKUs. */
export function expandCanbosoCatalogEntries(items: unknown[]): CanbosoCatalogProduct[] {
  const out: CanbosoCatalogProduct[] = [];

  for (const item of items) {
    const row = asRecord(item);
    if (!row) continue;

    const parentId =
      pickString(row.product_id, row.productId, row.id, row.key, row.slug) ?? "";
    const parentName =
      pickString(row.name, row.title, row.product_name) ?? parentId;
    const parentRequired = extractRequiredFieldNames(row);

    const nested = row.variants ?? row.plans ?? row.options ?? row.skus ?? row.items;
    if (Array.isArray(nested) && nested.length > 0) {
      for (const variantRaw of nested) {
        const mapped = mapCanbosoVariantRow(
          row,
          parentId,
          parentName,
          parentRequired,
          variantRaw,
        );
        if (mapped) out.push(mapped);
      }
      continue;
    }

    const single = mapCanbosoProduct(item);
    if (single) out.push(single);
  }

  return out;
}

/** Canboso requires `Idempotency-Key` header length 8–128 on POST /purchase. */
export const CANBOSO_IDEMPOTENCY_KEY_MIN_LEN = 8;
export const CANBOSO_IDEMPOTENCY_KEY_MAX_LEN = 128;

/** Fresh idempotency key per HTTP POST (16–64 chars typical; always within 8–128). */
export function buildCanbosoPurchaseIdempotencyKey(
  internalInvoiceId?: number,
  nowMs = Date.now(),
): string {
  const invPart = internalInvoiceId != null ? String(internalInvoiceId) : "0";
  const nonce = randomUUID().slice(0, 8);
  let key = `eshtrakino-inv-${invPart}-${nowMs}-${nonce}`;
  if (key.length > CANBOSO_IDEMPOTENCY_KEY_MAX_LEN) {
    key = key.slice(0, CANBOSO_IDEMPOTENCY_KEY_MAX_LEN);
  }
  while (key.length < CANBOSO_IDEMPOTENCY_KEY_MIN_LEN) {
    key = `${key}x`;
  }
  return key;
}

/** Unique Canboso order identifiers per purchase attempt (avoids duplicate client_order_id / order_id). */
export function buildCanbosoUniquePurchaseIds(
  internalInvoiceId: number,
  nowMs = Date.now(),
): { clientOrderId: string; orderId: number } {
  const attemptSuffix = Math.floor(nowMs / 1000) % 10_000;
  const orderId = Number(`${internalInvoiceId}${attemptSuffix}`);
  return {
    clientOrderId: `${internalInvoiceId}_${nowMs}`,
    orderId: Number.isFinite(orderId) ? orderId : nowMs,
  };
}

export function extractCanbosoHttpErrorMessage(
  body: unknown,
  rawText: string,
  status: number,
): string {
  const root = asRecord(body);
  const data = asRecord(root?.data);
  return (
    pickString(
      root?.message,
      root?.error,
      root?.detail,
      data?.message,
      data?.error,
      data?.detail,
    ) ??
    (rawText.trim() || `HTTP ${status}`)
  );
}

function isCanbosoPurchase400PayloadRetryable(message: string, rawText: string): boolean {
  const hay = `${message} ${rawText}`.toLowerCase();
  if (/balance|insufficient|موجودی|stock|موجود|out of stock/i.test(hay)) {
    return false;
  }
  if (/^http 400$/i.test(message.trim()) || !message.trim()) {
    return true;
  }
  return /order_id|client_order|duplicate|already exists|already been|previously/i.test(hay) ||
    /invalid|validation|parameter|unexpected|required field|malformed|format|unrecognized/i.test(hay);
}

function buildCanbosoCustomFields(
  context?: SupplierPurchaseContext,
): Record<string, string> | undefined {
  const data = context?.userInputData;
  if (!data || typeof data !== "object") return undefined;
  const entries = Object.entries(data).filter(
    ([, v]) => typeof v === "string" && v.trim() !== "",
  );
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}

/** Exact POST body for `/api/v2/telegram-buyer/purchase` (used by adapter + dry-run diagnostics). */
export function buildCanbosoPurchasePayload(
  mapping: SupplierProductMapping,
  context?: SupplierPurchaseContext,
): Record<string, unknown> {
  const productId = mapping.supplierProductKey;
  const payload: Record<string, unknown> = {
    product_id: productId,
    quantity: 1,
  };

  if (mapping.supplierVariantKey) {
    payload.variant_id = mapping.supplierVariantKey;
  }

  const customFields = buildCanbosoCustomFields(context);
  if (customFields) {
    payload.custom_fields = customFields;
  }

  if (context?.internalInvoiceId != null) {
    const { clientOrderId, orderId } = buildCanbosoUniquePurchaseIds(
      context.internalInvoiceId,
    );
    payload.client_order_id = clientOrderId;
    payload.order_id = orderId;
  }

  return payload;
}

/** Minimal POST bodies tried when the full schema returns HTTP 400 for parameter / order_id issues. */
export function buildCanbosoPurchaseFallbackPayloads(
  mapping: SupplierProductMapping,
  context?: SupplierPurchaseContext,
): Record<string, unknown>[] {
  const productId = mapping.supplierProductKey;
  if (!productId) return [];

  const nowMs = Date.now();
  const clientOrderId =
    context?.internalInvoiceId != null
      ? buildCanbosoUniquePurchaseIds(context.internalInvoiceId, nowMs + 1)
          .clientOrderId
      : `esht_${nowMs}`;

  const withClient: Record<string, unknown> = {
    product_id: productId,
    quantity: 1,
    client_order_id: clientOrderId,
  };
  const minimal: Record<string, unknown> = {
    product_id: productId,
    quantity: 1,
  };

  if (mapping.supplierVariantKey) {
    withClient.variant_id = mapping.supplierVariantKey;
    minimal.variant_id = mapping.supplierVariantKey;
  }

  return [withClient, minimal];
}

function logCanbosoPurchaseFailure(
  status: number,
  body: unknown,
  message: string,
  rawText?: string,
): void {
  if (rawText != null && rawText !== "") {
    console.error("[CanbosoHTTP Error Body]", rawText);
  }
  console.error(
    "[CanbosoAdapter] Purchase failed",
    JSON.stringify(
      {
        status,
        message,
        body: body ?? (rawText ? rawText : null),
      },
      null,
      2,
    ),
  );
}

/** Normalizes Canboso purchase JSON into `PurchaseResult` (used by adapter + dry-run diagnostics). */
export function parseCanbosoPurchaseResult(body: unknown): PurchaseResult {
  const root = asRecord(body);
  if (root && root.success === false) {
    const msg = pickString(root.message, root.error) ?? "Canboso purchase rejected.";
    throw new SupplierUnknownError(msg);
  }

  const data = asRecord(root?.data) ?? root;
  const order = asRecord(root?.order) ?? asRecord(data?.order);
  const payment = asRecord(root?.payment) ?? asRecord(data?.payment);

  const supplierOrderId =
    pickString(
      order?.orderCode,
      order?.orderId,
      order?.id,
      data?.order_id,
      data?.orderId,
      data?.purchase_id,
      data?.purchaseId,
      data?.id,
      data?.client_order_id,
    ) ?? `canboso-${Date.now()}`;

  const costAmount =
    pickNumber(
      payment?.amount,
      payment?.originalAmount,
      data?.cost,
      data?.price,
      data?.amount,
      data?.total,
    ) ?? 0;

  const statusRaw = pickString(order?.status, data?.status, root?.status)?.toLowerCase();
  const isProcessing =
    statusRaw === "processing" ||
    statusRaw === "pending" ||
    statusRaw === "queued" ||
    statusRaw === "in_progress";

  const deliveryPayload = isProcessing
    ? JSON.stringify({
        status: statusRaw ?? "processing",
        supplierOrderId,
        message:
          pickString(data?.message, root?.message) ??
          "سفارش در حال پردازش توسط تامین‌کننده است.",
      })
    : serializeCanbosoDeliveryPayload(body);

  return {
    supplierOrderId,
    costAmount,
    deliveryPayload,
    isProcessing,
    status: statusRaw,
  };
}

function parseRetryAfterSeconds(response: Response): number {
  const raw =
    response.headers.get("retry-after") ??
    response.headers.get("Retry-After") ??
    "60";
  const seconds = parseInt(String(raw).trim(), 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 60;
}

function parsePenaltyLevel(response: Response): string {
  return (
    response.headers.get("x-ratelimit-penalty-level") ??
    response.headers.get("X-RateLimit-Penalty-Level") ??
    "unknown"
  );
}

async function applyRateLimitCooldown(response: Response): Promise<void> {
  const retryAfterSeconds = parseRetryAfterSeconds(response);
  const penaltyLevel = parsePenaltyLevel(response);
  const scope =
    response.headers.get("x-ratelimit-scope") ??
    response.headers.get("X-RateLimit-Scope");

  const levelNum = parseInt(penaltyLevel, 10);
  await applyCanbosoRateLimitCooldown(
    retryAfterSeconds,
    Number.isFinite(levelNum) ? levelNum : undefined,
  );

  console.error(
    `[CanbosoAdapter] Rate limit exceeded! Cooldown active for ${retryAfterSeconds}s (Level: ${penaltyLevel}${scope ? `, Scope: ${scope}` : ""}).`,
  );
}

function isCanbosoReadEndpoint(endpoint: string, method: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  return (
    endpoint.includes("/products") ||
    endpoint.includes("/balance") ||
    endpoint.includes("/orders")
  );
}

export class CanbosoAdapter implements SupplierAdapter {
  readonly name = "Canboso";

  constructor(
    private readonly baseUrl = env.CANBOSO_BASE_URL || DEFAULT_BASE_URL,
  ) {}

  /** Remaining cooldown ms (0 if requests may proceed). */
  getRateLimitCooldownRemainingMs(): number {
    return Math.max(0, getCanbosoBlockedUntilMs() - Date.now());
  }

  getCurrentPenaltyLevel(): number {
    return getCanbosoPenaltyLevel();
  }

  resolveApiKey(apiKey?: string): string {
    const key = (apiKey ?? env.CANBOSO_API_KEY ?? "").trim();
    if (!key) {
      throw new SupplierAuthenticationError("CANBOSO_API_KEY is not configured.");
    }
    return key;
  }

  private async fetchApi(
    endpoint: string,
    apiKey: string,
    options: RequestInit = {},
    meta?: { logReason?: string },
  ): Promise<Response> {
    const headers = new Headers(options.headers ?? {});
    headers.set("X-API-Key", apiKey);
    headers.set("Authorization", `Bearer ${apiKey}`);
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (!headers.has("Accept")) {
      headers.set("Accept", "application/json");
    }
    const method = (options.method ?? "GET").toUpperCase();

    try {
      if (!isCanbosoApiRefreshAllowed()) {
        logCanbosoHttpRequest(endpoint, "skipped", meta?.logReason ?? "cooldown");
        throw new SupplierRateLimitError(CANBOSO_RATE_LIMIT_COOLDOWN_MESSAGE);
      }

      if (isCanbosoReadEndpoint(endpoint, method)) {
        await acquireCanbosoReadSlot();
      }

      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers,
      });

      logCanbosoHttpRequest(
        endpoint,
        response.status,
        meta?.logReason ?? method.toLowerCase(),
      );

      if (response.status === 401 || response.status === 403) {
        await applyCanbosoAuthFailurePause(`HTTP ${response.status}`);
        throw new SupplierAuthenticationError("Canboso API key rejected.");
      }
      if (response.status === 429) {
        await applyRateLimitCooldown(response);
        throw new SupplierRateLimitError(CANBOSO_RATE_LIMIT_COOLDOWN_MESSAGE);
      }
      if (response.status === 409) {
        throw new SupplierOutOfStockError("Canboso product out of stock.");
      }
      if (response.status === 402 || response.status === 400) {
        const peek = response.clone();
        const text = await peek.text().catch(() => "");
        if (/balance|insufficient|موجودی/i.test(text)) {
          let balanceMsg = text.trim();
          if (balanceMsg) {
            try {
              const parsed: unknown = JSON.parse(text);
              balanceMsg = extractCanbosoHttpErrorMessage(parsed, text, response.status);
            } catch {
              /* use raw text */
            }
          }
          throw new SupplierInsufficientBalanceError(
            balanceMsg || "Insufficient Canboso wallet balance.",
          );
        }
      }
      if (response.status >= 500) {
        throw new SupplierNetworkError(`Canboso server error: HTTP ${response.status}`);
      }

      return response;
    } catch (error: unknown) {
      if (error instanceof SupplierAuthenticationError ||
          error instanceof SupplierRateLimitError ||
          error instanceof SupplierNetworkError ||
          error instanceof SupplierOutOfStockError ||
          error instanceof SupplierInsufficientBalanceError) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw error;
      }
      const msg = error instanceof Error ? error.message : String(error);
      throw new SupplierNetworkError(`Canboso network error: ${msg}`);
    }
  }

  /** Low-level GET /products (single HTTP). Prefer getCanbosoBulkCatalog for shared cache. */
  async fetchProductsFromApi(logReason = "products"): Promise<CanbosoCatalogProduct[]> {
    const key = this.resolveApiKey();
    const response = await this.fetchApi(
      "/api/v2/telegram-buyer/products",
      key,
      {},
      { logReason },
    );
    if (!response.ok) {
      throw new SupplierInvalidResponseError(
        `Canboso products failed: HTTP ${response.status}`,
      );
    }
    const body: unknown = await response.json().catch(() => null);
    const mapped = expandCanbosoCatalogEntries(extractProductList(body));

    if (mapped.length > 0 && mapped.every((p) => !p.isAvailable && p.stock <= 0)) {
      console.warn(
        "[CanbosoAdapter] All products parsed as unavailable — check API field mapping.",
      );
    }

    return mapped;
  }

  async getBalance(apiKey?: string): Promise<CanbosoBalance> {
    const key = this.resolveApiKey(apiKey);
    const response = await this.fetchApi(
      "/api/v2/telegram-buyer/balance",
      key,
      {},
      { logReason: "balance" },
    );
    if (!response.ok) {
      throw new SupplierInvalidResponseError(
        `Canboso balance failed: HTTP ${response.status}`,
      );
    }
    const body: unknown = await response.json().catch(() => null);
    const root = asRecord(body);
    const data = asRecord(root?.data) ?? root;
    const balance =
      pickNumber(data?.balance, data?.wallet_balance, data?.amount, root?.balance) ?? 0;
    const currency = pickString(data?.currency, root?.currency);
    return { balance, currency, raw: body };
  }

  async getProducts(_apiKey?: string): Promise<CanbosoCatalogProduct[]> {
    const { getCanbosoBulkCatalog } = await import("../canboso/canbosoBulkCatalog.js");
    const snap = await getCanbosoBulkCatalog({ reason: "adapter.getProducts" });
    return snap.remoteProducts;
  }

  private async postCanbosoPurchase(
    apiKey: string,
    payload: Record<string, unknown>,
    signal: AbortSignal,
    internalInvoiceId?: number,
  ): Promise<{
    response: Response;
    rawText: string;
    body: unknown;
    message: string;
  }> {
    const idempotencyKey = buildCanbosoPurchaseIdempotencyKey(internalInvoiceId);
    const response = await this.fetchApi(
      "/api/v2/telegram-buyer/purchase",
      apiKey,
      {
        method: "POST",
        headers: {
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(payload),
        signal,
      },
      { logReason: "purchase" },
    );

    const rawText = await response.text().catch(() => "");
    let body: unknown = null;
    try {
      body = rawText ? JSON.parse(rawText) : null;
    } catch {
      body = rawText || null;
    }

    const message = extractCanbosoHttpErrorMessage(body, rawText, response.status);
    return { response, rawText, body, message };
  }

  private throwCanbosoPurchaseHttpError(
    status: number,
    body: unknown,
    message: string,
    rawText: string,
  ): never {
    logCanbosoPurchaseFailure(status, body, message, rawText);
    if (/stock|موجود|out of stock/i.test(message)) {
      throw new SupplierOutOfStockError(message);
    }
    if (/balance|insufficient|موجودی/i.test(message)) {
      throw new SupplierInsufficientBalanceError(message);
    }
    throw new SupplierUnknownError(message);
  }

  async purchaseProduct(
    productId: string,
    apiKey?: string,
    options?: CanbosoPurchaseOptions,
  ): Promise<PurchaseResult> {
    const key = this.resolveApiKey(apiKey);
    const mapping =
      options?.mapping ??
      ({
        supplierProductKey: productId,
        supplierVariantKey: null,
      } as SupplierProductMapping);

    const primaryPayload = buildCanbosoPurchasePayload(mapping, options?.context);
    if (!primaryPayload.product_id) {
      primaryPayload.product_id = productId;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);

    try {
      const payloadsToTry: Record<string, unknown>[] = [primaryPayload];
      const seenPayloads = new Set<string>();

      const enqueuePayload = (payload: Record<string, unknown>) => {
        const key = JSON.stringify(payload);
        if (seenPayloads.has(key)) return;
        seenPayloads.add(key);
        payloadsToTry.push(payload);
      };

      let lastAttempt: Awaited<ReturnType<CanbosoAdapter["postCanbosoPurchase"]>> | null =
        null;

      for (const payload of payloadsToTry) {
        lastAttempt = await this.postCanbosoPurchase(
          key,
          payload,
          controller.signal,
          options?.context?.internalInvoiceId,
        );

        if (lastAttempt.response.ok) {
          return parseCanbosoPurchaseResult(lastAttempt.body);
        }

        const { response, body, message, rawText } = lastAttempt;

        if (
          response.status === 400 &&
          isCanbosoPurchase400PayloadRetryable(message, rawText)
        ) {
          for (const fallback of buildCanbosoPurchaseFallbackPayloads(
            mapping,
            options?.context,
          )) {
            enqueuePayload(fallback);
          }
          continue;
        }

        this.throwCanbosoPurchaseHttpError(response.status, body, message, rawText);
      }

      if (lastAttempt && !lastAttempt.response.ok) {
        this.throwCanbosoPurchaseHttpError(
          lastAttempt.response.status,
          lastAttempt.body,
          lastAttempt.message,
          lastAttempt.rawText,
        );
      }

      throw new SupplierUnknownError("Canboso purchase failed without a response.");
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new SupplierPurchaseUncertainError(
          "Canboso purchase timed out; status uncertain.",
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async validateKey(apiKey: string): Promise<ValidationResult> {
    try {
      const bal = await this.getBalance(apiKey);
      return { isValid: true, balance: bal.balance };
    } catch (error: unknown) {
      return {
        isValid: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async listProducts(apiKey: string): Promise<SupplierProduct[]> {
    const products = await this.getProducts(apiKey);
    const grouped = new Map<string, CanbosoCatalogProduct[]>();
    for (const p of products) {
      const groupKey = p.parentProductId ?? p.productId;
      const list = grouped.get(groupKey) ?? [];
      list.push(p);
      grouped.set(groupKey, list);
    }

    return [...grouped.entries()].map(([productKey, rows]) => {
      const head = rows[0]!;
      return {
        productKey,
        name: head.brandName ?? head.name,
        deliveryFields: head.requiredFields,
        variants: rows.map((p) => ({
          variantKey: p.variantId ?? p.productId,
          name: p.name,
          price: p.supplierPriceToman,
          stock: p.stock,
        })),
      };
    });
  }

  async getProductDetails(apiKey: string, productKey: string): Promise<SupplierProduct | null> {
    const { getCanbosoBulkCatalogForCheckout } = await import("../canboso/canbosoBulkCatalog.js");
    const snap = await getCanbosoBulkCatalogForCheckout("getProductDetails");
    const products = snap.remoteProducts;
    const matches = products.filter(
      (p) =>
        p.productId === productKey ||
        p.parentProductId === productKey ||
        p.variantId === productKey,
    );
    if (matches.length === 0) {
      return (await this.listProducts(apiKey)).find((p) => p.productKey === productKey) ?? null;
    }
    const head = matches[0]!;
    return {
      productKey: head.parentProductId ?? head.productId,
      name: head.brandName ?? head.name,
      deliveryFields: [
        ...new Set(matches.flatMap((m) => m.requiredFields)),
      ],
      variants: matches.map((p) => ({
        variantKey: p.variantId ?? p.productId,
        name: p.name,
        price: p.supplierPriceToman,
        stock: p.stock,
      })),
    };
  }

  async purchase(
    apiKey: string,
    mapping: SupplierProductMapping,
    _expectedPrice?: number,
    context?: SupplierPurchaseContext,
  ): Promise<PurchaseResult> {
    const productId = mapping.supplierProductKey;
    if (!productId) {
      throw new SupplierProductNotFoundError("Missing Canboso product_id on mapping.");
    }
    return this.purchaseProduct(productId, apiKey, { mapping, context });
  }
}

export const canbosoAdapter = new CanbosoAdapter();
