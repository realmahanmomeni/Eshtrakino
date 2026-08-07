import type { EshtrakinoConversation, SessionContext } from "../context";
import {
  ensurePanel,
  panelFromCtx,
  waitTextOnPanel,
} from "../conversations/wait";
import { InlineKeyboard } from "grammy";
import {
  isPageKey,
  pageContentService,
  toBotDescription,
  type PageKey,
} from "../../services/cms/PageContentService";
import { presentCmsPage } from "./presentPage";

/**
 * Fluid UI: edit PageContent.textContent for a contextual page.
 * Deletes admin input; refreshes the same page after save.
 * For home, also syncs Telegram "Before Start" description.
 */
export async function editPageTextConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  try {
    const pageKey = await conversation.external((c) => {
      const raw = c.session.adminCmsPageKey;
      return isPageKey(raw) ? raw : null;
    });

    if (!pageKey) {
      await ctx.reply("⚠️ صفحه هدف مشخص نیست. دوباره از دکمه تنظیمات صفحه وارد شوید.");
      return;
    }

    let panel = panelFromCtx(ctx);
    const current = await conversation.external(async () =>
      pageContentService.getText(pageKey),
    );

    const prompt = [
      "📝 *ویرایش متن صفحه*",
      "",
      `صفحه: \`${pageKey}\``,
      "",
      "متن فعلی:",
      current,
      "",
      "متن جدید را بفرستید (Markdown مجاز است).",
      "",
      "(برای انصراف /cancel را بفرستید)",
    ].join("\n");

    if (!panel) {
      panel = await ensurePanel(ctx, prompt, new InlineKeyboard().text("❌ لغو", "conv:cancel"), null);
    }

    const waited = await waitTextOnPanel(conversation, ctx, prompt, panel);
    panel = waited.panel;

    if (!waited.text) {
      await conversation.external((c) => {
        c.session.adminCmsPageKey = undefined;
      });
      await presentCmsPage(ctx, pageKey, "edit");
      return;
    }

    const next = waited.text.trim();
    if (next.length < 1 || next.length > 3500) {
      await conversation.external((c) => {
        c.session.adminCmsPageKey = undefined;
      });
      await presentCmsPage(
        ctx,
        pageKey,
        "edit",
        "⚠️ متن نامعتبر است (۱ تا ۳۵۰۰ کاراکتر).",
      );
      return;
    }

    await conversation.external(async () => {
      await pageContentService.setText(pageKey as PageKey, next);
    });
    await conversation.external((c) => {
      c.session.adminCmsPageKey = undefined;
    });

    // Sync Telegram empty-chat / pre-start description for home (and alias "start")
    if (pageKey === "home") {
      const description = toBotDescription(next, 512);
      ctx.api.setMyDescription(description).catch((err) => {
        console.error("setMyDescription failed:", err);
      });
    }

    await presentCmsPage(ctx, pageKey, "edit", "✅ متن صفحه ذخیره شد.");
  } catch (err) {
    console.error("editPageTextConversation error:", err);
    await conversation
      .external((c) => {
        c.session.adminCmsPageKey = undefined;
      })
      .catch(() => undefined);
    await ctx.reply(
      ["⚠️ *خطا در ذخیره متن صفحه*", "", "لطفا دوباره تلاش کنید."].join("\n"),
      { parse_mode: "Markdown" },
    );
  }
}
