import { env } from "../../../config/env";
import type { SupplierProductMapping } from "@prisma/client";
import {
  SupplierAdapter,
  SupplierAuthenticationError,
  SupplierInsufficientBalanceError,
  SupplierInvalidResponseError,
  SupplierNetworkError,
  SupplierOutOfStockError,
  SupplierProductNotFoundError,
  SupplierPurchaseUncertainError,
  SupplierUnknownError,
  type PurchaseResult,
  type SupplierProduct,
  type SupplierPurchaseContext,
  type ValidationResult,
} from "../SupplierAdapter";
import { parseUsdAmount } from "./quantumMoney";
import { expandQuantumCatalog, QUANTUM_SUPPLIER_NAME } from "./quantumCatalog";
import { quantumStockCountForAdmin } from "./quantumStock";
import {
  quantumVaultHttp,
  throwForQuantumStatus,
  type QuantumHttpResult,
  type QuantumVaultHttpClient,
} from "./quantumVaultHttp";

/**
 * Quantum Store API adapter.
 *
 * Purchase is implemented so a later dispatch PR can call it, but nothing in
 * this PR calls purchase(). POST /purchase is never retried: a timeout, a
 * dropped connection, or a body we cannot parse leaves the charge uncertain.
 */
export class QuantumVaultAdapter implements SupplierAdapter {
  readonly name = QUANTUM_SUPPLIER_NAME;

  constructor(private readonly http: QuantumVaultHttpClient = quantumVaultHttp) {}

  resolveApiKey(apiKey?: string): string {
    const key = (apiKey ?? env.QUANTUMVAULT_API_KEY ?? "").trim();
    if (!key) {
      throw new SupplierAuthenticationError("QUANTUMVAULT_API_KEY is not configured.");
    }
    return key;
  }

  async validateKey(apiKey: string): Promise<ValidationResult> {
    try {
      const result = await this.http.request("/balance", apiKey, { retry: true });
      if (!result.ok) {
        return { isValid: false, errorMessage: result.message };
      }
      const record = asRecord(result.body);
      const balance = parseUsdAmount(record?.balance) ?? undefined;
      const credit = parseUsdAmount(record?.credit) ?? undefined;
      return { isValid: true, balance, credit };
    } catch (error) {
      return {
        isValid: false,
        errorMessage: error instanceof Error ? error.message : "Quantum key check failed.",
      };
    }
  }

  async listProducts(apiKey: string): Promise<SupplierProduct[]> {
    const result = await this.http.request("/products", apiKey, { retry: true });
    if (!result.ok) {
      throwForQuantumStatus(result);
      throw new SupplierInvalidResponseError(
        `Failed to list Quantum products: ${result.message}`,
      );
    }
    return expandQuantumCatalog(result.body).reduce<SupplierProduct[]>((products, unit) => {
      let product = products.find((row) => row.productKey === unit.productKey);
      if (!product) {
        product = {
          productKey: unit.productKey,
          name: unit.variantKey ? unit.name.split(" — ")[0] || unit.name : unit.name,
          deliveryFields: unit.deliverFieldNames,
          variants: [],
        };
        products.push(product);
      }
      if (unit.variantKey) {
        product.variants.push({
          variantKey: unit.variantKey,
          name: unit.variantName || unit.variantKey,
          price: unit.priceUsd ?? 0,
          stock: quantumStockCountForAdmin(unit.stockState) ?? undefined,
        });
      }
      return products;
    }, []);
  }

  async getProductDetails(apiKey: string, productKey: string): Promise<SupplierProduct | null> {
    const result = await this.http.request(
      `/products/${encodeURIComponent(productKey)}`,
      apiKey,
      { retry: true },
    );
    if (result.status === 404) return null;
    if (!result.ok) {
      throwForQuantumStatus(result);
      throw new SupplierInvalidResponseError(
        `Failed to read Quantum product: ${result.message}`,
      );
    }
    const wrapped = asRecord(result.body);
    const product = wrapped?.product ?? result.body;
    const units = expandQuantumCatalog({ products: [product] });
    const first = units[0];
    if (!first) return null;
    return {
      productKey: first.productKey,
      name: first.name,
      deliveryFields: first.deliverFieldNames,
      variants: units
        .filter((unit) => unit.variantKey)
        .map((unit) => ({
          variantKey: unit.variantKey!,
          name: unit.variantName || unit.name,
          price: unit.priceUsd ?? 0,
          stock: quantumStockCountForAdmin(unit.stockState) ?? undefined,
        })),
    };
  }

  async purchase(
    apiKey: string,
    mapping: SupplierProductMapping,
    _expectedPrice?: number,
    context?: SupplierPurchaseContext,
  ): Promise<PurchaseResult> {
    const payload: Record<string, unknown> = {
      productKey: mapping.supplierProductKey,
      quantity: 1,
    };
    if (mapping.supplierVariantKey) payload.variantKey = mapping.supplierVariantKey;

    const headers: Record<string, string> = {};
    if (context?.internalInvoiceId != null) {
      const idempotencyKey = quantumIdempotencyKey(context.internalInvoiceId);
      headers["Idempotency-Key"] = idempotencyKey;
      payload.clientOrderId = idempotencyKey;
    }

    let result: QuantumHttpResult;
    try {
      result = await this.http.request("/purchase", apiKey, {
        method: "POST",
        body: payload,
        headers,
        timeoutMs: 15_000,
        retry: false,
      });
    } catch (error) {
      if (error instanceof SupplierInvalidResponseError) throw error;
      if (error instanceof SupplierNetworkError || isAbort(error)) {
        throw new SupplierPurchaseUncertainError(
          "Quantum POST /purchase timed out or the connection dropped. It was not retried.",
        );
      }
      throw error;
    }

    if (!result.ok) {
      throw mapPurchaseHttpError(result);
    }

    let data: unknown;
    try {
      data = result.body;
      if (typeof data === "string") data = JSON.parse(data) as unknown;
    } catch {
      throw new SupplierPurchaseUncertainError(
        "Quantum purchase response could not be parsed. It was not retried.",
      );
    }

    return parsePurchaseBody(data, mapping.supplierProductKey);
  }

  /**
   * Read-only recovery after a timed-out purchase. Never calls POST /purchase.
   * Returns null when the match is missing or ambiguous.
   */
  async reconcile(
    apiKey: string,
    mapping: SupplierProductMapping,
    internalInvoiceId: number,
  ): Promise<PurchaseResult | null> {
    const lookbackMs = 5 * 60 * 1000;
    console.log(
      `[Quantum] Reconciling uncertain purchase: internalInvoiceId=${internalInvoiceId} productKey=${mapping.supplierProductKey}`,
    );

    let orders: QuantumHttpResult;
    try {
      orders = await this.http.request("/orders?limit=100", apiKey, { retry: true });
    } catch (error) {
      console.error(
        `[Quantum] reconcile: GET /orders failed: ${error instanceof Error ? error.message : "error"}`,
      );
      return null;
    }
    if (!orders.ok) return null;

    const list = asRecord(orders.body);
    const orderList = Array.isArray(list?.orders) ? list.orders : [];
    const cutoff = Date.now() - lookbackMs;
    const candidates = orderList.filter((entry) => {
      const order = asRecord(entry);
      if (!order || order.productKey !== mapping.supplierProductKey) return false;
      if (mapping.supplierVariantKey && order.variantKey !== mapping.supplierVariantKey) return false;
      const dateMs = typeof order.date === "string" ? new Date(order.date).getTime() : NaN;
      if (!Number.isNaN(dateMs) && dateMs < cutoff) return false;
      return true;
    });

    if (candidates.length !== 1) return null;
    const candidate = asRecord(candidates[0]);
    const candidateOrderId = candidate?.orderId;
    if (candidateOrderId == null || candidateOrderId === "") return null;

    let detail: QuantumHttpResult;
    try {
      detail = await this.http.request(
        `/orders/${encodeURIComponent(String(candidateOrderId))}`,
        apiKey,
        { retry: true },
      );
    } catch {
      return null;
    }
    if (!detail.ok) return null;
    const detailOrder = asRecord(asRecord(detail.body)?.order);
    if (!detailOrder) return null;

    return {
      supplierOrderId: String(detailOrder.orderId || candidateOrderId),
      costAmount: parseUsdAmount(detailOrder.price) ?? parseUsdAmount(candidate?.price) ?? 0,
      deliveryPayload: JSON.stringify({
        fields: Array.isArray(detailOrder.fields) ? detailOrder.fields : [],
        purchaseId: detailOrder.purchaseId ?? null,
        ...(detailOrder.data && typeof detailOrder.data === "object" ? { data: detailOrder.data } : {}),
      }),
    };
  }
}

export function quantumIdempotencyKey(invoiceId: number): string {
  const key = `esh-inv-${invoiceId}`;
  return key.length >= 8 ? key : key.padEnd(8, "0");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

function mapPurchaseHttpError(result: QuantumHttpResult): Error {
  const message = result.message || `HTTP ${result.status}`;
  const code =
    result.body && typeof result.body === "object"
      ? String((result.body as { code?: unknown }).code ?? "")
      : "";

  if (result.status === 401 || result.status === 403) {
    throwForQuantumStatus(result);
  }
  if (result.status === 409 && code === "IDEMPOTENCY_INTERRUPTED") {
    return new SupplierPurchaseUncertainError(
      "Quantum idempotency was interrupted. Check orders before buying again.",
    );
  }
  if (result.status === 409 && /still (being )?processed|still running/i.test(message)) {
    return new SupplierPurchaseUncertainError(message);
  }
  if (result.status === 409) {
    return new SupplierOutOfStockError(message);
  }
  if (result.status === 400 && /balance/i.test(message)) {
    return new SupplierInsufficientBalanceError(message);
  }
  if (result.status === 400 && /stock/i.test(message)) {
    return new SupplierOutOfStockError(message);
  }
  if (result.status === 404 || /not available via the api/i.test(message)) {
    return new SupplierProductNotFoundError(message);
  }
  if (result.status === 503) {
    return new SupplierUnknownError(
      `Quantum verification failed temporarily; nothing was charged. ${message}`,
    );
  }
  return new SupplierUnknownError(`Quantum purchase failed (${result.status}): ${message}`);
}

function parsePurchaseBody(data: unknown, productKey: string): PurchaseResult {
  const root = asRecord(data);
  if (!root) {
    throw new SupplierInvalidResponseError("Quantum purchase response is empty.");
  }
  if (root.success === false) {
    const message = typeof root.message === "string" ? root.message : "purchase rejected";
    throw new SupplierUnknownError(`Quantum purchase rejected (success=false): ${message}`);
  }

  const order = asRecord(root.order);
  if (!order) {
    throw new SupplierInvalidResponseError("Quantum purchase response is missing order.");
  }

  const items = Array.isArray(order.items) ? order.items : [];
  const processing = Array.isArray(order.processing) ? order.processing : [];
  const totalCharged = parseUsdAmount(order.totalCharged) ?? 0;

  if (items.length === 0 && processing.length > 0) {
    const first = asRecord(processing[0]);
    const orderId = first?.orderId;
    if (typeof orderId !== "string" || !orderId) {
      throw new SupplierInvalidResponseError("Quantum processing order is missing orderId.");
    }
    console.log(
      `[Quantum] Purchase processing: productKey=${productKey} orderId=${orderId} totalCharged=${totalCharged}`,
    );
    return {
      supplierOrderId: orderId,
      costAmount: totalCharged,
      deliveryPayload: JSON.stringify({ status: "processing", processing }),
      isProcessing: true,
      status: "processing",
    };
  }

  const item = asRecord(items[0]);
  if (!item) {
    throw new SupplierInvalidResponseError(
      "Quantum purchase response 'order.items' is missing or empty.",
    );
  }

  const fulfilled = Number(order.fulfilled);
  const requested = Number(order.requested);
  if (Number.isFinite(fulfilled) && Number.isFinite(requested) && fulfilled > 0 && fulfilled < requested) {
    console.warn(
      `[Quantum] Partial delivery: productKey=${productKey} requested=${requested} fulfilled=${fulfilled}`,
    );
  }
  const rawOrderId = item.orderId;
  if (rawOrderId == null || rawOrderId === "") {
    throw new SupplierInvalidResponseError("Quantum purchase item is missing orderId.");
  }

  const fieldCount = Array.isArray(item.fields) ? item.fields.length : 0;
  console.log(
    `[Quantum] Purchase OK: productKey=${productKey} orderId=${String(rawOrderId)} totalCharged=${totalCharged} fieldsCount=${fieldCount}`,
  );

  return {
    supplierOrderId: String(rawOrderId),
    costAmount: totalCharged || parseUsdAmount(item.price) || 0,
    deliveryPayload: JSON.stringify({
      fields: Array.isArray(item.fields) ? item.fields : [],
      purchaseId: item.purchaseId ?? null,
      ...(item.data && typeof item.data === "object" ? { data: item.data } : {}),
    }),
    status: typeof order.status === "string" ? order.status : "completed",
  };
}

export const quantumVaultAdapter = new QuantumVaultAdapter();
