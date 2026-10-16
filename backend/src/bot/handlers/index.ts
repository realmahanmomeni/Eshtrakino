import { createConversation } from "@grammyjs/conversations";
import { type Bot } from "grammy";
import type { BotContext } from "../context";
import { catalogService } from "../../services/catalog/CatalogService";
import { isStarsCatalog } from "../../services/catalog/starsPricingService";
import { resolveStarsHeaderUnitToman } from "../../services/catalog/starsBrowse";
import { exchangeRateService } from "../../services/exchangeRateService";
import {
  invoiceService,
  buildPriceUpdateNotice,
  renderInvoiceAmountLines,
  type InvoiceWithProduct,
} from "../../services/invoices/InvoiceService";
import { paymentMethodService } from "../../services/paymentMethods/PaymentMethodService";
import { groupLogger } from "../../services/logger/GroupLogger";
import { ticketService } from "../../services/tickets/TicketService";
import {
  categoriesKeyboard,
  categoryContentsKeyboard,
  chooseDeliveryPreferenceKeyboard,
  mainMenuKeyboard,
  pendingInvoiceKeyboard,
  productDetailKeyboard,
  servicePlansKeyboard,
} from "../keyboards/builders";
import { BUTTON_CUSTOM_EMOJIS } from "../keyboards/buttonEmojis";
import { buildCheckoutPaymentKeyboard } from "../keyboards/paymentChoice";
import { Callbacks } from "../keyboards/callbacks";
import { deliveryTypeLabel, emojiForLabel } from "../keyboards/grid";
import { isAdminTelegramId } from "../../config/env";
import { formatToman } from "../../lib/money";
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
import { shopSearchConversation } from "../conversations/searchConversation";
import { registerUserHandlers } from "../user/handlers";
import { registerSwapHandlers } from "../user/swapHandlers";
import { safeEdit, safeDeleteMessage, safePresentShopText } from "../utils/safeEdit";
import { customerCallbackErrorMiddleware, logHandlerError } from "../utils/customerErrors";
import { exitAllConversations } from "../utils/conversations";
import { presentCmsPage } from "../cms/presentPage";
import { pageContentService } from "../../services/cms/PageContentService";
import { forceJoinService } from "../../services/forceJoin/ForceJoinService";
import {
  OUT_OF_STOCK_ALERT,
  isProductOutOfStock,
  isProductOutOfStockById,
} from "../../services/catalog/catalogAvailability";
import {
  presentCategoryView,
  presentShopCategories,
  sanitizeCustomerCatalogText,
} from "../utils/catalogUi";
import {
  ensureShopCatalogFresh,
  filterAvailabilityRowsForShop,
  subCategoryHasShopAvailableProduct,
} from "../../services/catalog/shopAvailability";
import { resolveShopShowOutOfStock, toggleShopShowOutOfStock } from "../utils/shopBrowse";
import { hasAnyAdminAccess } from "../admin/rbac";
import {
  buildDescriptionContinuationMessages,
  buildProductDetailPayload,
} from "../utils/productDetailMessage";
import {
  verifyBeforeCheckout,
  verifyBeforePayment,
} from "../../services/catalog/prePaymentGuardService";
import { handlePrePaymentGuardResult } from "../utils/prePaymentFlow";
import {
  answerShopRefreshCallbackOnce,
  isBenignShopRerenderError,
  resolveShopRefreshToast,
} from "../utils/shopRefreshCallback";
import {
  pickShopRefreshRerenderTarget,
  type ShopRefreshRerenderTarget,
} from "../utils/shopRefreshRerender";
import { InlineKeyboard } from "grammy";
import { adminHomeKeyboardAsync } from "../admin/keyboards";

function menuKb(hasPending: boolean, telegramId?: number) {
  return mainMenuKeyboard(hasPending, isAdminTelegramId(telegramId));
}

async function showPaymentMethodSelection(
  ctx: BotContext,
  invoiceId: number,
  options?: { skipLiveGuard?: boolean },
): Promise<void> {
  if (!ctx.from) return;
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

  if (!options?.skipLiveGuard && pending.product) {
    const guard = await verifyBeforePayment(invoiceId);
    const proceed = await handlePrePaymentGuardResult(ctx, user.id, guard);
    if (!proceed) return;
  }

  const refreshed = await invoiceService.refreshInvoicePriceIfUsd(pending.id);
  const currentPending: InvoiceWithProduct = refreshed?.invoice ?? pending;
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
      ...renderInvoiceAmountLines(currentPending),
      "",
      "روش پرداخت را انتخاب کنید:",
    ].join("\n"),
    {
      parse_mode: "Markdown",
      reply_markup: await buildCheckoutPaymentKeyboard(
        currentPending.id,
        formatToman(user.balance),
        { hasDiscount: Boolean(currentPending.discountCode) },
      ),
    },
  );
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

  const guard = await verifyBeforePayment(invoiceId);
  const proceed = await handlePrePaymentGuardResult(ctx, user.id, guard);
  if (!proceed) return;

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
    await exitAllConversations(ctx);
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
  await exitAllConversations(ctx);
  ctx.session.checkoutProductId = productId;
  await ctx.conversation.enter("checkout");
}

async function startSupportTicket(ctx: BotContext): Promise<void> {
  await exitAllConversations(ctx);
  await ctx.conversation.enter("support");
}

async function startShopSearch(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery({ text: "جستجو…" }).catch(() => undefined);
  await exitAllConversations(ctx);
  await ctx.conversation.enter("shopSearch");
}

export function registerHandlers(bot: Bot<BotContext>): void {
  bot.use(createConversation(checkoutConversation, "checkout"));
  bot.use(createConversation(uploadReceiptConversation, "uploadReceipt"));
  bot.use(createConversation(applyDiscountConversation, "discountConversation"));
  bot.use(createConversation(applyDiscountConversation, "applyDiscountConversation"));
  bot.use(createConversation(shopSearchConversation, "shopSearch"));
  bot.use(customerCallbackErrorMiddleware);
  registerUserHandlers(bot);
  registerSwapHandlers(bot);

  // --- FORCE JOIN MIDDLEWARE ---
  bot.use(async (ctx, next) => {
    if (ctx.callbackQuery?.data === "force_join:check") {
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
    await ensureShopCatalogFresh();
    const showOos = await resolveShopShowOutOfStock(ctx);
    const product = await catalogService.getProduct(productId, false);

    if (!product) {
      const invalidMsg = [
        "⚠️ *محصول نامعتبر*",
        "",
        "این محصول یافت نشد یا غیرفعال است.",
      ].join("\n");
      const invalidKb = categoriesKeyboard(await catalogService.listActiveCategories());
      if (!forceReply && ctx.callbackQuery) {
        await safePresentShopText(ctx, invalidMsg, {
          parse_mode: "Markdown",
          reply_markup: invalidKb,
        });
      } else {
        await ctx.reply(invalidMsg, { parse_mode: "Markdown", reply_markup: invalidKb });
      }
      return;
    }

    const outOfStock = await isProductOutOfStock(product);
    const mayViewUnavailable = showOos && ctx.from && (await hasAnyAdminAccess(ctx.from.id));

    if (outOfStock && !mayViewUnavailable) {
      const backKb = productDetailKeyboard(
        product.id,
        product.categoryId,
        product.subCategoryId,
        { allowPurchase: false },
      );
      const msg = "❌ *ناموجود*\n\nاین محصول در حال حاضر موجود نیست.";
      if (!forceReply && ctx.callbackQuery) {
        await safePresentShopText(ctx, msg, {
          parse_mode: "Markdown",
          reply_markup: backKb,
        });
      } else {
        await ctx.reply(msg, { parse_mode: "Markdown", reply_markup: backKb });
      }
      return;
    }

    if (outOfStock && ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: OUT_OF_STOCK_ALERT, show_alert: true });
    }

    const description = catalogService.descriptionOf(product);
    const effectivePrice = await catalogService.getEffectivePrice(product);
    const detail = buildProductDetailPayload({
      product,
      description,
      effectivePrice,
    });

    const kb = productDetailKeyboard(
      product.id,
      product.categoryId,
      product.subCategoryId,
      {
        showDescriptionMore: detail.descriptionTruncated,
        allowPurchase: !outOfStock,
      },
    );

    const sendFallbackText = async (): Promise<void> => {
      await ctx.reply(detail.captionHtml, {
        parse_mode: detail.parseMode,
        reply_markup: kb,
      });
    };

    try {
      if (!forceReply && ctx.callbackQuery) {
        await safePresentShopText(ctx, detail.captionHtml, {
          parse_mode: detail.parseMode,
          reply_markup: kb,
        });
      } else {
        await sendFallbackText();
      }
    } catch (err) {
      console.error("[showProductDetail] send failed:", err);
      if (ctx.callbackQuery) {
        await ctx
          .answerCallbackQuery({
            text: "نمایش جزئیات محصول ناموفق بود. دوباره تلاش کنید.",
            show_alert: true,
          })
          .catch(() => undefined);
      }
      try {
        await sendFallbackText();
      } catch (fallbackErr) {
        console.error("[showProductDetail] fallback failed:", fallbackErr);
        await ctx.reply(
          "⚠️ نمایش جزئیات این محصول ممکن نشد. لطفاً دوباره از فهرست انتخاب کنید یا با پشتیبانی تماس بگیرید.",
        );
      }
    }
  }

  async function sendProductDescriptionContinuation(
    ctx: BotContext,
    productId: number,
  ): Promise<void> {
    const product = await catalogService.getProduct(productId, false);
    if (!product) {
      await ctx.answerCallbackQuery({ text: "محصول یافت نشد", show_alert: true });
      return;
    }
    const full = sanitizeCustomerCatalogText(catalogService.descriptionOf(product));
    const detail = buildProductDetailPayload({
      product,
      description: full,
      effectivePrice: await catalogService.getEffectivePrice(product),
    });
    const parts = buildDescriptionContinuationMessages(detail.descriptionRemainder);
    if (parts.length === 0) {
      await ctx.answerCallbackQuery({ text: "توضیحات بیشتری وجود ندارد." });
      return;
    }
    await ctx.answerCallbackQuery();
    const escapeHtml = (t: string) =>
      t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    for (const part of parts) {
      await ctx.reply(`📄 <b>ادامه توضیحات</b>\n\n${escapeHtml(part)}`, {
        parse_mode: "HTML",
      });
    }
  }

  async function showSubCategoryDetail(ctx: BotContext, subCategoryId: number, forceReply = false): Promise<void> {
    await ensureShopCatalogFresh();
    const showOos = await resolveShopShowOutOfStock(ctx);
    const isAdmin = ctx.from ? await hasAnyAdminAccess(ctx.from.id) : false;

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

    if (!showOos && !(await subCategoryHasShopAvailableProduct(subCategoryId))) {
      const msg = [
        `✨ *${subCategory.name}*`,
        "",
        "فعلاً محصول قابل خریدی در این سرویس موجود نیست.",
      ].join("\n");
      const backKb = servicePlansKeyboard([], subCategory.categoryId, categoryName, subCategoryId, {
        adminOutOfStockToggle: isAdmin ? { showing: showOos } : undefined,
      });
      if (!forceReply && ctx.callbackQuery) {
        await safePresentShopText(ctx, msg, {
          parse_mode: "Markdown",
          reply_markup: backKb,
        });
      } else {
        await ctx.reply(msg, { parse_mode: "Markdown", reply_markup: backKb });
      }
      return;
    }

    const rawProducts = await catalogService.listDisplayProductsBySubCategory(subCategoryId);

    const planProductsAll = await Promise.all(
      rawProducts.map(async (p) => {
        const effectivePrice = await catalogService.getEffectivePrice(p);
        return {
          id: p.id,
          name: p.name,
          formattedPrice: formatToman(effectivePrice),
          outOfStock: await isProductOutOfStock(p),
        };
      }),
    );
    const planProducts = filterAvailabilityRowsForShop(planProductsAll, showOos);

    const desc = subCategory.description?.trim();
    const isStars = isStarsCatalog(subCategory.name) || isStarsCatalog(categoryName);
    let starsRateLine = "";
    if (isStars) {
      const oneStarToman = await resolveStarsHeaderUnitToman(rawProducts);
      const formattedToman = oneStarToman.toLocaleString("en-US");
      starsRateLine = `⭐️ قیمت هر ۱ عدد استارز امروز: <b>${formattedToman} تومان</b>`;
    }

    const caption = isStars
      ? [
          `✨ <b>${subCategory.name}</b>`,
          ...(desc ? ["", `📝 ${desc}`] : []),
          ...(starsRateLine ? ["", starsRateLine] : []),
          "",
          planProducts.length === 0
            ? "فعلا پلن فعالی برای این سرویس وجود ندارد."
            : "برای خرید، پلن مورد نظر خود را انتخاب کنید:",
        ].join("\n")
      : [
          `✨ *${subCategory.name}*`,
          ...(desc ? ["", `📝 ${desc}`] : []),
          "",
          planProducts.length === 0
            ? "فعلا پلن فعالی برای این سرویس وجود ندارد."
            : "برای خرید، پلن مورد نظر خود را انتخاب کنید:",
        ].join("\n");

    const kb = servicePlansKeyboard(
      planProducts,
      subCategory.categoryId,
      categoryName,
      subCategoryId,
      {
        adminOutOfStockToggle: isAdmin ? { showing: showOos } : undefined,
      },
    );
    const parse_mode = isStars ? "HTML" : "Markdown";

    if (!forceReply && ctx.callbackQuery) {
      await safePresentShopText(ctx, caption, {
        parse_mode,
        reply_markup: kb,
      });
    } else {
      await ctx.reply(caption, {
        parse_mode,
        reply_markup: kb,
      });
    }
  }

  async function rerenderShopBrowseAfterRefresh(
    ctx: BotContext,
    target: ShopRefreshRerenderTarget,
  ): Promise<void> {
    const render = async (): Promise<void> => {
      switch (target.kind) {
        case "subcategory":
          await showSubCategoryDetail(ctx, target.subCategoryId);
          return;
        case "category":
          await presentCategoryView(ctx, target.categoryId);
          return;
        case "root":
          await presentShopCategories(ctx, 2);
          return;
      }
    };

    try {
      await render();
    } catch (err) {
      if (isBenignShopRerenderError(err)) return;
      console.warn("[shop refresh] rerender failed:", err);
      try {
        await presentShopCategories(ctx, 2);
      } catch (fallbackErr) {
        if (!isBenignShopRerenderError(fallbackErr)) {
          console.warn("[shop refresh] fallback rerender failed:", fallbackErr);
        }
      }
    }
  }

  async function handleShopPriceStockRefresh(
    ctx: BotContext,
    explicitCategoryId?: number,
  ): Promise<void> {
    const toast = await resolveShopRefreshToast();
    await answerShopRefreshCallbackOnce(ctx, toast);
    const target = pickShopRefreshRerenderTarget(ctx.session, explicitCategoryId);
    await rerenderShopBrowseAfterRefresh(ctx, target);
  }

  bot.command("start", async (ctx) => {
    await exitAllConversations(ctx);
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
      { parse_mode: "Markdown", reply_markup: await adminHomeKeyboardAsync() },
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
    await exitAllConversations(ctx);
    await handleCancelInvoice(ctx);
  });

  bot.callbackQuery(Callbacks.mainMenu, async (ctx) => {
    await ctx.answerCallbackQuery();
    await exitAllConversations(ctx);
    await presentCmsPage(ctx, "home", "edit");
  });

  bot.callbackQuery(Callbacks.shop, async (ctx) => {
    await ctx.answerCallbackQuery();
    await exitAllConversations(ctx);
    await presentCmsPage(ctx, "shop", "edit");
  });

  bot.callbackQuery(Callbacks.shopRoot, async (ctx) => {
    await ctx.answerCallbackQuery();
    await exitAllConversations(ctx);
    await presentShopCategories(ctx, 2);
  });

  bot.callbackQuery(Callbacks.shopSearch, async (ctx) => {
    await startShopSearch(ctx);
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
    await exitAllConversations(ctx);
    const categoryId = Number(ctx.match![1]);
    ctx.session.lastCategoryId = categoryId;
    ctx.session.lastShopSubCategoryId = undefined;
    await presentCategoryView(ctx, categoryId);
  });

  bot.callbackQuery(/^cat:refresh:(\d+)$/, async (ctx) => {
    const categoryId = Number(ctx.match![1]);
    await handleShopPriceStockRefresh(ctx, categoryId);
  });

  bot.callbackQuery(Callbacks.shopRefresh, async (ctx) => {
    await handleShopPriceStockRefresh(ctx);
  });

  bot.callbackQuery(/^(?:subcat|subcat:view):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await exitAllConversations(ctx);
    const subCategoryId = Number(ctx.match![1]);
    ctx.session.lastShopSubCategoryId = subCategoryId;
    const sub = await catalogService.getSubCategoryById(subCategoryId);
    if (sub) ctx.session.lastCategoryId = sub.categoryId;
    await showSubCategoryDetail(ctx, subCategoryId);
  });

  bot.callbackQuery(Callbacks.shopToggleOutOfStock, async (ctx) => {
    if (!ctx.from || !(await hasAnyAdminAccess(ctx.from.id))) {
      await ctx.answerCallbackQuery({ text: "⛔ دسترسی غیرمجاز", show_alert: true });
      return;
    }
    const showing = await toggleShopShowOutOfStock(ctx);
    await ctx.answerCallbackQuery({
      text: showing ? "ناموجودها نمایش داده می‌شوند" : "ناموجودها مخفی شدند",
    });
    const subId = ctx.session.lastShopSubCategoryId;
    if (subId != null) {
      await showSubCategoryDetail(ctx, subId);
      return;
    }
    if (ctx.session.lastCategoryId != null) {
      await presentCategoryView(ctx, ctx.session.lastCategoryId);
      return;
    }
    await presentShopCategories(ctx, 2);
  });

  bot.callbackQuery(/^(?:prod|prod:view):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const productId = Number(ctx.match![1]);
    await showProductDetail(ctx, productId);
  });

  bot.callbackQuery(/^prod:desc:(\d+)$/, async (ctx) => {
    const productId = Number(ctx.match![1]);
    await sendProductDescriptionContinuation(ctx, productId);
  });

  bot.callbackQuery(/^buy:(\d+)$/, async (ctx) => {
    const productId = Number(ctx.match![1]);
    const user = await invoiceService.ensureUser(BigInt(ctx.from.id));
    const product = await catalogService.getProduct(productId, false);

    if (!product) {
      await ctx.answerCallbackQuery({ text: "محصول یافت نشد", show_alert: true });
      return;
    }

    if (await isProductOutOfStockById(productId)) {
      await ctx.answerCallbackQuery({ text: OUT_OF_STOCK_ALERT, show_alert: true });
      return;
    }

    const existing = await invoiceService.getOpenInvoice(user.id);
    if (existing) {
      const refreshed = await invoiceService.refreshInvoicePriceIfUsd(existing.id);
      const invoiceToShow: InvoiceWithProduct = refreshed?.invoice ?? existing;
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
          ...renderInvoiceAmountLines(invoiceToShow),
          `📊 وضعیت: *${invoiceToShow.status}*`,
          `⏳ انقضا: ${formatExpiresAt(invoiceToShow.expiresAt)}`,
        ].join("\n"),
        {
          parse_mode: "Markdown",
          reply_markup: pendingInvoiceKeyboard(invoiceToShow.id, {
            hasDiscount: Boolean(invoiceToShow.discountCode),
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
    const product = await catalogService.getProduct(productId, false);

    if (!product) {
      await ctx.answerCallbackQuery({ text: "محصول یافت نشد", show_alert: true });
      return;
    }

    if (await isProductOutOfStockById(productId)) {
      await ctx.answerCallbackQuery({ text: OUT_OF_STOCK_ALERT, show_alert: true });
      return;
    }

    if (product.deliveryType !== "USER_CHOICE") {
      await ctx.answerCallbackQuery({ text: "این محصول انتخاب پویا ندارد", show_alert: true });
      return;
    }

    const existing = await invoiceService.getOpenInvoice(user.id);
    if (existing) {
      const refreshed = await invoiceService.refreshInvoicePriceIfUsd(existing.id);
      const invoiceToShow: InvoiceWithProduct = refreshed?.invoice ?? existing;
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
          ...renderInvoiceAmountLines(invoiceToShow),
          `📊 وضعیت: *${invoiceToShow.status}*`,
          `⏳ انقضا: ${formatExpiresAt(invoiceToShow.expiresAt)}`,
        ].join("\n"),
        {
          parse_mode: "Markdown",
          reply_markup: pendingInvoiceKeyboard(invoiceToShow.id, {
            hasDiscount: Boolean(invoiceToShow.discountCode),
          }),
        },
      );
      return;
    }

    ctx.session.checkoutDeliveryPreference = deliveryPreference;

    const guard = await verifyBeforeCheckout(productId);
    const proceed = await handlePrePaymentGuardResult(ctx, user.id, guard);
    if (!proceed) return;

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
      ctx.session.checkoutDeliveryPreference = undefined;

      await safeEdit(
        ctx,
        [
          "✅ *فاکتور ساخته شد*",
          "",
          `🧾 شماره: *#${invoice.id}*`,
          `${emojiForLabel(product.name)} محصول: *${product.name}*`,
          ...renderInvoiceAmountLines(invoice),
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
    await showPaymentMethodSelection(ctx, invoiceId);
  });

  bot.callbackQuery(/^pay:confirm_new:(\d+)$/, async (ctx) => {
    const invoiceId = Number(ctx.match![1]);
    await ctx.answerCallbackQuery({ text: "ادامه پرداخت…" });
    await showPaymentMethodSelection(ctx, invoiceId, { skipLiveGuard: true });
  });

  bot.callbackQuery(/^pay:cancel_new:(\d+)$/, async (ctx) => {
    const invoiceId = Number(ctx.match![1]);
    const user = await invoiceService.ensureUser(BigInt(ctx.from.id));
    try {
      await invoiceService.cancelInvoice(user.id, invoiceId);
    } catch {
      /* ignore */
    }
    ctx.session.checkoutProductId = undefined;
    await ctx.answerCallbackQuery({ text: "پرداخت لغو شد" });
    await ctx.reply("❌ پرداخت لغو شد. می‌توانید از فروشگاه دوباره انتخاب کنید.", {
      reply_markup: menuKb(false, ctx.from!.id),
    });
  });

  bot.callbackQuery(/^buy:confirm_new:(\d+)$/, async (ctx) => {
    const productId = Number(ctx.match![1]);
    if (!ctx.from) return;
    const user = await invoiceService.ensureUser(BigInt(ctx.from.id));
    const product = await catalogService.getProduct(productId, false);
    if (!product) {
      await ctx.answerCallbackQuery({ text: "محصول یافت نشد", show_alert: true });
      return;
    }

    const deliveryPreference =
      ctx.session.checkoutDeliveryPreference ??
      (product.deliveryType === "USER_CHOICE" ? "READY" : undefined);

    if (product.deliveryType === "USER_CHOICE" && !deliveryPreference) {
      await ctx.answerCallbackQuery({ text: "ابتدا نوع تحویل را انتخاب کنید", show_alert: true });
      return;
    }

    const guard = await verifyBeforeCheckout(productId);
    if (guard.status === "OUT_OF_STOCK") {
      await handlePrePaymentGuardResult(ctx, user.id, guard);
      return;
    }

    await ctx.answerCallbackQuery({ text: "ادامه خرید…" });

    try {
      const invoice = await invoiceService.createPendingInvoice(
        user.id,
        productId,
        undefined,
        deliveryPreference,
      );
      ctx.session.checkoutDeliveryPreference = undefined;
      await ctx.reply(
        [
          "✅ *فاکتور ساخته شد*",
          "",
          `🧾 شماره: *#${invoice.id}*`,
          `${emojiForLabel(product.name)} محصول: *${product.name}*`,
          ...renderInvoiceAmountLines(invoice),
          "",
          "روش پرداخت را انتخاب کنید:",
        ].join("\n"),
        {
          parse_mode: "Markdown",
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

  bot.callbackQuery(Callbacks.buyCancelNewPrice, async (ctx) => {
    ctx.session.checkoutProductId = undefined;
    ctx.session.checkoutDeliveryPreference = undefined;
    await ctx.answerCallbackQuery({ text: "خرید لغو شد" });
    await ctx.reply("❌ خرید لغو شد.", { reply_markup: menuKb(false, ctx.from!.id) });
  });

  bot.callbackQuery(/^(?:discount:apply:|inv:dsc:)(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const invoiceId = Number(ctx.match![1]);
    ctx.session.discountInvoiceId = invoiceId;
    ctx.session.pendingInvoiceId = invoiceId;
    await exitAllConversations(ctx);
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

    const guard = await verifyBeforePayment(invoiceId);
    const proceed = await handlePrePaymentGuardResult(ctx, user.id, guard);
    if (!proceed) return;

    const refreshed = await invoiceService.refreshInvoicePriceIfUsd(invoiceId);
    const currentPending: InvoiceWithProduct = refreshed?.invoice ?? pending;
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
            { hasDiscount: Boolean(currentPending.discountCode) },
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
      logHandlerError("pay:wallet", err);
      await ctx.answerCallbackQuery({
        text: "مشکلی در پردازش پیش آمد، لطفاً دوباره تلاش کنید.",
        show_alert: true,
      });
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
    const msg = "❌ عملیات لغو شد.";
    const telegramId = ctx.from!.id;
    if (fromCallback && ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: "لغو شد" });
      await safeEdit(ctx, msg, {
        reply_markup: menuKb(false, telegramId),
      }).catch(() => ctx.reply(msg, { reply_markup: menuKb(false, telegramId) }));
    } else {
      await ctx.reply(msg, {
        reply_markup: menuKb(false, telegramId),
      });
    }
  }
}
