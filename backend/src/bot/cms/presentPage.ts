import { InlineKeyboard } from "grammy";
import type { SessionContext } from "../context";
import { invoiceService } from "../../services/invoices/InvoiceService";
import { catalogService } from "../../services/catalog/CatalogService";
import { paymentMethodService } from "../../services/paymentMethods/PaymentMethodService";
import { formatToman } from "../../lib/money";
import { toPlain } from "../../lib/plain";
import { BannerAssets } from "../assets/banners";
import { Callbacks } from "../keyboards/callbacks";
import {
  categoriesKeyboard,
  mainMenuKeyboard,
} from "../keyboards/builders";
import { walletMenuKeyboard } from "../user/keyboards";
import { appendFullWidthCta, appendNavBar } from "../keyboards/grid";
import { isAdminTelegramId } from "../../config/env";
import {
  pageContentService,
  type CmsPageContent,
  type PageKey,
  type PageMediaType,
} from "../../services/cms/PageContentService";
import {
  settingsService,
  SWAPPAY_ENABLED,
} from "../../services/settings/SettingsService";
import { injectAdminControls } from "./injectAdminControls";
import { safeEditMedia } from "../utils/safeEdit";
import { panelFromCtx } from "../conversations/wait";

export type PresentMode = "reply" | "edit";

function formatExpiresAt(expiresAt: Date): string {
  return expiresAt.toLocaleString("fa-IR", { timeZone: "Asia/Tehran" });
}

function withBanner(body: string, banner?: string): string {
  return banner ? `${banner}\n\n${body}` : body;
}

function clipCaption(text: string, max = 1024): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function supportPageKeyboard(ctx: SessionContext, pageKey: PageKey = "support"): InlineKeyboard {
  const kb = new InlineKeyboard();
  appendFullWidthCta(kb, "✉️ ارسال تیکت", Callbacks.supportOpenTicket);
  appendNavBar(kb, { text: "🔙 بازگشت", data: Callbacks.mainMenu });
  return injectAdminControls(ctx, kb, pageKey);
}

function detectMessageMediaKind(
  ctx: SessionContext,
): "photo" | "video" | "text" | "unknown" {
  const msg = ctx.callbackQuery?.message ?? ctx.msg;
  if (!msg) return "unknown";
  if ("photo" in msg && msg.photo) return "photo";
  if ("video" in msg && msg.video) return "video";
  if ("text" in msg && msg.text) return "text";
  if ("caption" in msg && msg.caption) {
    // caption-only without photo/video is rare; treat as text
    return "text";
  }
  return "unknown";
}

function defaultFallbackPhoto(pageKey: PageKey): string {
  if (pageKey === "shop") return BannerAssets.shop;
  return BannerAssets.welcome;
}

async function rememberPanel(ctx: SessionContext, chatId: number, messageId: number): Promise<void> {
  ctx.session.cmsPanelChatId = chatId;
  ctx.session.cmsPanelMessageId = messageId;
}

/**
 * Deliver a CMS page message. When message kind must change (text ↔ media / photo ↔ video),
 * delete the old panel and send a fresh message (Telegram cannot edit text into media).
 */
async function deliverCmsMessage(
  ctx: SessionContext,
  mode: PresentMode,
  pageKey: PageKey,
  page: CmsPageContent,
  caption: string,
  reply_markup?: InlineKeyboard,
): Promise<void> {
  const text = clipCaption(caption);
  const hasCmsMedia = Boolean(page.mediaFileId && page.mediaType);
  const mediaType: PageMediaType = hasCmsMedia ? (page.mediaType as PageMediaType) : "photo";
  const media = hasCmsMedia ? page.mediaFileId! : defaultFallbackPhoto(pageKey);

  if (mode === "reply") {
    const sent =
      mediaType === "video"
        ? await ctx.replyWithVideo(media, {
            caption: text,
            parse_mode: "Markdown",
            reply_markup,
          })
        : await ctx.replyWithPhoto(media, {
            caption: text,
            parse_mode: "Markdown",
            reply_markup,
          });
    await rememberPanel(ctx, sent.chat.id, sent.message_id);
    return;
  }

  const currentKind = detectMessageMediaKind(ctx);
  const targetKind = mediaType;
  const canInPlaceEdit =
    (currentKind === "photo" && targetKind === "photo") ||
    (currentKind === "video" && targetKind === "video");

  if (canInPlaceEdit) {
    try {
      await safeEditMedia(ctx, media, text, reply_markup, mediaType);
      const panel = panelFromCtx(ctx);
      if (panel) await rememberPanel(ctx, panel.chatId, panel.messageId);
      return;
    } catch (err) {
      console.warn("[deliverCmsMessage] in-place media edit failed, remounting:", err);
    }
  }

  // Remount: delete old panel, send new media message
  const panel = panelFromCtx(ctx);
  const chatId = panel?.chatId ?? ctx.chat?.id ?? ctx.from?.id;
  const oldMessageId =
    panel?.messageId ??
    ctx.session.cmsPanelMessageId ??
    ctx.callbackQuery?.message?.message_id;

  if (chatId != null && oldMessageId != null) {
    try {
      await ctx.api.deleteMessage(chatId, oldMessageId);
    } catch (err) {
      console.warn("[deliverCmsMessage] delete old panel failed:", err);
    }
  }

  const sent =
    mediaType === "video"
      ? await ctx.replyWithVideo(media, {
          caption: text,
          parse_mode: "Markdown",
          reply_markup,
        })
      : await ctx.replyWithPhoto(media, {
          caption: text,
          parse_mode: "Markdown",
          reply_markup,
        });
  await rememberPanel(ctx, sent.chat.id, sent.message_id);
}

/**
 * Render a CMS-backed user page (media + caption + keyboard).
 * Used by slash/callback handlers and after CMS conversations.
 */
export async function presentCmsPage(
  ctx: SessionContext,
  pageKey: PageKey,
  mode: PresentMode = "edit",
  banner?: string,
): Promise<void> {
  if (!ctx.from) return;

  const page = await pageContentService.getPage(pageKey);
  const baseText = page.textContent;
  const layout = page.layoutColumns;

  if (pageKey === "home") {
    const user = await invoiceService.ensureUser(BigInt(ctx.from.id));
    const pending = await invoiceService.getOpenInvoice(user.id);
    const lines = [
      baseText,
      "",
      `💎 موجودی کیف پول: *${formatToman(user.balance)}*`,
    ];
    if (pending) {
      lines.push(
        "",
        "⚠️ *فاکتور باز*",
        `🧾 شماره: *#${pending.id}*`,
        `📦 مورد: *${invoiceService.invoiceLabel(pending)}*`,
        `💵 مبلغ: *${formatToman(pending.amount)}*`,
        `📊 وضعیت: *${pending.status}*`,
        `⏳ انقضا: ${formatExpiresAt(pending.expiresAt)}`,
      );
    }
    const caption = withBanner(lines.join("\n"), banner);
    const kb = injectAdminControls(
      ctx,
      mainMenuKeyboard(Boolean(pending), isAdminTelegramId(ctx.from.id), layout),
      "home",
    );
    await deliverCmsMessage(ctx, mode, pageKey, page, caption, kb);
    return;
  }

  if (pageKey === "shop") {
    const categories = await catalogService.listActiveCategories();
    let caption = withBanner(baseText, banner);
    let kb: InlineKeyboard;
    if (categories.length === 0) {
      caption = withBanner(
        [baseText, "", "فعلا دسته بندی فعالی در فروشگاه نیست."].join("\n"),
        banner,
      );
      kb = injectAdminControls(
        ctx,
        mainMenuKeyboard(false, isAdminTelegramId(ctx.from.id), layout),
        "shop",
      );
    } else {
      kb = injectAdminControls(ctx, categoriesKeyboard(categories, layout), "shop");
    }
    await deliverCmsMessage(ctx, mode, pageKey, page, caption, kb);
    return;
  }

  if (pageKey === "account") {
    const user = await invoiceService.ensureUser(BigInt(ctx.from.id));
    const pending = await invoiceService.getOpenInvoice(user.id);
    const lines = [
      baseText,
      "",
      `🆔 تلگرام: \`${ctx.from.id}\``,
      `💎 موجودی: *${formatToman(user.balance)}*`,
      "",
    ];
    if (pending) {
      lines.push(
        "🧾 *فاکتور باز*",
        `شماره: *#${pending.id}*`,
        `مورد: *${invoiceService.invoiceLabel(pending)}*`,
        `وضعیت: *${pending.status}*`,
      );
    } else {
      lines.push("✅ فاکتور باز ندارید.");
    }
    const kb = injectAdminControls(
      ctx,
      mainMenuKeyboard(Boolean(pending), isAdminTelegramId(ctx.from.id), layout),
      "account",
    );
    await deliverCmsMessage(
      ctx,
      mode,
      pageKey,
      page,
      withBanner(lines.join("\n"), banner),
      kb,
    );
    return;
  }

  if (pageKey === "wallet") {
    const [user, swapEnabled, methods] = await Promise.all([
      invoiceService.ensureUser(BigInt(ctx.from.id)),
      settingsService.getBoolSetting(SWAPPAY_ENABLED, true),
      paymentMethodService.listActiveForButtons(),
    ]);
    const lines = [
      baseText,
      "",
      `موجودی فعلی: *${formatToman(user.balance)}*`,
      "",
      methods.length > 0 || swapEnabled
        ? "روش شارژ را انتخاب کنید:"
        : "در حال حاضر روش شارژ فعالی تنظیم نشده است.",
    ];
    const kb = injectAdminControls(
      ctx,
      walletMenuKeyboard({
        swapEnabled,
        methods: toPlain(methods),
        layoutColumns: layout,
      }),
      "wallet",
    );
    await deliverCmsMessage(
      ctx,
      mode,
      pageKey,
      page,
      withBanner(lines.join("\n"), banner),
      kb,
    );
    return;
  }

  // support
  await deliverCmsMessage(
    ctx,
    mode,
    pageKey,
    page,
    withBanner(baseText, banner),
    supportPageKeyboard(ctx, "support"),
  );
}
