import { GrammyError, InlineKeyboard, type Api, type Context } from "grammy";

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
  if (isEditOptions(extra)) return extra;
  return { parse_mode: "Markdown", reply_markup: extra as never };
}

export function isMessageNotModified(err: unknown): boolean {
  return (
    err instanceof GrammyError &&
    (err.description?.includes("message is not modified") ||
      err.message.includes("message is not modified"))
  );
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
      await ctx.editMessageCaption({
        caption: text,
        parse_mode: normalized && "parse_mode" in normalized ? normalized.parse_mode : undefined,
        reply_markup:
          normalized && "reply_markup" in normalized ? normalized.reply_markup : undefined,
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
      await api.editMessageCaption(chatId, messageId, {
        caption: text,
        parse_mode: normalized.parse_mode,
        reply_markup: normalized.reply_markup,
      });
    } catch (captionErr) {
      if (isMessageNotModified(captionErr)) return;
      throw err;
    }
  }
}

/** Edit media in place (photo or video), with text fallback. */
export async function safeEditMedia(
  ctx: Context,
  media: string,
  caption: string,
  reply_markup?: InlineKeyboard,
  mediaType: "photo" | "video" = "photo",
): Promise<void> {
  try {
    await ctx.editMessageMedia(
      {
        type: mediaType,
        media,
        caption,
        parse_mode: "Markdown",
      },
      { reply_markup },
    );
  } catch (err) {
    if (isMessageNotModified(err)) return;
    console.warn("[safeEditMedia] media edit failed, falling back to text:", err);
    await safeEdit(ctx, caption, {
      parse_mode: "Markdown",
      reply_markup,
    });
  }
}
