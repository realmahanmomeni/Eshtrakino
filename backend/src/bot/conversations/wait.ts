import type { EshtrakinoConversation, SessionContext } from "../context";
import { ConvCb } from "../admin/keyboards";
import { isMessageNotModified, safeEdit, safeEditById } from "../utils/safeEdit";

const cancelKeyboard = {
  inline_keyboard: [[{ text: "❌ لغو", callback_data: ConvCb.cancel }]],
};

/** Stable reference to the single bot panel message used for Fluid UI. */
export type PanelRef = { chatId: number; messageId: number };

export function panelFromCtx(ctx: SessionContext): PanelRef | null {
  const msg = ctx.callbackQuery?.message ?? ctx.msg;
  if (msg && "message_id" in msg && msg.chat) {
    return { chatId: msg.chat.id, messageId: msg.message_id };
  }
  return null;
}

/** Show text on an existing panel, or send once and return the new panel ref. */
export async function ensurePanel(
  ctx: SessionContext,
  text: string,
  reply_markup: unknown,
  panel?: PanelRef | null,
): Promise<PanelRef> {
  if (panel) {
    try {
      await safeEditById(ctx.api, panel.chatId, panel.messageId, text, {
        parse_mode: "Markdown",
        reply_markup: reply_markup as never,
      });
      return panel;
    } catch (err) {
      if (isMessageNotModified(err)) return panel;
      console.warn("[ensurePanel] editById failed, falling back:", err);
    }
  }

  try {
    await safeEdit(ctx, text, {
      parse_mode: "Markdown",
      reply_markup: reply_markup as never,
    });
    const fromCtx = panelFromCtx(ctx);
    if (fromCtx) return fromCtx;
  } catch {
    /* fall through to reply */
  }

  const sent = await ctx.reply(text, {
    parse_mode: "Markdown",
    reply_markup: reply_markup as never,
  });
  return { chatId: sent.chat.id, messageId: sent.message_id };
}

async function deleteUserMessage(ctx: SessionContext): Promise<void> {
  const chatId = ctx.chat?.id;
  const messageId = ctx.message?.message_id;
  if (chatId == null || messageId == null) return;
  try {
    await ctx.api.deleteMessage(chatId, messageId);
  } catch (err) {
    console.error("Could not delete user message:", err);
  }
}

export async function waitText(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
  prompt: string,
  options?: { markdown?: boolean },
): Promise<string | null> {
  await ctx.reply(prompt, {
    parse_mode: options?.markdown === false ? undefined : "Markdown",
    reply_markup: cancelKeyboard,
  });

  while (true) {
    const update = await conversation.waitFor(["message:text", "callback_query:data"]);

    if (update.callbackQuery?.data === ConvCb.cancel) {
      try {
        await update.answerCallbackQuery({ text: "لغو شد" });
      } catch {
        /* ignore */
      }
      try {
        await safeEdit(update, "❌ عملیات لغو شد.");
      } catch {
        /* ignore */
      }
      return null;
    }

    if (update.callbackQuery) {
      try {
        await update.answerCallbackQuery({ text: "لطفاً متن بفرستید" });
      } catch {
        /* ignore */
      }
      continue;
    }

    const text = (update.message?.text ?? "").trim();
    if (text === "/cancel") return null;
    if (text) return text;
  }
}

/**
 * Fluid text wait: edits the panel prompt, deletes the user's reply, keeps one bot message.
 */
export async function waitTextOnPanel(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
  prompt: string,
  panel: PanelRef,
): Promise<{ text: string | null; panel: PanelRef }> {
  const active = await ensurePanel(ctx, prompt, cancelKeyboard, panel);

  while (true) {
    const update = await conversation.waitFor(["message:text", "callback_query:data"]);

    if (update.callbackQuery?.data === ConvCb.cancel) {
      try {
        await update.answerCallbackQuery({ text: "لغو شد" });
      } catch {
        /* ignore */
      }
      await ensurePanel(update, "❌ عملیات لغو شد.", { inline_keyboard: [] }, active);
      return { text: null, panel: active };
    }

    if (update.callbackQuery) {
      try {
        await update.answerCallbackQuery({ text: "لطفاً متن بفرستید" });
      } catch {
        /* ignore */
      }
      continue;
    }

    const text = (update.message?.text ?? "").trim();
    if (text === "/cancel") {
      await ensurePanel(update, "❌ عملیات لغو شد.", { inline_keyboard: [] }, active);
      return { text: null, panel: active };
    }
    if (!text) continue;

    await deleteUserMessage(update);
    return { text, panel: active };
  }
}

export async function waitCallback(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
  prompt: string,
  reply_markup: unknown,
): Promise<string | null> {
  const result = await waitCallbackOnPanel(conversation, ctx, prompt, reply_markup, null);
  return result.data;
}

/** Fluid callback wait: keeps a single editable panel message. */
export async function waitCallbackOnPanel(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
  prompt: string,
  reply_markup: unknown,
  panel?: PanelRef | null,
): Promise<{ data: string | null; panel: PanelRef }> {
  const active = await ensurePanel(ctx, prompt, reply_markup, panel);

  while (true) {
    const update = await conversation.waitFor(["callback_query:data", "message:text"]);
    if (update.message?.text === "/cancel") {
      await deleteUserMessage(update);
      await ensurePanel(update, "❌ عملیات لغو شد.", { inline_keyboard: [] }, active);
      return { data: null, panel: active };
    }

    const data = update.callbackQuery?.data;
    if (!data) continue;

    try {
      await update.answerCallbackQuery();
    } catch {
      /* ignore */
    }

    if (data === ConvCb.cancel) {
      await ensurePanel(update, "❌ عملیات لغو شد.", { inline_keyboard: [] }, active);
      return { data: null, panel: active };
    }

    return { data, panel: active };
  }
}

/**
 * Wait for a receipt photo. Uses waitFor filters so photo updates are not missed.
 * Text / non-image → nudge and keep waiting. Cancel → null.
 */
export async function waitPhoto(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
  prompt: string,
): Promise<string | null> {
  await ctx.reply(prompt, {
    parse_mode: "Markdown",
    reply_markup: cancelKeyboard,
  });

  while (true) {
    const update = await conversation.waitFor([
      "message:photo",
      "message:document",
      "message:text",
      "callback_query:data",
    ]);

    // Cancel button
    if (update.callbackQuery?.data === ConvCb.cancel) {
      try {
        await update.answerCallbackQuery({ text: "لغو شد" });
      } catch {
        /* ignore */
      }
      try {
        await safeEdit(update, "❌ عملیات لغو شد.");
      } catch {
        /* ignore */
      }
      return null;
    }

    if (update.callbackQuery) {
      try {
        await update.answerCallbackQuery({
          text: "لطفا تصویر فیش را بفرستید",
        });
      } catch {
        /* ignore */
      }
      await ctx.reply(
        ["⚠️ *فرمت نامعتبر*", "", "لطفا فقط تصویر فیش واریزی را ارسال کنید."].join(
          "\n",
        ),
        { parse_mode: "Markdown" },
      );
      continue;
    }

    // Telegram photo (gallery / camera)
    const photos = update.message?.photo;
    if (photos && photos.length > 0) {
      return photos[photos.length - 1]!.file_id;
    }

    // Image sent as document/file
    const doc = update.message?.document;
    if (doc?.mime_type?.startsWith("image/")) {
      return doc.file_id;
    }

    const text = (update.message?.text ?? "").trim();
    if (text === "/cancel") return null;

    // Text or non-image document
    await ctx.reply(
      ["⚠️ *فرمت نامعتبر*", "", "لطفا فقط تصویر فیش واریزی را ارسال کنید."].join(
        "\n",
      ),
      { parse_mode: "Markdown" },
    );
  }
}

/**
 * Wait for an optional product banner photo.
 * Skip via inline button, /cancel, or text: no / skip / بدون بنر
 */
export async function waitOptionalPhoto(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
  prompt: string,
): Promise<string | null> {
  const skipKeyboard = {
    inline_keyboard: [
      [{ text: "⏭ بدون بنر", callback_data: ConvCb.skipPhoto }],
      [{ text: "❌ لغو", callback_data: ConvCb.cancel }],
    ],
  };

  await ctx.reply(prompt, {
    parse_mode: "Markdown",
    reply_markup: skipKeyboard,
  });

  while (true) {
    const update = await conversation.waitFor([
      "message:photo",
      "message:document",
      "message:text",
      "callback_query:data",
    ]);

    if (update.callbackQuery?.data === ConvCb.cancel) {
      try {
        await update.answerCallbackQuery({ text: "لغو شد" });
      } catch {
        /* ignore */
      }
      try {
        await safeEdit(update, "❌ عملیات لغو شد.");
      } catch {
        /* ignore */
      }
      return null;
    }

    if (update.callbackQuery?.data === ConvCb.skipPhoto) {
      try {
        await update.answerCallbackQuery({ text: "بدون بنر" });
      } catch {
        /* ignore */
      }
      return "";
    }

    if (update.callbackQuery) {
      try {
        await update.answerCallbackQuery({ text: "عکس بفرستید یا «بدون بنر» را بزنید" });
      } catch {
        /* ignore */
      }
      continue;
    }

    const photos = update.message?.photo;
    if (photos && photos.length > 0) {
      return photos[photos.length - 1]!.file_id;
    }

    const doc = update.message?.document;
    if (doc?.mime_type?.startsWith("image/")) {
      return doc.file_id;
    }

    const text = (update.message?.text ?? "").trim();
    if (text === "/cancel") return null;

    const lower = text.toLowerCase();
    if (
      lower === "no" ||
      lower === "skip" ||
      lower === "none" ||
      text === "خیر" ||
      text === "نه" ||
      text === "بدون بنر" ||
      text === "-"
    ) {
      return "";
    }

    await ctx.reply(
      [
        "⚠️ *فرمت نامعتبر*",
        "",
        "لطفا تصویر بنر را بفرستید، یا «بدون بنر» را انتخاب کنید.",
      ].join("\n"),
      { parse_mode: "Markdown" },
    );
  }
}
