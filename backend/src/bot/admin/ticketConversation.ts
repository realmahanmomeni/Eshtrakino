import { InlineKeyboard } from "grammy";
import type { EshtrakinoConversation, SessionContext } from "../context";
import { waitTextOnPanel, panelFromCtx, ensurePanel } from "../conversations/wait";
import { ticketService } from "../../services/tickets/TicketService";
import { Callbacks } from "../keyboards/callbacks";

export async function adminReplyTicketConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  const initPanel = panelFromCtx(ctx);
  if (!initPanel) return;

  const ticketId = ctx.session.adminReplyTicketId;
  if (!ticketId) return;

  const ticket = await conversation.external(() => ticketService.getByIdWithUser(ticketId));
  if (!ticket) {
    await ensurePanel(ctx, "❌ تیکت یافت نشد.", { inline_keyboard: [[{ text: "🔙 بازگشت", callback_data: Callbacks.adminHome }]] }, initPanel);
    return;
  }

  const { text, panel } = await waitTextOnPanel(
    conversation,
    ctx,
    `💬 *پاسخ به تیکت #${ticket.id}*\n👤 کاربر: ${ticket.user.telegramId}\n\nلطفاً متن پاسخ خود را ارسال کنید:`,
    initPanel,
  );

  if (!text) return;

  const adminTgId = BigInt(ctx.from!.id);

  const updatedTicket = await conversation.external(async () => {
    return ticketService.createAdminReply(ticketId, adminTgId, text);
  });

  // Notify the user
  await conversation.external(async () => {
    const userTgId = Number(ticket.user.telegramId);
    const msgText = `🔔 *پاسخ جدید از پشتیبانی (تیکت #${ticket.id})*\n\nپاسخ:\n${text}`;
    try {
      await ctx.api.sendMessage(userTgId, msgText, {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard().text("💬 ارسال پاسخ به پشتیبانی", `user:tkt:reply:${ticket.id}`),
      });
    } catch (e) {
      console.warn("Failed to notify user about ticket reply:", e);
    }
  });

  await ensurePanel(
    ctx,
    `✅ پاسخ شما با موفقیت برای کاربر ارسال شد و وضعیت تیکت به ANSWERED تغییر کرد.`,
    { inline_keyboard: [[{ text: "🔙 بازگشت", callback_data: Callbacks.adminTickets }]] },
    panel
  );
}
