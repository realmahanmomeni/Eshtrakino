import { createConversation } from "@grammyjs/conversations";
import { type Bot } from "grammy";
import type { BotContext } from "../context";
import { catalogService } from "../../services/catalog/CatalogService";
import { invoiceService } from "../../services/invoices/InvoiceService";
import { paymentMethodService } from "../../services/paymentMethods/PaymentMethodService";
import { groupLogger } from "../../services/logger/GroupLogger";
import { ticketService } from "../../services/tickets/TicketService";
import {
  categoriesKeyboard,
  chooseDeliveryPreferenceKeyboard,
  mainMenuKeyboard,
  paymentMethodsKeyboard,
  pendingInvoiceKeyboard,
  productDetailKeyboard,
  productsKeyboard,
} from "../keyboards/builders";
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
import { registerUserHandlers } from "../user/handlers";
import { registerSwapHandlers } from "../user/swapHandlers";
import { safeEdit, safeEditMedia } from "../utils/safeEdit";
import { presentCmsPage } from "../cms/presentPage";
import { pageContentService } from "../../services/cms/PageContentService";

function menuKb(hasPending: boolean, telegramId?: number) {
  return mainMenuKeyboard(hasPending, isAdminTelegramId(telegramId));
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

  const amount = formatToman(pending.amount);
  const instructions = paymentMethodService.buildInstructions(
    method,
    amount,
    pending.product.name,
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
  registerUserHandlers(bot);
  registerSwapHandlers(bot);
  bot.use(createConversation(checkoutConversation, "checkout"));
  bot.use(createConversation(uploadReceiptConversation, "uploadReceipt"));

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

    // Touch user so pending balance logic stays warm; page body is CMS-driven
    void user;
    await presentCmsPage(ctx, "home", "reply");
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

    const products = await catalogService.listActiveProductsByCategory(categoryId);
    const user = await invoiceService.ensureUser(BigInt(ctx.from.id));
    const pending = await invoiceService.getOpenInvoice(user.id);

    if (products.length === 0) {
      const shopPage = await pageContentService.getPage("shop");
      await safeEditMedia(
        ctx,
        BannerAssets.category,
        [
          `${emojiForLabel(category.name)} *${category.name}*`,
          "",
          "فعلا محصول فعالی در این دسته وجود ندارد.",
        ].join("\n"),
        categoriesKeyboard(
          await catalogService.listActiveCategories(),
          shopPage.layoutColumns,
        ),
      );
      return;
    }

    const shopPage = await pageContentService.getPage("shop");
    await safeEditMedia(
      ctx,
      BannerAssets.category,
      [
        `${emojiForLabel(category.name)} *${category.name}*`,
        "",
        "📦 محصول مورد نظر را انتخاب کنید:",
      ].join("\n"),
      productsKeyboard(products, {
        hasPendingInvoice: Boolean(pending),
        layoutColumns: shopPage.layoutColumns,
      }),
    );
  });

  bot.callbackQuery(/^prod:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const productId = Number(ctx.match![1]);
    const product = await catalogService.getProduct(productId);

    if (!product) {
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
      return;
    }

    const description = catalogService.descriptionOf(product);
    const caption = [
      `${emojiForLabel(product.name)} *${product.name}*`,
      "",
      `💰 قیمت: *${formatToman(product.price)}*`,
      `⏱ زمان تحویل: *${deliveryTypeLabel(product.deliveryType)}*`,
      "",
      "🔖 *توضیحات محصول*",
      "",
      description,
      "",
      "👇 برای ادامه، دکمه خرید را بزنید:",
    ].join("\n");

    const media = product.bannerFileId?.trim() || BannerAssets.category;

    await safeEditMedia(
      ctx,
      media,
      caption,
      productDetailKeyboard(product.id, product.categoryId),
    );
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
          `🧾 شماره: *#${existing.id}*`,
          `📦 مورد: *${invoiceItemLabel(existing)}*`,
          `💵 مبلغ: *${formatToman(existing.amount)}*`,
          `📊 وضعیت: *${existing.status}*`,
          `⏳ انقضا: ${formatExpiresAt(existing.expiresAt)}`,
        ].join("\n"),
        {
          parse_mode: "Markdown",
          reply_markup: pendingInvoiceKeyboard(existing.id),
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
          `🧾 شماره: *#${existing.id}*`,
          `📦 مورد: *${invoiceItemLabel(existing)}*`,
          `💵 مبلغ: *${formatToman(existing.amount)}*`,
          `📊 وضعیت: *${existing.status}*`,
          `⏳ انقضا: ${formatExpiresAt(existing.expiresAt)}`,
        ].join("\n"),
        {
          parse_mode: "Markdown",
          reply_markup: pendingInvoiceKeyboard(existing.id),
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
          `💵 مبلغ: *${formatToman(invoice.amount)}*`,
          `📊 وضعیت: *${invoice.status}*`,
          `🚚 روش انتخاب شده: *${deliveryTypeLabel(deliveryPreference)}*`,
          "",
          "روش پرداخت را انتخاب کنید:",
        ].join("\n"),
        {
          reply_markup: await buildCheckoutPaymentKeyboard(
            invoice.id,
            formatToman(user.balance),
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
        `🧾 فاکتور: *#${pending.id}*`,
        `📦 مورد: *${invoiceItemLabel(pending)}*`,
        `💵 مبلغ: *${formatToman(pending.amount)}*`,
        "",
        "روش پرداخت را انتخاب کنید:",
      ].join("\n"),
      {
        parse_mode: "Markdown",
        reply_markup: await buildCheckoutPaymentKeyboard(
          invoiceId,
          formatToman(user.balance),
        ),
      },
    );
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

    const price = Number(pending.amount);
    const balance = Number(user.balance);
    if (balance < price) {
      await ctx.answerCallbackQuery({ text: "موجودی کافی نیست", show_alert: true });
      await safeEdit(
        ctx,
        [
          "❌ *موجودی کافی نیست*",
          "",
          `💵 مبلغ فاکتور: *${formatToman(pending.amount)}*`,
          `💰 موجودی کیف پول: *${formatToman(user.balance)}*`,
          "",
          "لطفاً کیف پول را شارژ کنید، سواپ ولت یا کارت به کارت را انتخاب کنید.",
        ].join("\n"),
        {
          parse_mode: "Markdown",
          reply_markup: await buildCheckoutPaymentKeyboard(
            invoiceId,
            formatToman(user.balance),
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
