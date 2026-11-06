/**
 * Swap Wallet Deposit Detector polling (~90s).
 * Matches SUCCEED USDT deposits to PENDING invoices by exactCryptoAmount.
 */
import type { Api } from "grammy";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";
import {
  approveInvoice,
  extractUsdtAmountFromTx,
  fetchRecentUsdtDeposits,
  formatExactUsdt,
  INVOICE_LIFETIME_HOURS,
  loadSwapSettings,
  notifyUserSwapCredit,
  POLL_ACTIVE_HOURS,
  pollDepositsOnce,
} from "../payments/SwapWalletService";
import { SwapInvoiceStatus } from "@prisma/client";

const DEFAULT_INTERVAL_MS = 90_000;
const EXPIRE_CHUNK = 100;

let tickRunning = false;

const SOFT_NET_CODES = new Set([
  "EAI_AGAIN",
  "ETIMEDOUT",
  "ECONNRESET",
  "ENOTFOUND",
  "ECONNREFUSED",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

function isSoftNetworkError(err: unknown): boolean {
  let cur: unknown = err;
  for (let depth = 0; depth < 6 && cur; depth++) {
    if (typeof cur !== "object" || cur === null) break;
    const obj = cur as {
      code?: unknown;
      name?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (typeof obj.code === "string" && SOFT_NET_CODES.has(obj.code)) return true;
    if (obj.name === "TimeoutError" || obj.name === "AbortError") return true;
    if (
      typeof obj.message === "string" &&
      /EAI_AGAIN|ETIMEDOUT|ECONNRESET|ENOTFOUND|ECONNREFUSED|fetch failed|aborted due to timeout|TimeoutError/i.test(
        obj.message,
      )
    ) {
      return true;
    }
    cur = obj.cause;
  }
  return false;
}

function softNetworkCode(err: unknown): string {
  let cur: unknown = err;
  for (let depth = 0; depth < 6 && cur; depth++) {
    if (typeof cur !== "object" || cur === null) break;
    const obj = cur as { code?: unknown; name?: unknown; cause?: unknown };
    if (typeof obj.code === "string" && obj.code) return obj.code;
    if (obj.name === "TimeoutError" || obj.name === "AbortError") return String(obj.name);
    cur = obj.cause;
  }
  return "network";
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retry transient DNS/network failures; return null on soft exhaust. */
async function fetchDepositsWithRetry(
  settings: Awaited<ReturnType<typeof loadSwapSettings>>,
  limit: number,
): Promise<Record<string, unknown>[] | null> {
  const backoffsMs = [0, 1_500, 3_500];
  let lastErr: unknown;
  for (let attempt = 0; attempt < backoffsMs.length; attempt++) {
    if (backoffsMs[attempt]! > 0) await sleep(backoffsMs[attempt]!);
    try {
      return await fetchRecentUsdtDeposits(settings, limit);
    } catch (err) {
      lastErr = err;
      if (!isSoftNetworkError(err)) throw err;
    }
  }
  console.warn(
    `[swap-cron] deposit fetch soft-fail (${softNetworkCode(lastErr)}), will retry next tick`,
  );
  return null;
}

async function expireStalePending(): Promise<void> {
  const expireBefore = new Date(Date.now() - INVOICE_LIFETIME_HOURS * 60 * 60 * 1000);
  let cursor: number | undefined;

  for (;;) {
    const stale = await prisma.swapWalletInvoice.findMany({
      where: {
        status: SwapInvoiceStatus.PENDING,
        createdAt: { lt: expireBefore },
        ...(cursor != null ? { id: { gt: cursor } } : {}),
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

    cursor = stale[stale.length - 1]!.id;
    if (stale.length < EXPIRE_CHUNK) break;
  }
}

async function runSwapWalletTick(api: Api): Promise<void> {
  if (tickRunning) {
    console.warn("[swap-cron] previous tick still running, skipping");
    return;
  }
  tickRunning = true;
  try {
    await expireStalePending();

    const settings = await loadSwapSettings();
    if (!settings.apiKey || !settings.walletAddress) return;

    let rows: Record<string, unknown>[] | null;
    try {
      rows = await fetchDepositsWithRetry(settings, 20);
    } catch (err) {
      console.error(
        "[swap-cron] deposit fetch failed:",
        err instanceof Error ? err.message : err,
      );
      return;
    }
    if (!rows) return;

    const pollSince = new Date(Date.now() - POLL_ACTIVE_HOURS * 60 * 60 * 1000);
    const seenAmounts = new Set<string>();
    let creditedCount = 0;

    for (const item of rows) {
      const amount = extractUsdtAmountFromTx(item);
      if (!amount) continue;
      const amountKey = formatExactUsdt(amount);
      if (seenAmounts.has(amountKey)) continue;
      seenAmounts.add(amountKey);

      try {
        let pending = await prisma.swapWalletInvoice.findFirst({
          where: {
            status: SwapInvoiceStatus.PENDING,
            exactCryptoAmount: amount,
            createdAt: { gte: pollSince },
          },
          orderBy: { id: "asc" },
          select: { id: true, userId: true },
        });

        if (!pending) {
          const occupied = await prisma.swapWalletInvoice.findFirst({
            where: {
              status: SwapInvoiceStatus.PENDING,
              exactCryptoAmount: amount,
            },
            select: { id: true },
          });
          if (!occupied) {
            pending = await prisma.swapWalletInvoice.findFirst({
              where: {
                status: {
                  in: [SwapInvoiceStatus.CANCELED, SwapInvoiceStatus.EXPIRED],
                },
                exactCryptoAmount: amount,
              },
              orderBy: { id: "desc" },
              select: { id: true, userId: true },
            });
          }
        }

        if (!pending) continue;

        let externalRef = String(item.id ?? item.supportCode ?? "")
          .trim()
          .slice(0, 128);
        if (!externalRef) {
          externalRef = `SWDET-${amountKey}-${item.timestamp ?? "na"}`.slice(0, 128);
        }

        const result = await approveInvoice({
          invoiceId: pending.id,
          externalRef,
          providerConfirmed: true,
        });

        if (!result.credited) continue;
        creditedCount += 1;

        const user = await prisma.user.findUnique({
          where: { id: pending.userId },
          select: { telegramId: true },
        });
        if (user) {
          try {
            await notifyUserSwapCredit(api, user.telegramId, result);
          } catch (err) {
            console.error(`[swap-cron] notify failed invoice=${pending.id}:`, err);
          }
        }
      } catch (err) {
        console.error(
          `[swap-cron] approve failed amount=${amountKey}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    if (creditedCount > 0) {
      console.log(`[swap-cron] credited ${creditedCount} invoice(s)`);
    }
  } catch (err) {
    console.error("[swap-cron] tick failed:", err);
  } finally {
    tickRunning = false;
  }
}

export function startSwapWalletCron(api: Api): NodeJS.Timeout {
  const intervalMs =
    (env.SWAPPAY_POLL_INTERVAL_SEC > 0
      ? env.SWAPPAY_POLL_INTERVAL_SEC
      : 90) * 1000 || DEFAULT_INTERVAL_MS;

  void runSwapWalletTick(api);
  return setInterval(() => {
    void runSwapWalletTick(api);
  }, intervalMs);
}

/** Exported for tests / manual triggers */
export { pollDepositsOnce, runSwapWalletTick };
