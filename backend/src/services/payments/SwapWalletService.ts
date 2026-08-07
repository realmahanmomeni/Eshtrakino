/**
 * Swap Wallet payment integration — invoice slots, Deposit Detector matching, credit.
 * Business logic translated from swappay/swap_api.py.
 */
import { Prisma, SwapInvoiceStatus, type SwapWalletInvoice } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "../../lib/prisma";
import {
  settingsService,
  SWAPPAY_API_KEY,
  SWAPPAY_WALLET_ADDRESS,
} from "../settings/SettingsService";
import { env } from "../../config/env";
import { formatToman } from "../../lib/money";

export const GATEWAY_SWAPWALLET = "SWAPWALLET";
export const SWAPWALLET_API_BASE = "https://swapwallet.app/api";

const FRACTION_MIN_UNITS = 1;
const FRACTION_TIER1_MAX = 9;
const FRACTION_MAX_UNITS = 99;
const SLOT_ADVISORY_NS = 740_501;
const ALLOC_INSERT_RETRIES = 5;

export const INVOICE_LIFETIME_HOURS = 5;
export const POLL_ACTIVE_HOURS = 2;
const VERIFY_COOLDOWN_SEC = 60;

const verifyLast = new Map<number, number>();

export class SwapPayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SwapPayError";
  }
}

export class ExchangePriceError extends SwapPayError {
  constructor(message: string) {
    super(message);
    this.name = "ExchangePriceError";
  }
}

export class SwappayVerifyRateLimited extends SwapPayError {
  constructor(message: string) {
    super(message);
    this.name = "SwappayVerifyRateLimited";
  }
}

export type SwapRuntimeSettings = {
  apiKey: string;
  walletAddress: string;
  walletNetwork: string;
};

export type ApproveResult = {
  invoiceId: number;
  credited: boolean;
  alreadyVerified: boolean;
  amountUsd: Decimal;
  amountIrt: Decimal;
  newBalance: Decimal;
  trackingCode: string;
};

export type CancelResult = {
  invoiceId: number;
  canceled: boolean;
  approved: boolean;
  approveResult: ApproveResult | null;
};

export function quantizeUsdt(value: Decimal | number | string): Decimal {
  return new Decimal(String(value)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function formatExactUsdt(value: Decimal | number | string): string {
  return quantizeUsdt(value).toFixed(2);
}

export function formatTrackingCode(invoiceId: number): string {
  return `SP-${invoiceId}`;
}

/** Link a Swap invoice to a product checkout Invoice.id */
export function checkoutSwapNote(productInvoiceId: number): string {
  return `checkout:${productInvoiceId}`;
}

export function parseCheckoutInvoiceId(note: string | null | undefined): number | null {
  if (!note) return null;
  const match = /^checkout:(\d+)$/.exec(note.trim());
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function isInvoiceExpired(
  createdAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!createdAt) return false;
  const cutoff = now.getTime() - INVOICE_LIFETIME_HOURS * 60 * 60 * 1000;
  return createdAt.getTime() < cutoff;
}

export function enforceVerifyCooldown(invoiceId: number): void {
  const now = Date.now();
  const last = verifyLast.get(invoiceId) ?? 0;
  if (now - last < VERIFY_COOLDOWN_SEC * 1000) {
    throw new SwappayVerifyRateLimited(
      "⏳ لطفاً کمی صبر کنید. استعلام دستی بعدی ۱ دقیقه دیگر امکان‌پذیر است...",
    );
  }
  verifyLast.set(invoiceId, now);
}

/** Load API key + wallet address from SystemSetting (env fallback for address). */
export async function loadSwapSettings(): Promise<SwapRuntimeSettings> {
  const [apiKeyRaw, addressRaw] = await Promise.all([
    settingsService.getSetting(SWAPPAY_API_KEY),
    settingsService.getSetting(SWAPPAY_WALLET_ADDRESS),
  ]);
  const apiKey = (apiKeyRaw ?? "").trim();
  const fromDb = (addressRaw ?? "").trim();
  const walletAddress = fromDb || (env.SWAPPAY_WALLET_ADDRESS ?? "").trim();
  return {
    apiKey,
    walletAddress,
    walletNetwork: (env.SWAPPAY_WALLET_NETWORK ?? "BSC").trim() || "BSC",
  };
}

function authHeaders(apiKey: string): Record<string, string> {
  const key = apiKey.trim();
  if (!key) throw new SwapPayError("SWAPPAY_API_KEY is not configured");
  return {
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
  };
}

const PRICE_CACHE_TTL_MS = 30 * 60 * 1000;

/** Lazy in-memory USDT/IRT rate cache (no background polling). */
class PriceCache {
  private cachedRate: number | null = null;
  private lastFetchTime = 0;
  /** Deduplicate concurrent refreshes without blocking the event loop. */
  private inflight: Promise<number> | null = null;

  async getRate(): Promise<number> {
    const now = Date.now();
    if (
      this.cachedRate != null &&
      now - this.lastFetchTime < PRICE_CACHE_TTL_MS
    ) {
      return this.cachedRate;
    }

    if (this.inflight) return this.inflight;

    this.inflight = this.refresh().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async refresh(): Promise<number> {
    try {
      const rate = await fetchUsdtIrtRateFromApi();
      this.cachedRate = rate;
      this.lastFetchTime = Date.now();
      return rate;
    } catch (err) {
      if (this.cachedRate != null) {
        console.warn(
          "[SwapPay] USDT/IRT live fetch failed; using stale cached rate:",
          err instanceof Error ? err.message : err,
        );
        return this.cachedRate;
      }
      throw err;
    }
  }
}

const usdtIrtPriceCache = new PriceCache();

async function fetchUsdtIrtRateFromApi(): Promise<number> {
  let response: Response;
  try {
    response = await fetch(`${SWAPWALLET_API_BASE}/v1/market/prices`, {
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ExchangePriceError("SwapWallet market prices request failed");
  }
  if (!response.ok) {
    throw new ExchangePriceError("SwapWallet market prices request failed");
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ExchangePriceError("SwapWallet market prices response invalid");
  }

  if (!data || typeof data !== "object") {
    throw new ExchangePriceError("SwapWallet market prices response is not an object");
  }

  const obj = data as Record<string, unknown>;
  let raw: unknown = obj["USDT/IRT"];
  if (raw == null && obj.result && typeof obj.result === "object") {
    raw = (obj.result as Record<string, unknown>)["USDT/IRT"];
  }
  if (raw == null) {
    throw new ExchangePriceError("USDT/IRT pair missing from SwapWallet prices");
  }

  const rate = Number(String(raw).replace(/,/g, "").trim());
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new ExchangePriceError("USDT/IRT price must be positive");
  }
  return rate;
}

/** Live USDT/IRT rate with 30-minute lazy cache (+ stale fallback on API errors). */
export async function getLiveUsdtIrtRate(): Promise<number> {
  return usdtIrtPriceCache.getRate();
}

export function calculateIrtAmount(usdtAmount: Decimal, liveRate: number): number {
  if (liveRate <= 0) throw new SwapPayError("Live USDT/IRT rate must be positive");
  return Math.max(1, Math.round(Number(usdtAmount) * liveRate));
}

export function generateSmartPaymentUrl(
  address: string,
  amount: Decimal | number | string,
  network = "BSC",
): string {
  const wallet = address.trim();
  if (!wallet) throw new SwapPayError("SWAPPAY_WALLET_ADDRESS is not configured");

  const net = (network || "BSC").trim() || "BSC";
  const amountStr = formatExactUsdt(amount);
  const query = new URLSearchParams({
    coin: "USDT",
    network: net,
    memo: "",
    address: wallet,
    amount: amountStr,
  }).toString();
  const relativePath = `/express-withdraw?${query}`;
  const b64 = Buffer.from(relativePath, "utf8").toString("base64");
  const nextUrl = encodeURIComponent(b64);
  return `https://swapwallet.app/login?nextUrl=${nextUrl}&step=ways`;
}

export function buildPaymentUrl(
  settings: SwapRuntimeSettings,
  exactCryptoAmount: Decimal,
): string {
  return generateSmartPaymentUrl(
    settings.walletAddress,
    exactCryptoAmount,
    settings.walletNetwork,
  );
}

function fractionUnitsPriority(): number[] {
  const tier1: number[] = [];
  for (let u = FRACTION_MIN_UNITS; u <= FRACTION_TIER1_MAX; u++) tier1.push(u);
  const tier2: number[] = [];
  for (let u = FRACTION_TIER1_MAX + 1; u <= FRACTION_MAX_UNITS; u++) tier2.push(u);
  return tier1.concat(tier2);
}

/** Allocate lowest free base+fraction slot (PENDING only). Uses pg advisory lock. */
export async function allocateUniqueExactAmount(
  tx: Prisma.TransactionClient,
  baseUsdtAmount: Decimal,
): Promise<Decimal> {
  if (baseUsdtAmount.lte(0)) {
    throw new SwapPayError("Base USDT amount must be positive");
  }

  const base = quantizeUsdt(baseUsdtAmount);
  const lockKey = Number(
    base.mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber(),
  );
  const ns = Number(SLOT_ADVISORY_NS);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ns}::integer, ${lockKey}::integer)`;

  const slotMin = quantizeUsdt(base.add(new Decimal(FRACTION_MIN_UNITS).div(100)));
  const slotMax = quantizeUsdt(base.add(new Decimal(FRACTION_MAX_UNITS).div(100)));

  const usedRows = await tx.swapWalletInvoice.findMany({
    where: {
      status: SwapInvoiceStatus.PENDING,
      exactCryptoAmount: { not: null, gte: slotMin, lte: slotMax },
    },
    select: { exactCryptoAmount: true },
  });

  const used = new Set(
    usedRows
      .map((r) => r.exactCryptoAmount)
      .filter((v): v is Decimal => v != null)
      .map((v) => formatExactUsdt(v)),
  );

  for (const units of fractionUnitsPriority()) {
    const exact = quantizeUsdt(base.add(new Decimal(units).div(100)));
    if (!used.has(formatExactUsdt(exact))) return exact;
  }

  throw new SwapPayError(
    "تمام اسلات‌های مبلغ یکتای این بازه در حال استفاده است. لطفاً چند دقیقه دیگر دوباره تلاش کنید.",
  );
}

export function extractUsdtAmountFromTx(item: unknown): Decimal | null {
  if (!item || typeof item !== "object") return null;
  const row = item as Record<string, unknown>;
  if (String(row.status ?? "").toUpperCase() !== "SUCCEED") return null;

  for (const key of ["transfer", "cryptoDeposit", "crypto_deposit"] as const) {
    const detail = row[key];
    if (!detail || typeof detail !== "object") continue;
    const amount = (detail as Record<string, unknown>).amount;
    if (!amount || typeof amount !== "object") continue;
    const amt = amount as Record<string, unknown>;
    const unit = String(amt.unit ?? "").toUpperCase();
    if (unit && unit !== "USDT") continue;
    if (amt.number == null) continue;
    try {
      const value = quantizeUsdt(String(amt.number));
      if (value.gt(0)) return value;
    } catch {
      continue;
    }
  }
  return null;
}

export async function fetchRecentUsdtDeposits(
  settings: SwapRuntimeSettings,
  limit = 20,
): Promise<Record<string, unknown>[]> {
  const params = new URLSearchParams();
  params.append("types", "CRYPTO_DEPOSIT");
  params.append("types", "TRANSFER");
  params.append("tokens", "USDT");
  params.append("sortDir", "DESC");
  params.append("limit", String(limit));

  const response = await fetch(
    `${SWAPWALLET_API_BASE}/v2/transaction?${params.toString()}`,
    {
      headers: authHeaders(settings.apiKey),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new SwapPayError(`SwapWallet deposit detector HTTP ${response.status}`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  if (!payload || payload.status !== "OK") {
    console.warn("[SwapWallet] unexpected deposit detector payload:", payload);
    return [];
  }

  const result = payload.result;
  let data: unknown;
  if (result && typeof result === "object" && !Array.isArray(result)) {
    data = (result as Record<string, unknown>).data;
  } else {
    data = result;
  }
  if (!Array.isArray(data)) return [];
  return data.filter((row): row is Record<string, unknown> => !!row && typeof row === "object");
}

export async function findProviderDepositMatch(
  settings: SwapRuntimeSettings,
  exactAmount: Decimal,
  limit = 30,
): Promise<{ externalRef: string | null; row: Record<string, unknown> | null }> {
  const exact = quantizeUsdt(exactAmount);
  if (exact.lte(0)) return { externalRef: null, row: null };

  const rows = await fetchRecentUsdtDeposits(settings, limit);
  for (const item of rows) {
    const amount = extractUsdtAmountFromTx(item);
    if (!amount || !amount.eq(exact)) continue;
    let externalRef = String(item.id ?? item.supportCode ?? "").trim().slice(0, 128);
    if (!externalRef) {
      externalRef = `SWDET-${formatExactUsdt(exact)}-${item.timestamp ?? "na"}`.slice(0, 128);
    }
    return { externalRef, row: item };
  }
  return { externalRef: null, row: null };
}

export async function createInvoice(params: {
  userId: number;
  amountUsd: Decimal;
  /** Optional note (e.g. checkout:<productInvoiceId>) */
  note?: string | null;
}): Promise<{ invoice: SwapWalletInvoice; payUrl: string; exact: Decimal }> {
  const { userId, amountUsd, note = null } = params;
  if (amountUsd.lte(0)) throw new SwapPayError("Top-up USD amount must be positive");

  const settings = await loadSwapSettings();
  if (!settings.walletAddress) {
    throw new SwapPayError("SWAPPAY_WALLET_ADDRESS is not configured");
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= ALLOC_INSERT_RETRIES; attempt++) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const exact = await allocateUniqueExactAmount(tx, amountUsd);
        const payUrl = buildPaymentUrl(settings, exact);
        const placeholder = `SWP${userId}-${Date.now().toString(36)}`;

        const inv = await tx.swapWalletInvoice.create({
          data: {
            userId,
            amountUsd,
            exactCryptoAmount: exact,
            gateway: GATEWAY_SWAPWALLET,
            status: SwapInvoiceStatus.PENDING,
            trackingCode: placeholder,
            paymentUrl: payUrl,
            note: note?.trim() || null,
          },
        });

        const trackingCode = formatTrackingCode(inv.id);
        const updated = await tx.swapWalletInvoice.update({
          where: { id: inv.id },
          data: { trackingCode },
        });

        return { invoice: updated, payUrl, exact };
      });

      console.log(
        `[SwapPay] invoice created user=${userId} id=${result.invoice.id} tracking=${result.invoice.trackingCode} usd=${amountUsd} exact=${result.exact}`,
      );
      return result;
    } catch (err) {
      lastError = err;
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        console.warn(`[SwapPay] slot collision attempt=${attempt} user=${userId}`);
        continue;
      }
      if (err instanceof SwapPayError) throw err;
      throw err;
    }
  }

  throw new SwapPayError(
    "تمام اسلات‌های مبلغ یکتای این بازه در حال استفاده است. لطفاً چند دقیقه دیگر دوباره تلاش کنید.",
  );
}

export async function findActivePendingInvoice(
  userId: number,
): Promise<SwapWalletInvoice | null> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - INVOICE_LIFETIME_HOURS * 60 * 60 * 1000);

  const inv = await prisma.swapWalletInvoice.findFirst({
    where: {
      userId,
      status: SwapInvoiceStatus.PENDING,
      createdAt: { gte: cutoff },
    },
    orderBy: { id: "desc" },
  });
  if (!inv) return null;

  if (isInvoiceExpired(inv.createdAt, now)) {
    await prisma.swapWalletInvoice.update({
      where: { id: inv.id },
      data: { status: SwapInvoiceStatus.EXPIRED },
    });
    return null;
  }
  return inv;
}

async function refAlreadyCredited(
  tx: Prisma.TransactionClient,
  providerRef: string,
  excludeInvoiceId: number,
): Promise<boolean> {
  const row = await tx.swapWalletInvoice.findFirst({
    where: {
      providerRef,
      status: SwapInvoiceStatus.SUCCESS,
      id: { not: excludeInvoiceId },
    },
    select: { id: true },
  });
  return row != null;
}

/**
 * Idempotent approve + credit wallet in IRT (exact USDT × live rate).
 * Requires provider_confirmed + external_ref (S2S only).
 * Live rate is fetched outside the DB transaction to avoid blocking the pool.
 */
export async function approveInvoice(params: {
  invoiceId: number;
  externalRef?: string | null;
  providerConfirmed?: boolean;
}): Promise<ApproveResult> {
  const { invoiceId, externalRef = null, providerConfirmed = false } = params;

  const existing = await prisma.swapWalletInvoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      userId: true,
      status: true,
      amountUsd: true,
      exactCryptoAmount: true,
      trackingCode: true,
      createdAt: true,
    },
  });
  if (!existing) throw new Error(`Invoice not found: ${invoiceId}`);

  const baseUsd = new Decimal(String(existing.amountUsd ?? "0"));
  const creditUsdt = quantizeUsdt(existing.exactCryptoAmount ?? baseUsd);
  const tracking = existing.trackingCode || formatTrackingCode(invoiceId);

  if (existing.status === SwapInvoiceStatus.SUCCESS) {
    const bal = await prisma.user.findUnique({
      where: { id: existing.userId },
      select: { balance: true },
    });
    return {
      invoiceId,
      credited: false,
      alreadyVerified: true,
      amountUsd: creditUsdt.gt(0) ? creditUsdt : baseUsd,
      amountIrt: new Decimal(0),
      newBalance: bal?.balance ?? new Decimal(0),
      trackingCode: tracking,
    };
  }

  if (existing.status === SwapInvoiceStatus.FAILED) {
    return {
      invoiceId,
      credited: false,
      alreadyVerified: false,
      amountUsd: creditUsdt.gt(0) ? creditUsdt : baseUsd,
      amountIrt: new Decimal(0),
      newBalance: new Decimal(0),
      trackingCode: tracking,
    };
  }

  const isOverride =
    existing.status === SwapInvoiceStatus.CANCELED ||
    existing.status === SwapInvoiceStatus.EXPIRED;

  if (isOverride) {
    if (!providerConfirmed) {
      throw new SwapPayError(
        "Override of CANCELED/EXPIRED requires live SwapWallet confirmation",
      );
    }
    if (!(externalRef || "").trim()) {
      throw new SwapPayError(
        "Override of CANCELED/EXPIRED requires provider transaction id",
      );
    }
  }

  if (
    existing.status === SwapInvoiceStatus.PENDING &&
    isInvoiceExpired(existing.createdAt)
  ) {
    if (!providerConfirmed) {
      await prisma.swapWalletInvoice.update({
        where: { id: invoiceId },
        data: { status: SwapInvoiceStatus.EXPIRED },
      });
      return {
        invoiceId,
        credited: false,
        alreadyVerified: false,
        amountUsd: creditUsdt.gt(0) ? creditUsdt : baseUsd,
        amountIrt: new Decimal(0),
        newBalance: new Decimal(0),
        trackingCode: tracking,
      };
    }
  }

  if (creditUsdt.lte(0)) {
    throw new SwapPayError("Invoice is missing exact USDT amount");
  }
  if (!providerConfirmed) {
    throw new SwapPayError(
      "SwapPay credit requires server-to-server provider confirmation",
    );
  }

  const ref = (externalRef || "").trim().slice(0, 128);
  if (!ref) {
    throw new SwapPayError("Provider transaction id is required for SwapPay credit");
  }

  // Network I/O outside DB transaction
  const liveRate = await getLiveUsdtIrtRate();
  const irtAmount = new Decimal(calculateIrtAmount(creditUsdt, liveRate));

  return prisma.$transaction(async (tx) => {
    const inv = await tx.swapWalletInvoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw new Error(`Invoice not found: ${invoiceId}`);

    if (inv.status === SwapInvoiceStatus.SUCCESS) {
      const bal = await tx.user.findUnique({
        where: { id: inv.userId },
        select: { balance: true },
      });
      return {
        invoiceId,
        credited: false,
        alreadyVerified: true,
        amountUsd: creditUsdt,
        amountIrt: new Decimal(0),
        newBalance: bal?.balance ?? new Decimal(0),
        trackingCode: tracking,
      };
    }

    if (await refAlreadyCredited(tx, ref, invoiceId)) {
      throw new SwapPayError(
        "این تراکنش SwapWallet قبلاً برای فاکتور دیگری ثبت شده است.",
      );
    }

    await tx.swapWalletInvoice.update({
      where: { id: invoiceId },
      data: {
        providerRef: ref,
        amountUsd: creditUsdt,
        status: SwapInvoiceStatus.SUCCESS,
        note: `credited ${formatExactUsdt(creditUsdt)} USDT → ${irtAmount.toFixed(0)} IRT @ ${liveRate}`,
      },
    });

    const user = await tx.user.update({
      where: { id: inv.userId },
      data: { balance: { increment: irtAmount } },
      select: { balance: true },
    });

    await tx.walletTransaction.create({
      data: {
        userId: inv.userId,
        amount: irtAmount,
        type: "TOPUP",
        description: `شارژ SwapWallet ${formatExactUsdt(creditUsdt)} USDT — ${tracking}`,
      },
    });

    console.log(
      `[SwapPay] approved user=${inv.userId} invoice=${invoiceId} tracking=${tracking} ref=${ref} usdt=${formatExactUsdt(creditUsdt)} irt=${irtAmount} override=${isOverride}`,
    );

    return {
      invoiceId,
      credited: true,
      alreadyVerified: false,
      amountUsd: creditUsdt,
      amountIrt: irtAmount,
      newBalance: user.balance,
      trackingCode: tracking,
    };
  });
}

export async function verifyInvoice(params: {
  invoiceId: number;
  userId: number;
}): Promise<ApproveResult | null> {
  const { invoiceId, userId } = params;
  const settings = await loadSwapSettings();

  const inv = await prisma.swapWalletInvoice.findUnique({ where: { id: invoiceId } });
  if (!inv) throw new Error(`Invoice not found: ${invoiceId}`);
  if (inv.userId !== userId) throw new SwapPayError("این فاکتور متعلق به شما نیست.");

  if (inv.status === SwapInvoiceStatus.SUCCESS) {
    return approveInvoice({ invoiceId, providerConfirmed: true });
  }
  if (inv.status === SwapInvoiceStatus.FAILED) {
    throw new SwapPayError("این فاکتور ناموفق شده است.");
  }

  const exact = quantizeUsdt(inv.exactCryptoAmount ?? 0);
  if (exact.lte(0)) throw new SwapPayError("فاکتور مبلغ دقیق ندارد.");

  const { externalRef, row } = await findProviderDepositMatch(settings, exact);
  if (externalRef == null && row == null) {
    if (inv.status === SwapInvoiceStatus.PENDING && isInvoiceExpired(inv.createdAt)) {
      await prisma.swapWalletInvoice.update({
        where: { id: invoiceId },
        data: { status: SwapInvoiceStatus.EXPIRED },
      });
      throw new SwapPayError("این فاکتور منقضی شده است.");
    }
    if (
      inv.status === SwapInvoiceStatus.CANCELED ||
      inv.status === SwapInvoiceStatus.EXPIRED
    ) {
      throw new SwapPayError(
        "پرداختی در SwapWallet برای این فاکتور تایید نشده است.",
      );
    }
    return null;
  }

  return approveInvoice({
    invoiceId,
    externalRef,
    providerConfirmed: true,
  });
}

export async function cancelInvoice(params: {
  invoiceId: number;
  userId: number;
}): Promise<CancelResult> {
  const { invoiceId, userId } = params;
  const settings = await loadSwapSettings();

  const inv = await prisma.swapWalletInvoice.findUnique({ where: { id: invoiceId } });
  if (!inv) throw new Error(`Invoice not found: ${invoiceId}`);
  if (inv.userId !== userId) throw new SwapPayError("این فاکتور متعلق به شما نیست.");
  if (inv.status === SwapInvoiceStatus.SUCCESS) {
    throw new SwapPayError("این فاکتور قبلاً تایید و شارژ شده است.");
  }
  if (inv.status !== SwapInvoiceStatus.PENDING) {
    throw new SwapPayError("فقط فاکتورهای در انتظار قابل لغو هستند.");
  }

  const exact = quantizeUsdt(inv.exactCryptoAmount ?? 0);
  const { externalRef, row } = await findProviderDepositMatch(settings, exact);
  if (externalRef != null || row != null) {
    const result = await approveInvoice({
      invoiceId,
      externalRef,
      providerConfirmed: true,
    });
    return {
      invoiceId,
      canceled: false,
      approved: Boolean(result.credited || result.alreadyVerified),
      approveResult: result,
    };
  }

  await prisma.swapWalletInvoice.update({
    where: { id: invoiceId },
    data: { status: SwapInvoiceStatus.CANCELED },
  });
  console.log(`[SwapPay] canceled invoice=${invoiceId} user=${userId}`);
  return {
    invoiceId,
    canceled: true,
    approved: false,
    approveResult: null,
  };
}

async function findReviveCandidate(
  tx: Prisma.TransactionClient,
  exactAmount: Decimal,
): Promise<SwapWalletInvoice | null> {
  const exact = quantizeUsdt(exactAmount);
  const pending = await tx.swapWalletInvoice.findFirst({
    where: {
      status: SwapInvoiceStatus.PENDING,
      exactCryptoAmount: exact,
    },
    select: { id: true },
  });
  if (pending) return null;

  return tx.swapWalletInvoice.findFirst({
    where: {
      status: { in: [SwapInvoiceStatus.CANCELED, SwapInvoiceStatus.EXPIRED] },
      exactCryptoAmount: exact,
    },
    orderBy: { id: "desc" },
  });
}

/**
 * One polling cycle: expire old PENDING, match recent SUCCEED deposits.
 * Returns number of freshly credited invoices.
 */
export async function pollDepositsOnce(): Promise<number> {
  const settings = await loadSwapSettings();
  if (!settings.apiKey || !settings.walletAddress) return 0;

  let rows: Record<string, unknown>[];
  try {
    rows = await fetchRecentUsdtDeposits(settings, 20);
  } catch (err) {
    console.error("[SwapWallet] deposit detector fetch failed:", err);
    return 0;
  }

  const now = new Date();
  const expireBefore = new Date(now.getTime() - INVOICE_LIFETIME_HOURS * 60 * 60 * 1000);
  const pollSince = new Date(now.getTime() - POLL_ACTIVE_HOURS * 60 * 60 * 1000);

  // Expire stale PENDING in chunks (performance)
  const EXPIRE_CHUNK = 100;
  let expireCursor: number | undefined;
  for (;;) {
    const stale = await prisma.swapWalletInvoice.findMany({
      where: {
        status: SwapInvoiceStatus.PENDING,
        createdAt: { lt: expireBefore },
        ...(expireCursor != null ? { id: { gt: expireCursor } } : {}),
      },
      select: { id: true },
      orderBy: { id: "asc" },
      take: EXPIRE_CHUNK,
    });
    if (stale.length === 0) break;
    await prisma.swapWalletInvoice.updateMany({
      where: { id: { in: stale.map((r) => r.id) } },
      data: { status: SwapInvoiceStatus.EXPIRED },
    });
    expireCursor = stale[stale.length - 1]!.id;
    if (stale.length < EXPIRE_CHUNK) break;
  }

  let creditedCount = 0;
  const seenAmounts = new Set<string>();

  for (const item of rows) {
    const amount = extractUsdtAmountFromTx(item);
    if (!amount) continue;
    const amountKey = formatExactUsdt(amount);
    if (seenAmounts.has(amountKey)) continue;
    seenAmounts.add(amountKey);

    try {
      const matched = await prisma.$transaction(async (tx) => {
        let pending = await tx.swapWalletInvoice.findFirst({
          where: {
            status: SwapInvoiceStatus.PENDING,
            exactCryptoAmount: amount,
            createdAt: { gte: pollSince },
          },
          orderBy: { id: "asc" },
        });
        if (!pending) {
          pending = await findReviveCandidate(tx, amount);
        }
        return pending;
      });

      if (!matched) continue;

      let externalRef = String(item.id ?? item.supportCode ?? "").trim().slice(0, 128);
      if (!externalRef) {
        externalRef = `SWDET-${amountKey}-${item.timestamp ?? "na"}`.slice(0, 128);
      }

      const result = await approveInvoice({
        invoiceId: matched.id,
        externalRef,
        providerConfirmed: true,
      });
      if (result.credited) creditedCount += 1;
    } catch (err) {
      console.error(
        `[SwapPay] approve failed amount=${amountKey}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (creditedCount > 0) {
    console.log(`[SwapPay] polling credited ${creditedCount} invoice(s)`);
  }
  return creditedCount;
}

/** Notify user after auto-credit (used by cron). */
export async function notifyUserSwapCredit(
  api: { sendMessage: (chatId: number, text: string, other?: object) => Promise<unknown> },
  telegramId: bigint | number,
  result: ApproveResult,
): Promise<void> {
  const text = [
    "✅ *پرداخت Swap Wallet تایید شد*",
    "",
    `🔢 کد پیگیری: \`${result.trackingCode}\``,
    `💵 مبلغ: *${formatExactUsdt(result.amountUsd)} USDT*`,
    `💰 شارژ کیف پول: *${formatToman(result.amountIrt)}*`,
    `💰 موجودی جدید: *${formatToman(result.newBalance)}*`,
  ].join("\n");

  await api.sendMessage(Number(telegramId), text, { parse_mode: "Markdown" });
}
