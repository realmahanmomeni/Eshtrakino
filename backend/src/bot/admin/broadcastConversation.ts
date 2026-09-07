import { InlineKeyboard } from "grammy";
import type { EshtrakinoConversation, SessionContext } from "../context";
import { waitCallbackOnPanel, panelFromCtx, ensurePanel } from "../conversations/wait";
import { broadcastService, type BroadcastAudience } from "../../services/broadcast/BroadcastService";
import { Callbacks } from "../keyboards/callbacks";

export async function broadcastConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  const initPanel = panelFromCtx(ctx);
  if (!initPanel) return;

  const audienceKb = new InlineKeyboard()
    .text("👥 همه کاربران", "brd:ALL").row()
    .text("💎 خریداران", "brd:BUYERS").row()
    .text("💰 کیف پول شارژ شده (بدون خرید)", "brd:WALLET_ONLY").row()
    .text("💤 کاربران غیرفعال", "brd:INACTIVE").row()
    .text("❌ لغو", "brd:cancel");

  const { data: audData, panel: p1 } = await waitCallbackOnPanel(
    conversation,
    ctx,
    "📢 *ارسال پیام همگانی*\n\nلطفاً مخاطبان هدف خود را انتخاب کنید:",
    audienceKb,
    initPanel
  );

  if (!audData || audData === "brd:cancel") {
    await ensurePanel(ctx, "❌ عملیات لغو شد.", { inline_keyboard: [[{ text: "🔙 بازگشت", callback_data: Callbacks.adminHome }]] }, p1);
    return;
  }

  const audience = audData.split(":")[1] as BroadcastAudience;
  const { count, userIds } = await conversation.external(() => broadcastService.getAudience(audience));

  if (count === 0) {
    await ensurePanel(ctx, "⚠️ هیچ کاربری در این دسته یافت نشد.", { inline_keyboard: [[{ text: "🔙 بازگشت", callback_data: Callbacks.adminHome }]] }, p1);
    return;
  }

  const cancelKb = new InlineKeyboard().text("❌ لغو", "brd:cancel");
  await ensurePanel(ctx, `🎯 مخاطبان هدف: *${count}* کاربر.\n\nلطفاً پیام خود را ارسال کنید (متن، عکس، یا ویدیو):`, cancelKb, p1);

  // Wait for rich message
  let msgUpdate = null;
  while (true) {
    const update = await conversation.waitFor(["message", "callback_query:data"]);
    
    if (update.callbackQuery?.data === "brd:cancel") {
      try { await update.answerCallbackQuery(); } catch {}
      await ensurePanel(update, "❌ عملیات لغو شد.", { inline_keyboard: [[{ text: "🔙 بازگشت", callback_data: Callbacks.adminHome }]] }, p1);
      return;
    }

    if (update.callbackQuery) {
      try { await update.answerCallbackQuery({ text: "لطفاً پیام خود را ارسال کنید" }); } catch {}
      continue;
    }

    if (update.message?.text === "/cancel") {
      try { await update.api.deleteMessage(update.chat!.id, update.message.message_id); } catch {}
      await ensurePanel(update, "❌ عملیات لغو شد.", { inline_keyboard: [[{ text: "🔙 بازگشت", callback_data: Callbacks.adminHome }]] }, p1);
      return;
    }

    if (update.message) {
      msgUpdate = update.message;
      try { await update.api.deleteMessage(update.chat!.id, update.message.message_id); } catch {}
      break;
    }
  }

  const confirmKb = new InlineKeyboard()
    .text("✅ تایید و شروع ارسال", "brd:confirm").row()
    .text("❌ لغو", "brd:cancel");

  const { data: confirmData, panel: p2 } = await waitCallbackOnPanel(
    conversation,
    ctx,
    `مخاطبان هدف: *${count}* کاربر.\nآیا تایید میکنید؟`,
    confirmKb,
    p1
  );

  if (confirmData !== "brd:confirm") {
    await ensurePanel(ctx, "❌ عملیات لغو شد.", { inline_keyboard: [[{ text: "🔙 بازگشت", callback_data: Callbacks.adminHome }]] }, p2);
    return;
  }

  const finalPanel = await ensurePanel(ctx, "⏳ در حال ارسال...\nلطفاً منتظر بمانید.", { inline_keyboard: [] }, p2);

  // Define the sender function
  const messageIdToCopy = msgUpdate.message_id;
  const fromChatId = msgUpdate.chat.id;

  // We can't await this inside the conversation block if it takes a long time (Grammy timeouts),
  // so we offload it to external and don't await the whole thing if it's too long?
  // Actually conversation.external() waits for it. Telegram limits 30 msg/sec. 1000 users = 33 seconds.
  // It's better to spawn it without await or return immediately.
  // The prompt says: "Edit the admin's status message with a final report upon completion"
  
  // To avoid conversation timeout (Grammy defaults to some timeout for updates, but async execution blocks perfectly fine)
  await conversation.external(async () => {
    await broadcastService.runBroadcast(
      ctx.api,
      userIds,
      async (api, targetChatId) => {
        await api.copyMessage(targetChatId, fromChatId, messageIdToCopy);
      },
      async (success, blocked, errors) => {
        const report = [
          "📊 *گزارش ارسال همگانی:*",
          "",
          `✅ ارسال موفق: ${success}`,
          `🚫 مسدود / غیرفعال: ${blocked}`,
          `❌ خطاهای دیگر: ${errors}`
        ].join("\n");
        await ctx.api.editMessageText(
          finalPanel.chatId,
          finalPanel.messageId,
          report, 
          { 
            parse_mode: "Markdown",
            reply_markup: new InlineKeyboard().text("🔙 بازگشت", Callbacks.adminHome)
          }
        ).catch(console.error);
      }
    );
  });
}
