import { createConversation } from "@grammyjs/conversations";
import { type Bot } from "grammy";
import type { BotContext } from "../context";
import { catalogService } from "../../services/catalog/CatalogService";
import { invoiceService, buildPriceUpdateNotice } from "../../services/invoices/InvoiceService";
import { paymentMethodService } from "../../services/paymentMethods/PaymentMethodService";
import { groupLogger } from "../../services/logger/GroupLogger";
import { ticketService } from "../../services/tickets/TicketService";
import {
  categoriesKeyboard,
  categoryContentsKeyboard,
  chooseDeliveryPreferenceKeyboard,
  mainMenuKeyboard,
  paymentMethodsKeyboard,
  pendingInvoiceKeyboard,
  productDetailKeyboard,
  productsKeyboard,
  servicePlansKeyboard,
} from "../keyboards/builders";
import { BUTTON_CUSTOM_EMOJIS } from "../keyboards/buttonEmojis";
import { buildCheckoutPaymentKeyboard } from "../keyboards/paymentChoice";
import { Callbacks } from "../keyboards/callbacks";
import { deliveryTypeLabel, emojiForLabel } from "../keyboards/grid";
import { isAdminTelegramId } from "../../config/env";
import { formatToman } from "../../lib/money";
import { BannerAssets } from "../assets/banners";
import { fulfillmentService } from "../../services/fulfillment/FulfillmentService";
import { walletService, InsufficientBalanceError } from "../../services/wallet/WalletService";
import {
  settingsService,
  SWAPPAY_ENABLED,
} from "../../services/settings/SettingsService";
import {
  checkoutConversation,
  uploadReceiptConversation,
} from "../conversations/checkout";
import { applyDiscountConversation } from "../conversations/discountConversation";
import { registerUserHandlers } from "../user/handlers";
import { registerSwapHandlers } from "../user/swapHandlers";
import { safeEdit, safeEditMedia, safeDeleteMessage } from "../utils/safeEdit";
import { presentCmsPage } from "../cms/presentPage";
import { pageContentService } from "../../services/cms/PageContentService";
import { forceJoinService } from "../../services/forceJoin/ForceJoinService";
import { InlineKeyboard } from "grammy";
import { adminHomeKeyboard } from "../admin/keyboards";
import { hasAnyAdminAccess } from "../admin/rbac";

function menuKb(hasPending: boolean, telegramId?: number) {
  return mainMenuKeyboard(hasPending, isAdminTelegramId(telegramId));
}

function renderInvoiceAmountLines(invoice: {
  amount: any;
  originalAmount?: any;
  discountCode?: string | null;
  discountPercent?: number | null;
  discountAmount?: any;
}): string[] {
  if (
    invoice.discountCode &&
    invoice.originalAmount &&
    Number(invoice.discountAmount) > 0
  ) {
    return [
      `💵 مبلغ اولیه: ~${formatToman(invoice.originalAmount)}~`,
      `🏷 تخفیف (${invoice.discountPercent}٪): -${formatToman(invoice.discountAmount)}`,
      `💵 مبلغ نهایی: *${formatToman(invoice.amount)}*`,
    ];
  }
  return [`💵 مبلغ: *${formatToman(invoice.amount)}*`];
}

async function handleCustomPaymentMethod(
  ctx: BotContext,
  invoiceId: number,
  methodId: number,
): Promise<void> {
  if (!ctx.from) return;
  const user = await invoiceService.ensureUser(BigInt(ctx.from.id));
  const pending = await invoiceService.getOpenInvoice(user.id);

  if (
    !pending ||
    pending.id !== invoiceId ||
    pending.isWalletTopUp ||
    pending.status !== "PENDING" ||
    !pending.product
  ) {
    await ctx.answerCallbackQuery({ text: "فاکتور نامعتبر", show_alert: true });
    return;
  }

  const method = await paymentMethodService.getById(methodId);
  if (!method || !method.isActive) {
    await ctx.answerCallbackQuery({ text: "روش پرداخت غیرفعال است", show_alert: true });
    return;
  }

  const refreshed = await invoiceService.refreshInvoicePriceIfUsd(invoiceId);
  const currentPending = (refreshed?.invoice ?? pending) as typeof pending;
  if (refreshed?.priceChanged) {
    await ctx.reply(buildPriceUpdateNotice(refreshed.oldPrice, refreshed.newPrice));
  }

  const amount = formatToman(currentPending.amount);
  const productName = currentPending.product?.name ?? pending.product?.name ?? "";
  const instructions = paymentMethodService.buildInstructions(
    method,
    amount,
    productName,
  );

  if (method.type === "CARD") {
    await invoiceService.markAwaitingReceipt(invoiceId);
    await ctx.answerCallbackQuery({ text: "جزئیات پرداخت نمایش داده شد" });
    await safeEdit(ctx, instructions, { parse_mode: "HTML" });
    try {
      await ctx.conversation.exitAll();
    } catch {
      /* ignore */
    }
    ctx.session.receiptInvoiceId = invoiceId;
    await ctx.conversation.enter("uploadReceipt");
    return;
  }

  await ctx.answerCallbackQuery({ text: "روش انتخاب شد" });
  await safeEdit(ctx, instructions, {
    parse_mode: "HTML",
    reply_markup: pendingInvoiceKeyboard(invoiceId),
  });
}

function formatExpiresAt(expiresAt: Date): string {
  return expiresAt.toLocaleString("fa-IR", { timeZone: "Asia/Tehran" });
}

function invoiceItemLabel(
  invoice: { isWalletTopUp: boolean; product?: { name: string } | null },
): string {
  return invoiceService.invoiceLabel(invoice);
}

async function startCheckout(ctx: BotContext, productId: number): Promise<void> {
  await ctx.answerCallbackQuery({ text: "ادامه خرید…" });
  try {
    await ctx.conversation.exitAll();
  } catch {
    /* ignore */
  }
  ctx.session.checkoutProductId = productId;
  await ctx.conversation.enter("checkout");
}

async function startSupportTicket(ctx: BotContext): Promise<void> {
  try {
    await ctx.conversation.exitAll();
  } catch {
    /* ignore */
  }
  await ctx.conversation.enter("support");
}

export function registerHandlers(bot: Bot<BotContext>): void {
  bot.use(createConversation(checkoutConversation, "checkout"));
  bot.use(createConversation(uploadReceiptConversation, "uploadReceipt"));
  bot.use(createConversation(applyDiscountConversation, "discountConversation"));
  bot.use(createConversation(applyDiscountConversation, "applyDiscountConversation"));
  registerUserHandlers(bot);
  registerSwapHandlers(bot);

  // --- FORCE JOIN MIDDLEWARE ---
  bot.use(async (ctx, next) => {
    if (ctx.callbackQuery?.data === "force_join:check") {
      const channelId = await forceJoinService.getInviteLink(); // just used to trigger fetch if needed, wait, we do validation next
      if (await forceJoinService.shouldBlockUser(ctx)) {
        await ctx.answerCallbackQuery({ text: "⚠️ شما هنوز در کانال عضو نشده‌اید!", show_alert: true });
        return;
      } else {
        await ctx.answerCallbackQuery({ text: "✅ عضویت شما تایید شد!" });
        const chatId = ctx.chat?.id;
        const msgId = ctx.callbackQuery.message?.message_id;
        if (chatId && msgId) await safeDeleteMessage(ctx.api, chatId, msgId);
        
        // Dismiss any old cached reply keyboard via transient message
        if (ctx.chat?.id) {
          const msg = await ctx.reply("...", { reply_markup: { remove_keyboard: true } });
          await ctx.api.deleteMessage(ctx.chat.id, msg.message_id).catch(() => {});
        }
        await presentCmsPage(ctx, "home", "reply");
        return;
      }
    }

    if (await forceJoinService.shouldBlockUser(ctx)) {
      const text = await forceJoinService.getForceJoinText();
      const link = await forceJoinService.getInviteLink();
      
      const kb = new InlineKeyboard();
      if (link) {
        kb.url("📢 عضویت در کانال", link).row();
      }
      kb.text("✅ تایید عضویت و ورود", "force_join:check");

      if (ctx.callbackQuery) {
        await ctx.answerCallbackQuery();
        await safeEdit(ctx, `⛔️ *دسترسی محدود*\n\n${text}`, { parse_mode: "Markdown", reply_markup: kb });
      } else {
        // If it's a message, delete it if possible to avoid clutter
        if (ctx.message?.message_id) {
          await safeDeleteMessage(ctx.api, ctx.chat!.id, ctx.message.message_id);
        }
        await ctx.reply(`⛔️ *دسترسی محدود*\n\n${text}`, { parse_mode: "Markdown", reply_markup: kb });
      }
      return;
    }

    await next();
  });

  async function showProductDetail(ctx: BotContext, productId: number, forceReply = false): Promise<void> {
    const product = await catalogService.getProduct(productId);

    if (!product) {
      if (!forceReply && ctx.callbackQuery) {
        await safeEditMedia(
          ctx,
          BannerAssets.shop,
          [
            "⚠️ *محصول نامعتبر*",
            "",
            "این محصول یافت نشد یا غیرفعال است.",
          ].join("\n"),
          categoriesKeyboard(await catalogService.listActiveCategories()),
        );
      } else {
        await ctx.reply("⚠️ این محصول یافت نشد یا غیرفعال است.");
      }
      return;
    }

    const description = catalogService.descriptionOf(product);
    const effectivePrice = await catalogService.getEffectivePrice(product);
    const caption = [
      `${emojiForLabel(product.name)} *${product.name}*`,
      "",
      `💰 قیمت: *${formatToman(effectivePrice)}*`,
      `⏱ زمان تحویل: *${deliveryTypeLabel(product.deliveryType)}*`,
      "",
      "🔖 *توضیحات محصول*",
      "",
      description,
      "",
      "👇 برای ادامه، دکمه خرید را بزنید:",
    ].join("\n");

    const media = product.bannerFileId?.trim() || BannerAssets.category;
    const kb = productDetailKeyboard(
      product.id,
      product.categoryId,
      (product as any).subCategoryId,
    );

    if (!forceReply && ctx.callbackQuery) {
      await safeEditMedia(ctx, media, caption, kb);
    } else {
      try {
        await ctx.replyWithPhoto(media, {
          caption,
          parse_mode: "Markdown",
          reply_markup: kb,
        });
      } catch {
        await ctx.reply(caption, {
          parse_mode: "Markdown",
          reply_markup: kb,
        });
      }
    }
  }

  async function showSubCategoryDetail(ctx: BotContext, subCategoryId: number, forceReply = false): Promise<void> {
    const subCategory = await catalogService.getSubCategoryById(subCategoryId);

    if (!subCategory || !subCategory.isActive) {
      if (!forceReply && ctx.callbackQuery) {
        await ctx.answerCallbackQuery({
          text: "سرویس یافت نشد یا غیرفعال است",
          show_alert: true,
        });
      } else {
        await ctx.reply("⚠️ این سرویس یافت نشد یا غیرفعال است.");
      }
      return;
    }

    const category = await catalogService.getCategory(subCategory.categoryId);
    const categoryName = category?.name ?? "دسته بندی";

    const rawProducts = await catalogService.listActiveProductsBySubCategory(subCategoryId);

    const planProducts = await Promise.all(
      rawProducts.map(async (p) => {
        const effectivePrice = await catalogService.getEffectivePrice(p);
        return {
          id: p.id,
          name: p.name,
          formattedPrice: formatToman(effectivePrice),
        };
      }),
    );

    const subBanner =
      subCategory.bannerUrl?.trim() ||
      subCategory.coverImageUrl?.trim() ||
      (category as any)?.bannerUrl?.trim() ||
      BannerAssets.category;

    const desc = subCategory.description?.trim();
    const caption = [
      `✨ *${subCategory.name}*`,
      ...(desc ? ["", `📝 ${desc}`] : []),
      "",
      planProducts.length === 0
        ? "فعلا پلن فعالی برای این سرویس وجود ندارد."
        : "برای خرید، پلن مورد نظر خود را انتخاب کنید:",
    ].join("\n");

    const kb = servicePlansKeyboard(planProducts, subCategory.categoryId, categoryName);

    if (!forceReply && ctx.callbackQuery) {
      await safeEditMedia(ctx, subBanner, caption, kb);
    } else {
      try {
        await ctx.replyWithPhoto(subBanner, {
          caption,
          parse_mode: "Markdown",
          reply_markup: kb,
        });
        return;
      } catch {
        /* fallback to text */
      }
      await ctx.reply(caption, {
        parse_mode: "Markdown",
        reply_markup: kb,
      });
    }
  }

  bot.command("start", async (ctx) => {
    const user = await invoiceService.ensureUser(BigInt(ctx.from!.id));
    const startPayload = ctx.match?.trim() || "";
    const referrerId =
      /^\d+$/.test(startPayload) && Number(startPayload) !== ctx.from!.id
        ? Number(startPayload)
        : null;

    if (ctx.session.newUserJustCreated) {
      const referrer = referrerId
        ? await invoiceService.getUserByTelegramId(BigInt(referrerId))
        : null;
      await groupLogger
        .logNewUser(
          ctx.api,
          { id: ctx.from!.id, username: ctx.from!.username },
          referrer
            ? { id: Number(referrer.telegramId), username: null }
            : referrerId
              ? { id: referrerId, username: null }
              : null,
        )
        .catch(console.error);
      ctx.session.newUserJustCreated = undefined;
    }

    const prodMatch = startPayload.match(/^prod[_-]?(\d+)$/);
    if (prodMatch) {
      const productId = Number(prodMatch[1]);
      await showProductDetail(ctx, productId, true);
      return;
    }

    const subCatMatch = startPayload.match(/^subcat[_-]?(\d+)$/);
    if (subCatMatch) {
      const subCatId = Number(subCatMatch[1]);
      await showSubCategoryDetail(ctx, subCatId, true);
      return;
    }

    // Touch user so pending balance logic stays warm; page body is CMS-driven
    void user;
    if (ctx.chat?.id) {
      const msg = await ctx.reply("...", { reply_markup: { remove_keyboard: true } });
      await ctx.api.deleteMessage(ctx.chat.id, msg.message_id).catch(() => {});
    }
    await presentCmsPage(ctx, "home", "reply");
  });

  bot.hears(["🛍️ فروشگاه", "فروشگاه 🛍️"], async (ctx) => {
    if (ctx.message?.message_id && ctx.chat?.id) await safeDeleteMessage(ctx.api, ctx.chat.id, ctx.message.message_id);
    await presentCmsPage(ctx, "shop", "reply");
  });

  bot.hears(["📦 سفارشهای من", "سفارشهای من 📦", "📦 سفارش‌های من", "سفارش‌های من 📦"], async (ctx) => {
    if (ctx.message?.message_id && ctx.chat?.id) await safeDeleteMessage(ctx.api, ctx.chat.id, ctx.message.message_id);
    await presentCmsPage(ctx, "account", "reply");
  });

  bot.hears(["💳 کیف پول", "کیف پول 💳"], async (ctx) => {
    if (ctx.message?.message_id && ctx.chat?.id) await safeDeleteMessage(ctx.api, ctx.chat.id, ctx.message.message_id);
    await presentCmsPage(ctx, "wallet", "reply");
  });

  bot.hears(["👤 حساب کاربری", "حساب کاربری 👤"], async (ctx) => {
    if (ctx.message?.message_id && ctx.chat?.id) await safeDeleteMessage(ctx.api, ctx.chat.id, ctx.message.message_id);
    await presentCmsPage(ctx, "account", "reply");
  });

  bot.hears(["📞 پشتیبانی و تیکت", "پشتیبانی و تیکت 📞", "پشتیبانی و تیکت 🎧", "🎧 پشتیبانی و تیکت", "پشتیبانی و تیکت"], async (ctx) => {
    if (ctx.message?.message_id && ctx.chat?.id) await safeDeleteMessage(ctx.api, ctx.chat.id, ctx.message.message_id);
    await presentCmsPage(ctx, "support", "reply");
  });

  bot.hears(["⚙️ پنل مدیریت", "پنل مدیریت ⚙️"], async (ctx) => {
    if (ctx.message?.message_id && ctx.chat?.id) await safeDeleteMessage(ctx.api, ctx.chat.id, ctx.message.message_id);
    if (!ctx.from || !(await hasAnyAdminAccess(ctx.from.id))) return;
    await ctx.reply(
      "🛠 *پنل مدیریت اشتراکینو*\n\nاز منوی زیر بخش مورد نظر را انتخاب کنید:",
      { parse_mode: "Markdown", reply_markup: adminHomeKeyboard() },
    );
  });

  bot.command("shop", async (ctx) => {
    await presentCmsPage(ctx, "shop", "reply");
  });

  bot.command("account", async (ctx) => {
    await presentCmsPage(ctx, "account", "reply");
  });

  bot.command("support", async (ctx) => {
    await presentCmsPage(ctx, "support", "reply");
  });

  bot.command("cancel", async (ctx) => {
    await handleCancelInvoice(ctx);
  });

  bot.callbackQuery(Callbacks.mainMenu, async (ctx) => {
    await ctx.answerCallbackQuery();
    await presentCmsPage(ctx, "home", "edit");
  });

  bot.callbackQuery(Callbacks.shop, async (ctx) => {
    await ctx.answerCallbackQuery();
    await presentCmsPage(ctx, "shop", "edit");
  });

  bot.callbackQuery(Callbacks.account, async (ctx) => {
    await ctx.answerCallbackQuery();
    await presentCmsPage(ctx, "account", "edit");
  });

  bot.callbackQuery(Callbacks.support, async (ctx) => {
    await ctx.answerCallbackQuery();
    await presentCmsPage(ctx, "support", "edit");
  });

  bot.callbackQuery(Callbacks.supportOpenTicket, async (ctx) => {
    await ctx.answerCallbackQuery();
    await startSupportTicket(ctx);
  });

  bot.on("message:text", async (ctx) => {
    const logGroupId = await groupLogger.getLogGroupId();
    if (!logGroupId) return;
    if (String(ctx.chat.id) !== String(logGroupId)) return;

    const replyTo = ctx.message.reply_to_message;
    if (!replyTo?.message_id) return;

    const match = await ticketService.findOpenByGroupMessageId(replyTo.message_id);
    if (!match) return;

    await ticketService.createAdminReply(
      match.ticket.id,
      BigInt(ctx.from.id),
      ctx.message.text,
    );

    await ctx.api.sendMessage(
      match.user.telegramId.toString(),
      [
        `🎧 *پاسخ پشتیبانی (تیکت #${match.ticket.id}):*`,
        "",
        ctx.message.text,
      ].join("\n"),
      { parse_mode: "Markdown" },
    );

    await ctx.reply("✅ پاسخ برای کاربر ارسال شد.");
  });

  bot.callbackQuery(/^cat:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const categoryId = Number(ctx.match![1]);
    ctx.session.lastCategoryId = categoryId;
    const category = await catalogService.getCategory(categoryId);

    if (!category) {
      await safeEditMedia(
        ctx,
        BannerAssets.shop,
        [
          "⚠️ *دسته بندی نامعتبر*",
          "",
          "این دسته بندی یافت نشد یا غیرفعال است.",
        ].join("\n"),
        categoriesKeyboard(await catalogService.listActiveCategories()),
      );
      return;
    }

    const subCategories = await catalogService.listSubCategoriesByCategory(categoryId, true);
    const allProducts = await catalogService.listActiveProductsByCategory(categoryId);
    const standaloneProducts = allProducts.filter((p: any) => p.subCategoryId == null);
    const user = await invoiceService.ensureUser(BigInt(ctx.from.id));
    const pending = await invoiceService.getOpenInvoice(user.id);

    const catBanner = (category as any).bannerUrl?.trim() || BannerAssets.category;
    const desc = (category as any).description?.trim();

    if (subCategories.length === 0 && standaloneProducts.length === 0) {
      const shopPage = await pageContentService.getPage("shop");
      await safeEditMedia(
        ctx,
        catBanner,
        [
          `${emojiForLabel(category.name)} *${category.name}*`,
          ...(desc ? ["", `📝 ${desc}`] : []),
          "",
          "فعلا محصول یا سرویس فعالی در این دسته وجود ندارد.",
        ].join("\n"),
        categoriesKeyboard(
          await catalogService.listActiveCategories(),
          shopPage.layoutColumns,
        ),
      );
      return;
    }

    const shopPage = await pageContentService.getPage("shop");
    const caption = [
      `${emojiForLabel(category.name)} *${category.name}*`,
      ...(desc ? ["", `📝 ${desc}`] : []),
      "",
      subCategories.length > 0
        ? "سرویس یا محصول مورد نظر را انتخاب کنید:"
        : "📦 محصول مورد نظر را انتخاب کنید:",
    ].join("\n");

    await safeEditMedia(
      ctx,
      catBanner,
      caption,
      categoryContentsKeyboard(subCategories, standaloneProducts, {
        hasPendingInvoice: Boolean(pending),
        layoutColumns: shopPage.layoutColumns,
      }),
    );
  });

  bot.callbackQuery(/^(?:subcat|subcat:view):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const subCategoryId = Number(ctx.match![1]);
    await showSubCategoryDetail(ctx, subCategoryId);
  });

  bot.callbackQuery(/^(?:prod|prod:view):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const productId = Number(ctx.match![1]);
    await showProductDetail(ctx, productId);
  });

  bot.callbackQuery(/^buy:(\d+)$/, async (ctx) => {
    const productId = Number(ctx.match![1]);
    const user = await invoiceService.ensureUser(BigInt(ctx.from.id));
    const product = await catalogService.getProduct(productId);

    if (!product) {
      await ctx.answerCallbackQuery({ text: "محصول یافت نشد", show_alert: true });
      return;
    }

    const existing = await invoiceService.getOpenInvoice(user.id);
    if (existing) {
      const refreshed = await invoiceService.refreshInvoicePriceIfUsd(existing.id);
      const invoiceToShow = (refreshed?.invoice ?? existing) as typeof existing;
      if (refreshed?.priceChanged) {
        await ctx.reply(buildPriceUpdateNotice(refreshed.oldPrice, refreshed.newPrice));
      }
      await ctx.answerCallbackQuery({
        text: "فاکتور باز دارید",
        show_alert: true,
      });
      await safeEdit(
        ctx,
        [
          "⛔ *فاکتور باز*",
          "",
          "ابتدا همان را پرداخت یا لغو کنید.",
          "",
          `🧾 شماره: *#${invoiceToShow.id}*`,
          `📦 مورد: *${invoiceItemLabel(invoiceToShow)}*`,
          ...renderInvoiceAmountLines(invoiceToShow as any),
          `📊 وضعیت: *${invoiceToShow.status}*`,
          `⏳ انقضا: ${formatExpiresAt(invoiceToShow.expiresAt)}`,
        ].join("\n"),
        {
          parse_mode: "Markdown",
          reply_markup: pendingInvoiceKeyboard(invoiceToShow.id, {
            hasDiscount: Boolean((invoiceToShow as any).discountCode),
          }),
        },
      );
      return;
    }

    if (product.deliveryType === "USER_CHOICE") {
      await ctx.answerCallbackQuery();
      await safeEdit(
        ctx,
        [
          `${emojiForLabel(product.name)} *${product.name}*`,
          "",
          "لطفاً نوع فعال سازی محصول را انتخاب کنید:",
        ].join("\n"),
        { reply_markup: chooseDeliveryPreferenceKeyboard(productId) },
      );
      return;
    }

    await startCheckout(ctx, productId);
  });

  bot.callbackQuery(/^buy:choice:(\d+):(READY|CREDENTIALS_REQUIRED)$/, async (ctx) => {
    const productId = Number(ctx.match![1]);
    const deliveryPreference = ctx.match![2] as "READY" | "CREDENTIALS_REQUIRED";
    const user = await invoiceService.ensureUser(BigInt(ctx.from.id));
    const product = await catalogService.getProduct(productId);

    if (!product) {
      await ctx.answerCallbackQuery({ text: "محصول یافت نشد", show_alert: true });
      return;
    }

    if (product.deliveryType !== "USER_CHOICE") {
      await ctx.answerCallbackQuery({ text: "این محصول انتخاب پویا ندارد", show_alert: true });
      return;
    }

    const existing = await invoiceService.getOpenInvoice(user.id);
    if (existing) {
      const refreshed = await invoiceService.refreshInvoicePriceIfUsd(existing.id);
      const invoiceToShow = (refreshed?.invoice ?? existing) as typeof existing;
      if (refreshed?.priceChanged) {
        await ctx.reply(buildPriceUpdateNotice(refreshed.oldPrice, refreshed.newPrice));
      }
      await ctx.answerCallbackQuery({
        text: "فاکتور باز دارید",
        show_alert: true,
      });
      await safeEdit(
        ctx,
        [
          "⛔ *فاکتور باز*",
          "",
          "ابتدا همان را پرداخت یا لغو کنید.",
          "",
          `🧾 شماره: *#${invoiceToShow.id}*`,
          `📦 مورد: *${invoiceItemLabel(invoiceToShow)}*`,
          ...renderInvoiceAmountLines(invoiceToShow as any),
          `📊 وضعیت: *${invoiceToShow.status}*`,
          `⏳ انقضا: ${formatExpiresAt(invoiceToShow.expiresAt)}`,
        ].join("\n"),
        {
          parse_mode: "Markdown",
          reply_markup: pendingInvoiceKeyboard(invoiceToShow.id, {
            hasDiscount: Boolean((invoiceToShow as any).discountCode),
          }),
        },
      );
      return;
    }

    await ctx.answerCallbackQuery({
      text: deliveryPreference === "READY" ? "تحویل آنی انتخاب شد" : "تحویل روی ایمیل شخصی انتخاب شد",
    });

    try {
      const invoice = await invoiceService.createPendingInvoice(
        user.id,
        productId,
        undefined,
        deliveryPreference,
      );

      await safeEdit(
        ctx,
        [
          "✅ *فاکتور ساخته شد*",
          "",
          `🧾 شماره: *#${invoice.id}*`,
          `${emojiForLabel(product.name)} محصول: *${product.name}*`,
          ...renderInvoiceAmountLines(invoice as any),
          `📊 وضعیت: *${invoice.status}*`,
          `🚚 روش انتخاب شده: *${deliveryTypeLabel(deliveryPreference)}*`,
          "",
          "روش پرداخت را انتخاب کنید:",
        ].join("\n"),
        {
          reply_markup: await buildCheckoutPaymentKeyboard(
            invoice.id,
            formatToman(user.balance),
            { hasDiscount: false },
          ),
        },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.reply(
        ["⚠️ *ساخت فاکتور ناموفق بود*", "", msg].join("\n"),
        { parse_mode: "Markdown", reply_markup: menuKb(false, ctx.from.id) },
      );
    }
  });

  bot.callbackQuery(/^pay:(\d+)$/, async (ctx) => {
    const invoiceId = Number(ctx.match![1]);
    const user = await invoiceService.ensureUser(BigInt(ctx.from.id));
    const pending = await invoiceService.getOpenInvoice(user.id);

    if (!pending || pending.id !== invoiceId) {
      await ctx.answerCallbackQuery({
        text: "فاکتور در انتظار معتبر نیست",
        show_alert: true,
      });
      return;
    }

    if (pending.status !== "PENDING") {
      await ctx.answerCallbackQuery({
        text: `وضعیت فعلی: ${pending.status}`,
        show_alert: true,
      });
      return;
    }

    if (pending.expiresAt.getTime() <= Date.now()) {
      await invoiceService.expireOverdue();
      await ctx.answerCallbackQuery({ text: "فاکتور منقضی شده", show_alert: true });
      await safeEdit(
        ctx,
        [
          "⌛ *فاکتور منقضی شده*",
          "",
          `🧾 شماره: *#${invoiceId}*`,
          "",
          "لطفا دوباره از فروشگاه خرید کنید.",
        ].join("\n"),
        {
          parse_mode: "Markdown",
          reply_markup: menuKb(false, ctx.from.id),
        },
      );
      return;
    }

    // Dynamic price recalculation for USD product invoices
    const refreshed = await invoiceService.refreshInvoicePriceIfUsd(pending.id);
    const currentPending = (refreshed?.invoice ?? pending) as typeof pending;
    if (refreshed?.priceChanged) {
      await ctx.reply(buildPriceUpdateNotice(refreshed.oldPrice, refreshed.newPrice));
    }

    const methods = await paymentMethodService.listActiveForButtons();
    const swapEnabled = await settingsService.getBoolSetting(SWAPPAY_ENABLED, true);

    if (methods.length === 0 && !swapEnabled && Number(user.balance) <= 0) {
      await ctx.answerCallbackQuery({
        text: "روش پرداخت فعالی نیست",
        show_alert: true,
      });
      await safeEdit(
        ctx,
        [
          "⚠️ *روش پرداخت در دسترس نیست*",
          "",
          "در حال حاضر امکان پرداخت کارت به کارت، سواپ ولت یا کیف پول وجود ندارد.",
        ].join("\n"),
        {
          parse_mode: "Markdown",
          reply_markup: pendingInvoiceKeyboard(invoiceId),
        },
      );
      return;
    }

    await ctx.answerCallbackQuery();
    await safeEdit(
      ctx,
      [
        "💳 *انتخاب روش پرداخت*",
        "",
        `🧾 فاکتور: *#${currentPending.id}*`,
        `📦 مورد: *${invoiceItemLabel(currentPending)}*`,
        ...renderInvoiceAmountLines(currentPending as any),
        "",
        "روش پرداخت را انتخاب کنید:",
      ].join("\n"),
      {
        parse_mode: "Markdown",
        reply_markup: await buildCheckoutPaymentKeyboard(
          currentPending.id,
          formatToman(user.balance),
          { hasDiscount: Boolean((currentPending as any).discountCode) },
        ),
      },
    );
  });

  bot.callbackQuery(/^(?:discount:apply:|inv:dsc:)(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const invoiceId = Number(ctx.match![1]);
    ctx.session.discountInvoiceId = invoiceId;
    ctx.session.pendingInvoiceId = invoiceId;
    try {
      await ctx.conversation.exitAll();
    } catch {}
    await ctx.conversation.enter("discountConversation");
  });

  bot.callbackQuery(/^pay:card:(\d+)$/, async (ctx) => {
    const invoiceId = Number(ctx.match![1]);
    const methods = await paymentMethodService.listActiveForButtons();
    const card = methods.find((m) => m.type === "CARD");
    if (!card) {
      await ctx.answerCallbackQuery({ text: "کارت فعالی نیست", show_alert: true });
      return;
    }
    await handleCustomPaymentMethod(ctx, invoiceId, card.id);
  });

  bot.callbackQuery(/^pay:custom:(\d+):(\d+)$/, async (ctx) => {
    const invoiceId = Number(ctx.match![1]);
    const methodId = Number(ctx.match![2]);
    await handleCustomPaymentMethod(ctx, invoiceId, methodId);
  });

  bot.callbackQuery(/^pay:wallet:(\d+)$/, async (ctx) => {
    const invoiceId = Number(ctx.match![1]);
    const user = await invoiceService.ensureUser(BigInt(ctx.from.id));
    const pending = await invoiceService.getOpenInvoice(user.id);

    if (!pending || pending.id !== invoiceId || pending.isWalletTopUp || !pending.product) {
      await ctx.answerCallbackQuery({ text: "فاکتور نامعتبر", show_alert: true });
      return;
    }

    if (pending.status !== "PENDING") {
      await ctx.answerCallbackQuery({ text: "فاکتور نامعتبر", show_alert: true });
      return;
    }

    const refreshed = await invoiceService.refreshInvoicePriceIfUsd(invoiceId);
    const currentPending = (refreshed?.invoice ?? pending) as typeof pending;
    if (refreshed?.priceChanged) {
      await ctx.reply(buildPriceUpdateNotice(refreshed.oldPrice, refreshed.newPrice));
    }

    const price = Number(currentPending.amount);
    const balance = Number(user.balance);
    if (balance < price) {
      await ctx.answerCallbackQuery({ text: "موجودی کافی نیست", show_alert: true });
      await safeEdit(
        ctx,
        [
          "❌ *موجودی کافی نیست*",
          "",
          `💵 مبلغ فاکتور: *${formatToman(currentPending.amount)}*`,
          `💰 موجودی کیف پول: *${formatToman(user.balance)}*`,
          "",
          "لطفاً کیف پول را شارژ کنید، سواپ ولت یا کارت به کارت را انتخاب کنید.",
        ].join("\n"),
        {
          parse_mode: "Markdown",
          reply_markup: await buildCheckoutPaymentKeyboard(
            invoiceId,
            formatToman(user.balance),
            { hasDiscount: Boolean((currentPending as any).discountCode) },
          ),
        },
      );
      return;
    }

    try {
      const invoice = await walletService.processWalletPurchase(invoiceId, user.id);
      await ctx.answerCallbackQuery({ text: "پرداخت موفق ✅" });

      await groupLogger
        .logPurchase(
          ctx.api,
          invoice.id,
          invoice.product!.name,
          invoice.amount,
          invoice.user.telegramId.toString(),
        )
        .catch(console.error);

      await safeEdit(
        ctx,
        [
          "✅ *پرداخت از کیف پول موفق بود*",
          "",
          `🧾 فاکتور: *#${invoice.id}*`,
          `📦 محصول: *${invoice.product!.name}*`,
          `💵 مبلغ: *${formatToman(invoice.amount)}*`,
          `📊 وضعیت: *PAID*`,
        ].join("\n"),
        { parse_mode: "Markdown", reply_markup: menuKb(false, ctx.from.id) },
      );

      await fulfillmentService.processApprovedInvoice(ctx.api, invoice.id);
    } catch (err) {
      if (err instanceof InsufficientBalanceError) {
        await ctx.answerCallbackQuery({ text: "موجودی کافی نیست", show_alert: true });
        return;
      }
      console.error("wallet purchase failed:", err);
      await ctx.answerCallbackQuery({ text: "خطا در پرداخت", show_alert: true });
    }
  });

  bot.callbackQuery(/^pm:(\d+):(\d+)$/, async (ctx) => {
    const invoiceId = Number(ctx.match![1]);
    const methodId = Number(ctx.match![2]);
    await handleCustomPaymentMethod(ctx, invoiceId, methodId);
  });

  bot.callbackQuery(Callbacks.cancelInvoice, async (ctx) => {
    await handleCancelInvoice(ctx, true);
  });

  bot.callbackQuery(/^cancel_inv:(\d+)$/, async (ctx) => {
    const invoiceId = Number(ctx.match![1]);
    await handleCancelInvoice(ctx, true, invoiceId);
  });

  bot.on("inline_query", async (ctx) => {
    const query = ctx.inlineQuery.query.trim().toLowerCase();
    const allProducts = await catalogService.listActiveProducts();

    const filtered =
      query.length === 0
        ? allProducts.slice(0, 30)
        : allProducts
            .filter(
              (p) =>
                p.name.toLowerCase().includes(query) ||
                (p.description && p.description.toLowerCase().includes(query)),
            )
            .slice(0, 30);

    const botUsername = ctx.me?.username || bot.botInfo?.username || "";

    const results = await Promise.all(
      filtered.map(async (product) => {
        const effectivePrice = await catalogService.getEffectivePrice(product);
        const formattedPrice = formatToman(effectivePrice);
        const desc = catalogService.descriptionOf(product, "سرویس و اشتراک آنلاین");

        const kb = new InlineKeyboard();
        if (botUsername) {
          kb.url(
            { text: "مشاهده و خرید پلن", icon_custom_emoji_id: BUTTON_CUSTOM_EMOJIS.BUY },
            `https://t.me/${botUsername}?start=prod_${product.id}`,
          );
        } else {
          kb.text(
            { text: "مشاهده و خرید پلن", icon_custom_emoji_id: BUTTON_CUSTOM_EMOJIS.BUY },
            Callbacks.viewProduct(product.id),
          );
        }

        return {
          type: "article" as const,
          id: `prod_${product.id}`,
          title: `🔹 ${product.name}`,
          description: `${formattedPrice} | ${desc.slice(0, 60)}`,
          input_message_content: {
            message_text: [
              `🔹 *${product.name}*`,
              "",
              `💰 قیمت: *${formattedPrice}*`,
              `⏱ زمان تحویل: *${deliveryTypeLabel(product.deliveryType)}*`,
              "",
              desc,
            ].join("\n"),
            parse_mode: "Markdown" as const,
          },
          reply_markup: kb,
        };
      }),
    );

    await ctx.answerInlineQuery(results, { cache_time: 10 });
  });
}

async function handleCancelInvoice(
  ctx: BotContext,
  fromCallback = false,
  invoiceId?: number,
): Promise<void> {
  if (!ctx.from) return;

  const user = await invoiceService.ensureUser(BigInt(ctx.from.id));

  try {
    const cancelled = await invoiceService.cancelInvoice(user.id, invoiceId);
    const msg = [
      "❌ *فاکتور لغو شد*",
      "",
      `🧾 شماره: *#${cancelled.id}*`,
      `📊 وضعیت: *CANCELLED*`,
      "",
      "می توانید دوباره از فروشگاه خرید کنید.",
    ].join("\n");

    if (fromCallback && ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: `فاکتور #${cancelled.id} لغو شد` });
      await safeEdit(ctx, msg, {
        parse_mode: "Markdown",
        reply_markup: menuKb(false, ctx.from.id),
      });
    } else {
      await ctx.reply(msg, {
        parse_mode: "Markdown",
        reply_markup: menuKb(false, ctx.from.id),
      });
    }
  } catch {
    const msg = [
      "ℹ️ *لغو ممکن نیست*",
      "",
      "فاکتور بازی برای لغو وجود ندارد.",
    ].join("\n");
    if (fromCallback && ctx.callbackQuery) {
      await ctx.answerCallbackQuery({
        text: "فاکتور بازی برای لغو وجود ندارد",
        show_alert: true,
      });
    } else {
      await ctx.reply(msg, {
        parse_mode: "Markdown",
        reply_markup: menuKb(false, ctx.from.id),
      });
    }
  }
}
