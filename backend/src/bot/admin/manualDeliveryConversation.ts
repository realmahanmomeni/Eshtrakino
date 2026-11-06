import { InlineKeyboard } from "grammy";
import type { EshtrakinoConversation, SessionContext } from "../context";
import { manualFulfillmentService } from "../../services/fulfillment/ManualFulfillmentService";
import { isMessageNotModified } from "../utils/safeEdit";
import { Callbacks } from "../keyboards/callbacks";
import { supplierOrderAlertService } from "../../services/suppliers/SupplierOrderAlertService";

function hasDeliverableMedia(message: {
  photo?: unknown[];
  document?: unknown;
  video?: unknown;
  voice?: unknown;
  video_note?: unknown;
  sticker?: unknown;
  animation?: unknown;
}): boolean {
  return Boolean(
    message.photo?.length ||
      message.document ||
      message.video ||
      message.voice ||
      message.video_note ||
      message.sticker ||
      message.animation,
  );
}

function extractDeliveryTextFromMessage(message: {
  text?: string;
  caption?: string;
  photo?: unknown[];
  document?: { file_name?: string };
  video?: unknown;
  voice?: unknown;
}): string | null {
  const text = (message.text ?? message.caption ?? "").trim();
  if (text) return text;
  if (message.photo?.length) {
    return message.caption?.trim() || "📎 فایل تصویری تحویل (بدون توضیح متنی)";
  }
  if (message.document) {
    const name = message.document.file_name?.trim();
    return name
      ? `📎 فایل پیوست: ${name}${message.caption?.trim() ? `\n${message.caption.trim()}` : ""}`
      : message.caption?.trim() || "📎 فایل پیوست تحویل";
  }
  return null;
}

function isGroupChat(ctx: SessionContext): boolean {
  const t = ctx.chat?.type;
  return t === "group" || t === "supergroup";
}

function buildDeliveryPrompt(invoiceId: number, inGroup: boolean): string {
  const lines = [
    `لطفاً لینک دسترسی، اکانت، متن، تصویر، فایل، ویدیو یا ویس تحویل محصول را برای فاکتور #${invoiceId} ارسال کنید:`,
    "",
  ];
  if (inGroup) {
    lines.push(
      "💡 در گروه گزارش، حتماً *Reply* به پیام درخواست ربات بزنید (یا از دکمه انصراف استفاده کنید).",
      "",
    );
  }
  lines.push("(برای انصراف /cancel را بفرستید یا دکمه ❌ انصراف را بزنید)");
  return lines.join("\n");
}

async function clearManualDeliverSession(
  conversation: EshtrakinoConversation,
): Promise<void> {
  await conversation.external((c) => {
    c.session.adminManualDeliverInvoiceId = undefined;
    c.session.adminManualDeliverLogChatId = undefined;
    c.session.adminManualDeliverLogMessageId = undefined;
  });
}

async function persistManualDeliverContext(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
  invoiceId: number,
): Promise<void> {
  await conversation.external((c) => {
    c.session.adminManualDeliverInvoiceId = invoiceId;
    if (ctx.callbackQuery?.message) {
      c.session.adminManualDeliverLogChatId = ctx.callbackQuery.message.chat.id;
      c.session.adminManualDeliverLogMessageId = ctx.callbackQuery.message.message_id;
    }
  });
}

async function sendDeliveryPrompt(
  ctx: SessionContext,
  invoiceId: number,
): Promise<void> {
  const inGroup = isGroupChat(ctx);
  const prompt = buildDeliveryPrompt(invoiceId, inGroup);
  const actionKb = new InlineKeyboard()
    .text("✅ ثبت تحویل بدون ارسال پیام", Callbacks.adminMarkDelivered(invoiceId))
    .row()
    .text("❌ انصراف", Callbacks.adminManualDeliverCancel);

  if (inGroup) {
    await ctx.reply(prompt, {
      parse_mode: "Markdown",
      reply_markup: {
        force_reply: true,
        input_field_placeholder: "لینک، متن یا فایل تحویل…",
      },
    });
    await ctx.reply("⬇️ یا یکی از دکمه‌های زیر:", {
      reply_markup: actionKb,
    });
    return;
  }

  await ctx.reply(prompt, {
    parse_mode: "Markdown",
    reply_markup: actionKb,
  });
}

export async function manualDeliveryConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  let invoiceId = 0;
  if (ctx.callbackQuery?.data?.startsWith("adm:manual_deliver:")) {
    invoiceId = Number(ctx.callbackQuery.data.split(":")[2]);
  } else {
    invoiceId = (await conversation.external((c) => c.session.adminManualDeliverInvoiceId)) ?? 0;
  }

  if (!invoiceId || Number.isNaN(invoiceId)) {
    await ctx.reply("⚠️ شماره فاکتور برای تحویل دستی مشخص نیست.");
    return;
  }

  const logChatId = await conversation.external((c) => c.session.adminManualDeliverLogChatId);
  const logMessageId = await conversation.external((c) => c.session.adminManualDeliverLogMessageId);

  await persistManualDeliverContext(conversation, ctx, invoiceId);
  const originMsg = ctx.callbackQuery?.message;
  if (originMsg) {
    await conversation.external(async () => {
      await supplierOrderAlertService.refreshLegacyCardKeyboard(
        ctx.api,
        invoiceId,
        originMsg.chat.id,
        originMsg.message_id,
      );
    });
  }
  await sendDeliveryPrompt(ctx, invoiceId);

  let deliveryText: string | null = null;
  let copyMessageFrom: { chatId: number; messageId: number } | undefined;

  while (!deliveryText) {
    const update = await conversation.waitFor([
      "message:text",
      "message:photo",
      "message:document",
      "message:video",
      "message:voice",
      "message:video_note",
      "message:sticker",
      "message:animation",
      "callback_query:data",
    ]);

    if (update.callbackQuery) {
      const data = update.callbackQuery.data ?? "";
      try {
        await update.answerCallbackQuery().catch(() => {});
      } catch {
        /* ignore */
      }

      if (data === Callbacks.adminManualDeliverCancel) {
        await clearManualDeliverSession(conversation);
        await update.reply("❌ تحویل دستی لغو شد.");
        return;
      }

      const switchMatch = /^adm:manual_deliver:(\d+)$/.exec(data);
      if (switchMatch) {
        invoiceId = Number(switchMatch[1]);
        await persistManualDeliverContext(conversation, update, invoiceId);
        await sendDeliveryPrompt(update, invoiceId);
        continue;
      }

      if (data.startsWith("adm:")) {
        await clearManualDeliverSession(conversation);
        await conversation.halt({ next: true });
      }

      continue;
    }

    const rawText = (update.message?.text ?? "").trim();
    if (rawText === "/cancel") {
      await clearManualDeliverSession(conversation);
      await update.reply("❌ تحویل دستی لغو شد.");
      return;
    }

    if (update.message) {
      const msg = update.message;
      const hasMedia = hasDeliverableMedia(msg);
      copyMessageFrom = hasMedia
        ? { chatId: msg.chat.id, messageId: msg.message_id }
        : undefined;
      deliveryText = extractDeliveryTextFromMessage(msg);
      if (!deliveryText && hasMedia) {
        deliveryText = "📎 محتوای تحویل در پیام ضمیمه ارسال شده است.";
      }
    }
    if (!deliveryText) {
      await update.reply("⚠️ لطفاً متن، تصویر (با کپشن) یا فایل تحویل را ارسال کنید.");
    }
  }

  const editAdminMessage = async (text: string) => {
    const chatId =
      logChatId ??
      (await conversation.external((c) => c.session.adminManualDeliverLogChatId));
    const messageId =
      logMessageId ??
      (await conversation.external((c) => c.session.adminManualDeliverLogMessageId));
    if (chatId != null && messageId != null) {
      try {
        await ctx.api.editMessageText(chatId, messageId, text, {
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: [] },
        });
      } catch (err) {
        if (!isMessageNotModified(err)) {
          console.warn("[manualDelivery] edit admin notify failed:", err);
        }
      }
    }
    await supplierOrderAlertService.syncSupplierOrderResolution(ctx.api, invoiceId, text);
  };

  const result = await manualFulfillmentService.completeManualDelivery(
    ctx.api,
    invoiceId,
    deliveryText,
    { editAdminMessage, copyMessageFrom },
  );

  await clearManualDeliverSession(conversation);

  if (!result.ok) {
    await ctx.reply(`⚠️ ${result.message}`);
    return;
  }

  await ctx.reply("✅ تحویل دستی با موفقیت انجام شد و برای مشتری ارسال گردید.");
}
