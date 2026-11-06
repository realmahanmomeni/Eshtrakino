import type { Api } from "grammy";
import { Decimal } from "@prisma/client/runtime/library";
import { formatToman } from "../../lib/money";
import type { AdminBalanceAdjustmentResult } from "./WalletService";

function formatTomanAmountOnly(amount: Decimal | number): string {
  const n = Math.round(Number(new Decimal(amount).toFixed(0)));
  return n.toLocaleString("en-US");
}

export function formatAdminWalletIncreaseNotification(
  delta: Decimal | number,
  newBalance: Decimal | number,
): string {
  const deltaLabel = formatTomanAmountOnly(delta);
  const balanceLabel = formatToman(newBalance);
  return [
    "🎉 <b>افزایش موجودی کیف پول</b>",
    "━━━━━━━━━━━━━━━━━━",
    `💳 مبلغ <b>${deltaLabel} تومان</b> توسط مدیریت به کیف پول شما اضافه شد.`,
    "",
    `💰 <b>موجودی فعلی شما:</b> <b>${balanceLabel}</b>`,
    "━━━━━━━━━━━━━━━━━━",
    "🛍 هم‌اکنون می‌توانید از موجودی خود برای خرید در فروشگاه استفاده کنید.",
  ].join("\n");
}

export function formatAdminWalletDecreaseNotification(
  delta: Decimal | number,
  newBalance: Decimal | number,
): string {
  const absDelta = formatTomanAmountOnly(new Decimal(String(delta)).abs());
  const balanceLabel = formatToman(newBalance);
  return [
    "📉 <b>کسر از موجودی کیف پول</b>",
    "━━━━━━━━━━━━━━━━━━",
    `💳 مبلغ <b>${absDelta} تومان</b> از کیف پول شما کسر گردید.`,
    "",
    `💰 <b>موجودی فعلی شما:</b> <b>${balanceLabel}</b>`,
    "━━━━━━━━━━━━━━━━━━",
  ].join("\n");
}

export function formatAdminWalletAdjustmentNotification(
  result: AdminBalanceAdjustmentResult,
): string {
  if (result.delta > 0) {
    return formatAdminWalletIncreaseNotification(result.delta, result.balance);
  }
  return formatAdminWalletDecreaseNotification(result.delta, result.balance);
}

export async function sendAdminBalanceChangeNotification(
  api: Api,
  result: AdminBalanceAdjustmentResult,
): Promise<{ sent: boolean; errorMessage?: string }> {
  const text = formatAdminWalletAdjustmentNotification(result);
  try {
    await api.sendMessage(result.telegramId, text, { parse_mode: "HTML" });
    return { sent: true };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.warn(
      `[Wallet] Admin balance notify failed for tg=${result.telegramId.toString()}:`,
      errorMessage,
    );
    return { sent: false, errorMessage };
  }
}
