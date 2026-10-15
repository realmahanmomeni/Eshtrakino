import { InlineKeyboard } from "grammy";
import type { BotContext } from "../context";
import { Callbacks } from "../keyboards/callbacks";
import { invoiceService } from "../../services/invoices/InvoiceService";
import {
  cancelCheckoutState,
  type PrePaymentGuardResult,
} from "../../services/catalog/prePaymentGuardService";

export const PRE_PAYMENT_OUT_OF_STOCK_MSG =
  "❌ متاسفانه در این لحظه موجودی این اشتراک به اتمام رسید. لطفاً سایر پلن‌ها را بررسی کنید.";

export function priceChangeConfirmKeyboard(invoiceId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ تایید و پرداخت با مبلغ جدید", Callbacks.payConfirmNewPrice(invoiceId))
    .row()
    .text("❌ لغو", Callbacks.payCancelNewPrice(invoiceId));
}

export function priceChangeConfirmKeyboardForProduct(productId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ تایید و پرداخت با مبلغ جدید", Callbacks.buyConfirmNewPrice(productId))
    .row()
    .text("❌ لغو", Callbacks.buyCancelNewPrice);
}

/**
 * Handles guard failures (OOS / price confirm). Returns true when checkout/payment may proceed.
 */
export async function handlePrePaymentGuardResult(
  ctx: BotContext,
  userId: number,
  guard: PrePaymentGuardResult,
): Promise<boolean> {
  if (guard.status === "SKIP" || guard.status === "OK") {
    return true;
  }

  if (guard.status === "OUT_OF_STOCK") {
    await cancelCheckoutState(userId, ctx.session);
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: PRE_PAYMENT_OUT_OF_STOCK_MSG, show_alert: true });
    }
    await ctx.reply(PRE_PAYMENT_OUT_OF_STOCK_MSG);
    return false;
  }

  if (guard.status === "PRICE_CHANGED") {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery();
    }
    const kb =
      guard.invoiceId != null
        ? priceChangeConfirmKeyboard(guard.invoiceId)
        : priceChangeConfirmKeyboardForProduct(
            guard.productId ?? ctx.session.checkoutProductId ?? 0,
          );
    await ctx.reply(guard.message, { reply_markup: kb });
    return false;
  }

  return true;
}
