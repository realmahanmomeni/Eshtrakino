import { GrammyError, InlineKeyboard, type Api, type Context } from "grammy";

export const TELEGRAM_SHOP_TEXT_MAX = 4096;

type EditTextExtra = Parameters<Context["editMessageText"]>[1];

function isEditOptions(value: unknown): value is EditTextExtra {
  return (
    typeof value === "object" &&
    value !== null &&
    ("parse_mode" in value ||
      "reply_markup" in value ||
      "entities" in value ||
      "link_preview_options" in value)
  );
}

function normalizeExtra(extra?: EditTextExtra | InlineKeyboard | unknown): EditTextExtra | undefined {
  if (!extra) return undefined;
  if (typeof extra === "function") {
    try {
      const res = (extra as () => unknown)();
      return normalizeExtra(res);
    } catch {
      return undefined;
    }
  }
  if (isEditOptions(extra)) {
    const opt: EditTextExtra = { ...extra };
    if (typeof (opt as { reply_markup?: unknown }).reply_markup === "function") {
      try {
        (opt as { reply_markup?: unknown }).reply_markup = (
          (opt as { reply_markup?: () => unknown }).reply_markup!
        )();
      } catch {
        (opt as { reply_markup?: unknown }).reply_markup = undefined;
      }
    }
    return opt;
  }
  return { parse_mode: "Markdown", reply_markup: extra as never };
}

export function isMessageNotModified(err: unknown): boolean {
  return (
    err instanceof GrammyError &&
    (err.description?.includes("message is not modified") ||
      err.message.includes("message is not modified"))
  );
}

export function isMessageNotFoundOrDeleted(err: unknown): boolean {
  return (
    err instanceof GrammyError &&
    (err.description?.includes("message to delete not found") ||
      err.description?.includes("message can't be deleted"))
  );
}

export async function safeDeleteMessage(
  api: Api,
  chatId: number | string,
  messageId: number,
): Promise<void> {
  try {
    await api.deleteMessage(chatId, messageId);
  } catch (err) {
    if (isMessageNotFoundOrDeleted(err)) return;
    console.error("Could not delete message:", err);
  }
}

/** Edit text in place, with caption fallback and harmless double-click handling. */
export async function safeEdit(
  ctx: Context,
  text: string,
  extra?: EditTextExtra | InlineKeyboard | unknown,
): Promise<void> {
  const normalized = normalizeExtra(extra);
  try {
    await ctx.editMessageText(text, normalized);
  } catch (err) {
    if (isMessageNotModified(err)) return;
    try {
      let replyMarkup: unknown = normalized?.reply_markup;
      if (typeof replyMarkup === "function") {
        try {
          replyMarkup = (replyMarkup as () => unknown)();
        } catch {
          replyMarkup = undefined;
        }
      }
      // If replyMarkup is not provided, preserve the message's current inline keyboard
      if (!replyMarkup && ctx.callbackQuery?.message && "reply_markup" in ctx.callbackQuery.message) {
        replyMarkup = (ctx.callbackQuery.message as { reply_markup?: unknown }).reply_markup;
      }

      await ctx.editMessageCaption({
        caption: text,
        parse_mode: normalized?.parse_mode ?? "Markdown",
        reply_markup: replyMarkup as any,
      });
    } catch (captionErr) {
      if (isMessageNotModified(captionErr)) return;
      throw err;
    }
  }
}

/** Edit a known bot message by chat/message id (Fluid UI after user text input). */
export async function safeEditById(
  api: Api,
  chatId: number | string,
  messageId: number,
  text: string,
  extra?: EditTextExtra | InlineKeyboard | unknown,
): Promise<void> {
  const normalized = normalizeExtra(extra) ?? { parse_mode: "Markdown" as const };
  try {
    await api.editMessageText(chatId, messageId, text, normalized);
  } catch (err) {
    if (isMessageNotModified(err)) return;
    try {
      let replyMarkup: unknown = normalized.reply_markup;
      if (typeof replyMarkup === "function") {
        try {
          replyMarkup = (replyMarkup as () => unknown)();
        } catch {
          replyMarkup = undefined;
        }
      }
      await api.editMessageCaption(chatId, messageId, {
        caption: text,
        parse_mode: normalized.parse_mode ?? "Markdown",
        reply_markup: replyMarkup as any,
      });
    } catch (captionErr) {
      if (isMessageNotModified(captionErr)) return;
      throw err;
    }
  }
}

/** Edit media in place (photo or video), with text fallback. */
export function clipShopMessageText(text: string, max = TELEGRAM_SHOP_TEXT_MAX): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export function isPhotoOrVideoMessage(ctx: Context): boolean {
  const msg = ctx.callbackQuery?.message ?? ctx.msg;
  if (!msg) return false;
  if ("photo" in msg && msg.photo && msg.photo.length > 0) return true;
  if ("video" in msg && msg.video) return true;
  return false;
}

/**
 * Shop/catalog screens: always plain text. When the panel is a photo (e.g. after main menu),
 * delete it and send a new text message instead of editMessageText.
 */
export async function safePresentShopText(
  ctx: Context,
  text: string,
  extra?: EditTextExtra | InlineKeyboard | unknown,
): Promise<void> {
  const normalized = normalizeExtra(extra);
  const body = clipShopMessageText(text);

  const rememberPanel = (chatId: number, messageId: number): void => {
    const session = (ctx as { session?: { cmsPanelChatId?: number; cmsPanelMessageId?: number } })
      .session;
    if (session) {
      session.cmsPanelChatId = chatId;
      session.cmsPanelMessageId = messageId;
    }
  };

  if (ctx.callbackQuery && isPhotoOrVideoMessage(ctx)) {
    const msg = ctx.callbackQuery.message!;
    const chatId = msg.chat.id;
    const messageId = msg.message_id;
    await safeDeleteMessage(ctx.api, chatId, messageId);
    const sent = await ctx.reply(body, normalized ?? { parse_mode: "Markdown" });
    rememberPanel(sent.chat.id, sent.message_id);
    return;
  }

  if (ctx.callbackQuery) {
    await safeEdit(ctx, body, normalized);
    const msg = ctx.callbackQuery.message;
    if (msg) rememberPanel(msg.chat.id, msg.message_id);
    return;
  }

  const sent = await ctx.reply(body, normalized ?? { parse_mode: "Markdown" });
  rememberPanel(sent.chat.id, sent.message_id);
}

export async function safeEditMedia(
  ctx: Context,
  media: string,
  caption: string,
  reply_markup?: InlineKeyboard | (() => InlineKeyboard) | unknown,
  mediaType: "photo" | "video" = "photo",
  options?: { parse_mode?: "Markdown" | "HTML" },
): Promise<void> {
  let finalMarkup: unknown = reply_markup;
  if (typeof finalMarkup === "function") {
    try {
      finalMarkup = (finalMarkup as () => unknown)();
    } catch {
      finalMarkup = undefined;
    }
  }
  // Preserve existing reply_markup if none provided
  if (!finalMarkup && ctx.callbackQuery?.message && "reply_markup" in ctx.callbackQuery.message) {
    finalMarkup = (ctx.callbackQuery.message as { reply_markup?: never }).reply_markup;
  }

  const parse_mode =
    options?.parse_mode ?? (/<[a-z][\s\S]*>/i.test(caption) ? "HTML" : "Markdown");

  try {
    await ctx.editMessageMedia(
      {
        type: mediaType,
        media,
        caption,
        parse_mode,
      },
      finalMarkup ? { reply_markup: finalMarkup as never } : undefined,
    );
  } catch (err) {
    if (isMessageNotModified(err)) return;
    console.warn("[safeEditMedia] media edit failed, falling back to text:", err);
    await safeEdit(ctx, caption, {
      parse_mode,
      reply_markup: finalMarkup as never,
    });
  }
}
