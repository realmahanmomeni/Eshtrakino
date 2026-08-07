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

    let rows: Record<string, unknown>[];
    try {
      rows = await fetchRecentUsdtDeposits(settings, 20);
    } catch (err) {
      console.error("[swap-cron] deposit fetch failed:", err);
      return;
    }

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
