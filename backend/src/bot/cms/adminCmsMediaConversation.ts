import { InlineKeyboard } from "grammy";
import type { EshtrakinoConversation, SessionContext } from "../context";
import {
  ensurePanel,
  panelFromCtx,
} from "../conversations/wait";
import { ConvCb } from "../admin/keyboards";
import {
  isPageKey,
  pageContentService,
  type PageMediaType,
  type PageKey,
} from "../../services/cms/PageContentService";
import { presentCmsPage } from "./presentPage";

async function deleteAdminInput(ctx: SessionContext): Promise<void> {
  const chatId = ctx.chat?.id;
  const messageId = ctx.message?.message_id;
  if (chatId == null || messageId == null) return;
  try {
    await ctx.api.deleteMessage(chatId, messageId);
  } catch (err) {
    console.error("Could not delete admin media input:", err);
  }
}

/**
 * Fluid UI: set page banner (photo or video file_id).
 * Deletes admin media message; remounts the CMS page with the new banner.
 */
export async function adminCmsMediaConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  try {
    const pageKey = await conversation.external((c) => {
      const raw = c.session.adminCmsPageKey;
      return isPageKey(raw) ? raw : null;
    });

    if (!pageKey) {
      await ctx.reply("⚠️ صفحه هدف مشخص نیست. دوباره از تنظیمات صفحه وارد شوید.");
      return;
    }

    let panel = panelFromCtx(ctx);
    const cancelKb = new InlineKeyboard().text("❌ لغو", ConvCb.cancel);
    const prompt = [
      "🖼 *تنظیم بنر صفحه*",
      "",
      `صفحه: \`${pageKey}\``,
      "",
      "یک *عکس* یا *ویدیو* برای بنر این صفحه بفرستید.",
      "",
      "(برای انصراف /cancel را بفرستید)",
    ].join("\n");

    panel = await ensurePanel(ctx, prompt, cancelKb, panel);

    while (true) {
      const update = await conversation.waitFor([
        "message:photo",
        "message:video",
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
        await conversation.external((c) => {
          c.session.adminCmsPageKey = undefined;
        });
        await presentCmsPage(update, pageKey, "edit", "❌ تنظیم بنر لغو شد.");
        return;
      }

      if (update.callbackQuery) {
        try {
          await update.answerCallbackQuery({ text: "عکس یا ویدیو بفرستید" });
        } catch {
          /* ignore */
        }
        continue;
      }

      const text = (update.message?.text ?? "").trim();
      if (text === "/cancel") {
        await conversation.external((c) => {
          c.session.adminCmsPageKey = undefined;
        });
        await presentCmsPage(update, pageKey, "edit", "❌ تنظیم بنر لغو شد.");
        return;
      }

      let mediaFileId: string | null = null;
      let mediaType: PageMediaType | null = null;

      const photos = update.message?.photo;
      if (photos && photos.length > 0) {
        mediaFileId = photos[photos.length - 1]!.file_id;
        mediaType = "photo";
      }

      const video = update.message?.video;
      if (!mediaFileId && video?.file_id) {
        mediaFileId = video.file_id;
        mediaType = "video";
      }

      const doc = update.message?.document;
      if (!mediaFileId && doc?.mime_type?.startsWith("image/") && doc.file_id) {
        mediaFileId = doc.file_id;
        mediaType = "photo";
      }
      if (!mediaFileId && doc?.mime_type?.startsWith("video/") && doc.file_id) {
        mediaFileId = doc.file_id;
        mediaType = "video";
      }

      if (!mediaFileId || !mediaType) {
        await ensurePanel(
          update,
          [
            "⚠️ *فرمت نامعتبر*",
            "",
            "لطفا یک عکس یا ویدیو بفرستید.",
            "",
            prompt,
          ].join("\n"),
          cancelKb,
          panel,
        );
        continue;
      }

      await deleteAdminInput(update);

      await conversation.external(async () => {
        await pageContentService.setMedia(pageKey as PageKey, mediaFileId!, mediaType!);
      });
      await conversation.external((c) => {
        c.session.adminCmsPageKey = undefined;
      });

      // Remount as media page (old panel was likely text prompt)
      await presentCmsPage(update, pageKey, "edit", "✅ بنر صفحه ذخیره شد.");
      return;
    }
  } catch (err) {
    console.error("adminCmsMediaConversation error:", err);
    await conversation
      .external((c) => {
        c.session.adminCmsPageKey = undefined;
      })
      .catch(() => undefined);
    await ctx.reply(
      ["⚠️ *خطا در ذخیره بنر*", "", "لطفا دوباره تلاش کنید."].join("\n"),
      { parse_mode: "Markdown" },
    );
  }
}
