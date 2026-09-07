import type { EshtrakinoConversation, SessionContext } from "../context";
import { discountService } from "../../services/discount/DiscountService";
import { invoiceService } from "../../services/invoices/InvoiceService";
import { buildCheckoutPaymentKeyboard } from "../keyboards/paymentChoice";
import { formatToman } from "../../lib/money";
import { toPlain } from "../../lib/plain";
import { ensurePanel, panelFromCtx, type PanelRef } from "./wait";
import { ConvCb } from "../admin/keyboards";
import { safeDeleteMessage } from "../utils/safeEdit";

export async function applyDiscountConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  let panel: PanelRef | null = panelFromCtx(ctx);
  if (!panel && ctx.chat?.id) {
    const msgId = ctx.callbackQuery?.message?.message_id;
    if (msgId) {
      panel = { chatId: ctx.chat.id, messageId: msgId };
    }
  }

  let invoiceId =
    ctx.session.discountInvoiceId ??
    ctx.session.pendingInvoiceId;

  if (!invoiceId && ctx.callbackQuery?.data) {
    const m = ctx.callbackQuery.data.match(/(\d+)$/);
    if (m) invoiceId = Number(m[1]);
  }

  if (!invoiceId) {
    const prompt = "⚠️ فاکتور معتبری برای اعمال تخفیف یافت نشد.";
    panel = await ensurePanel(ctx, prompt, { inline_keyboard: [] }, panel);
    return;
  }

  const invoice = await conversation.external(async () => {
    const inv = await invoiceService.getById(invoiceId);
    return inv ? toPlain(inv) : null;
  });

  if (!invoice || invoice.status !== "PENDING") {
    const prompt = "⚠️ این فاکتور معتبر نیست یا در وضعیت در انتظار پرداخت قرار ندارد.";
    panel = await ensurePanel(ctx, prompt, { inline_keyboard: [] }, panel);
    return;
  }

  const cancelKb = {
    inline_keyboard: [[{ text: "🔴 بازگشت", callback_data: ConvCb.cancel }]],
  };

  while (true) {
    const currentPrice = Number(invoice.amount);

    const prompt = [
      "🏷 *اعمال کد تخفیف*",
      "",
      `🧾 شماره فاکتور: *#${invoice.id}*`,
      `💵 مبلغ فعلی: *${formatToman(currentPrice)}*`,
      "",
      "لطفاً کد تخفیف خود را ارسال کنید:",
    ].join("\n");

    panel = await ensurePanel(ctx, prompt, cancelKb, panel);

    const update = await conversation.waitFor(["message:text", "callback_query:data"]);

    // Handle Back / Cancel
    if (update.callbackQuery?.data === ConvCb.cancel) {
      try {
        await update.answerCallbackQuery({ text: "بازگشت" });
      } catch {}

      const user = await conversation.external(async () => {
        const u = await invoiceService.ensureUser(BigInt(ctx.from!.id));
        return toPlain(u);
      });

      const restoredKb = await conversation.external(async () => {
        return buildCheckoutPaymentKeyboard(
          invoice.id,
          formatToman(user.balance),
          { hasDiscount: Boolean((invoice as any).discountCode) },
        );
      });

      const invoiceMsg = [
        "💳 *انتخاب روش پرداخت*",
        "",
        `🧾 فاکتور: *#${invoice.id}*`,
        `💵 مبلغ: *${formatToman(invoice.amount)}*`,
        "",
        "روش پرداخت را انتخاب کنید:",
      ].join("\n");

      await ensurePanel(update, invoiceMsg, restoredKb, panel);
      return;
    }

    if (update.callbackQuery) {
      try {
        await update.answerCallbackQuery({ text: "لطفاً کد تخفیف را متنی ارسال کنید" });
      } catch {}
      continue;
    }

    const rawText = (update.message?.text ?? "").trim();
    if (rawText === "/cancel") {
      const user = await conversation.external(async () => {
        const u = await invoiceService.ensureUser(BigInt(ctx.from!.id));
        return toPlain(u);
      });

      const restoredKb = await conversation.external(async () => {
        return buildCheckoutPaymentKeyboard(
          invoice.id,
          formatToman(user.balance),
          { hasDiscount: Boolean((invoice as any).discountCode) },
        );
      });

      const invoiceMsg = [
        "💳 *انتخاب روش پرداخت*",
        "",
        `🧾 فاکتور: *#${invoice.id}*`,
        `💵 مبلغ: *${formatToman(invoice.amount)}*`,
        "",
        "روش پرداخت را انتخاب کنید:",
      ].join("\n");

      await ensurePanel(update, invoiceMsg, restoredKb, panel);
      return;
    }

    if (!rawText) continue;

    // Delete customer's text message to keep clean UI
    if (update.chat?.id && update.message?.message_id) {
      await safeDeleteMessage(update.api, update.chat.id, update.message.message_id);
    }

    const codeStr = rawText.toUpperCase();

    try {
      const result = await conversation.external(async () => {
        const res = await discountService.applyDiscountToInvoice(
          invoice.id,
          codeStr,
          invoice.productId,
        );
        return {
          invoice: toPlain(res.invoice),
          calc: toPlain(res.calc),
        };
      });

      const user = await conversation.external(async () => {
        const u = await invoiceService.ensureUser(BigInt(ctx.from!.id));
        return toPlain(u);
      });

      const successMsg = [
        "✅ *کد تخفیف با موفقیت اعمال شد!*",
        "",
        `▫️ درصد تخفیف: *${result.calc.percentage}٪*`,
        `▫️ مبلغ کسر شده: *${formatToman(result.calc.discountAmount)}*`,
        `▫️ مبلغ نهایی قابل پرداخت: *${formatToman(result.calc.finalAmount)}*`,
      ].join("\n");

      await ctx.reply(successMsg, { parse_mode: "Markdown" });

      // Re-render refreshed invoice and payment keyboard
      const refreshedKb = await conversation.external(async () => {
        return buildCheckoutPaymentKeyboard(
          invoice.id,
          formatToman(user.balance),
          { hasDiscount: true },
        );
      });

      const invoiceMsg = [
        "💳 *انتخاب روش پرداخت*",
        "",
        `🧾 فاکتور: *#${invoice.id}*`,
        `💵 مبلغ اولیه: ~${formatToman((result.invoice as any).originalAmount)}~`,
        `🏷 تخفیف (${result.calc.percentage}٪): -${formatToman(result.calc.discountAmount)}`,
        `💵 مبلغ نهایی: *${formatToman(result.invoice.amount)}*`,
        "",
        "روش پرداخت را انتخاب کنید:",
      ].join("\n");

      panel = await ensurePanel(ctx, invoiceMsg, refreshedKb, panel);
      return;
    } catch (err: any) {
      const errMsg = err?.message || "کد تخفیف وارد شده معتبر نیست.";
      const retryPrompt = [
        `❌ *خطا:* ${errMsg}`,
        "",
        "لطفاً کد تخفیف دیگری ارسال کنید یا دکمه بازگشت را بزنید:",
      ].join("\n");

      panel = await ensurePanel(ctx, retryPrompt, cancelKb, panel);
    }
  }
}
