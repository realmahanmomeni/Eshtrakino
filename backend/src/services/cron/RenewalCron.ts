import type { Api } from "grammy";
import { InlineKeyboard } from "grammy";
import { InvoiceStatus, type Invoice, type Product, type User } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { Callbacks } from "../../bot/keyboards/callbacks";

/** Run every 6 hours — subscription windows are measured in days. */
const CRON_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 50;
const SEND_DELAY_MS = 100;

type InvoiceWithRelations = Invoice & { product: Product | null; user: User };

function renewalKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("🛒 تمدید / خرید مجدد", Callbacks.shop);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processFiveDayBatch(
  api: Api,
  from: Date,
  to: Date,
): Promise<number> {
  let processed = 0;
  let cursor: number | undefined;

  for (;;) {
    const batch: InvoiceWithRelations[] = await prisma.invoice.findMany({
      where: {
        status: InvoiceStatus.PAID,
        isWalletTopUp: false,
        reminded5Days: false,
        productId: { not: null },
        product: { durationDays: { not: null } },
        expiresAt: { gte: from, lte: to },
        ...(cursor != null ? { id: { gt: cursor } } : {}),
      },
      include: { product: true, user: true },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
    });

    if (batch.length === 0) break;

    for (const invoice of batch) {
      cursor = invoice.id;
      if (!invoice.product) continue;

      try {
        await api.sendMessage(
          invoice.user.telegramId.toString(),
          `⚠️ کاربر گرامی، اشتراک "${invoice.product.name}" شما ۵ روز دیگر به پایان می‌رسد. جهت جلوگیری از قطعی، لطفاً نسبت به تمدید آن اقدام نمایید.`,
          { reply_markup: renewalKeyboard() },
        );
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: { reminded5Days: true },
        });
        processed += 1;
      } catch (err) {
        console.warn(`[renewal-cron] 5-day reminder failed for invoice #${invoice.id}:`, err);
      }

      await sleep(SEND_DELAY_MS);
    }

    if (batch.length < BATCH_SIZE) break;
  }

  return processed;
}

async function processLastDayBatch(
  api: Api,
  from: Date,
  to: Date,
): Promise<number> {
  let processed = 0;
  let cursor: number | undefined;

  for (;;) {
    const batch: InvoiceWithRelations[] = await prisma.invoice.findMany({
      where: {
        status: InvoiceStatus.PAID,
        isWalletTopUp: false,
        remindedLastDay: false,
        productId: { not: null },
        product: { durationDays: { not: null } },
        expiresAt: { gte: from, lte: to },
        ...(cursor != null ? { id: { gt: cursor } } : {}),
      },
      include: { product: true, user: true },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
    });

    if (batch.length === 0) break;

    for (const invoice of batch) {
      cursor = invoice.id;
      if (!invoice.product) continue;

      try {
        await api.sendMessage(
          invoice.user.telegramId.toString(),
          `🚨 هشدار روز آخر: اشتراک "${invoice.product.name}" شما امروز به پایان می‌رسد. در صورت عدم تمدید، سرویس شما قطع خواهد شد.`,
          { reply_markup: renewalKeyboard() },
        );
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: { remindedLastDay: true },
        });
        processed += 1;
      } catch (err) {
        console.warn(`[renewal-cron] last-day reminder failed for invoice #${invoice.id}:`, err);
      }

      await sleep(SEND_DELAY_MS);
    }

    if (batch.length < BATCH_SIZE) break;
  }

  return processed;
}

async function runRenewalTick(api: Api): Promise<void> {
  const now = Date.now();
  const fourDaysFromNow = new Date(now + 4 * DAY_MS);
  const fiveDaysFromNow = new Date(now + 5 * DAY_MS);
  const oneDayFromNow = new Date(now + 1 * DAY_MS);

  try {
    const fiveDayCount = await processFiveDayBatch(api, fourDaysFromNow, fiveDaysFromNow);
    const lastDayCount = await processLastDayBatch(api, new Date(now), oneDayFromNow);
    if (fiveDayCount > 0 || lastDayCount > 0) {
      console.log(
        `[renewal-cron] sent ${fiveDayCount} five-day and ${lastDayCount} last-day reminder(s)`,
      );
    }
  } catch (err) {
    console.error("[renewal-cron] tick failed:", err);
  }
}

export function startRenewalCron(api: Api): NodeJS.Timeout {
  void runRenewalTick(api);
  return setInterval(() => {
    void runRenewalTick(api);
  }, CRON_INTERVAL_MS);
}
