import type { DeliveryType, PaymentMethodType } from "@prisma/client";
import type { EshtrakinoConversation, SessionContext } from "../context";
import { catalogService } from "../../services/catalog/CatalogService";
import { paymentMethodService } from "../../services/paymentMethods/PaymentMethodService";
import { invoiceService } from "../../services/invoices/InvoiceService";
import { formatToman, parsePrice } from "../../lib/money";
import { exchangeRateService, convertUsdToToman } from "../../services/exchangeRateService";
import { toPlain } from "../../lib/plain";
import {
  waitCallback,
  waitOptionalPhoto,
  waitText,
  ensurePanel,
  panelFromCtx,
  waitTextOnPanel,
  waitCallbackOnPanel,
  type PanelRef,
} from "../conversations/wait";
import { safeDeleteMessage } from "../utils/safeEdit";
import {
  adminBackupMenuKeyboard,
  adminCatalogKeyboard,
  adminSubCategoriesKeyboard,
  adminHomeKeyboardAsync,
  adminForceJoinKeyboard,
  adminPaymentListKeyboard,
  adminPaymentsKeyboard,
  convCategoryPickKeyboard,
  convSubCategoryPickKeyboard,
  convDeliveryAddProductKeyboard,
  convPaymentTypeKeyboard,
  convDiscountScopeKeyboard,
  convDiscountProductsMultiSelectKeyboard,
  convDiscountTier1CategoriesKeyboard,
  convDiscountTier2CategoryContentsKeyboard,
  convDiscountTier3PlansKeyboard,
  adminDiscountHubKeyboard,
  convDiscountBatchDeleteKeyboard,
  ConvCb,
} from "./keyboards";
import { discountService } from "../../services/discount/DiscountService";
import { env } from "../../config/env";
import { InlineKeyboard } from "grammy";
import { ticketService } from "../../services/tickets/TicketService";
import {
  presentCmsCategoryView,
  presentCmsCategoryList,
  presentCmsSubCategoryView,
  presentCmsSubCategoryList,
} from "../cms/shopCms";
import {
  settingsService,
  AUTO_BACKUP_HOURS_KEY,
  LOG_GROUP_ID_KEY,
  LOW_STOCK_THRESHOLD_KEY,
  SWAPPAY_API_KEY,
  SWAPPAY_ENABLED,
  SWAPPAY_WALLET_ADDRESS,
  FORCE_JOIN_ENABLED,
  FORCE_JOIN_CHANNEL_ID,
  FORCE_JOIN_INVITE_LINK,
  FORCE_JOIN_TEXT,
} from "../../services/settings/SettingsService";

/** Extract Telegram supergroup id (e.g. -1001234567890) from admin input. */
function parseLogGroupId(raw: string): string | null {
  const match = raw.trim().match(/-100\d{5,}/);
  if (match) return match[0];
  const generic = raw.trim().match(/-?\d{5,}/);
  return generic?.[0] ?? null;
}

export async function addCategoryConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  try {
    const name = await waitText(
      conversation,
      ctx,
      [
        "📦 *افزودن دسته بندی*",
        "",
        "نام دسته جدید را بفرستید:",
      ].join("\n"),
    );
    if (!name) {
      await ctx.reply(
        ["❌ *عملیات لغو شد*", "", "از منوی کاتالوگ دوباره شروع کنید."].join("\n"),
        { parse_mode: "Markdown", reply_markup: adminCatalogKeyboard() },
      );
      return;
    }

    const category = await conversation.external(async () =>
      toPlain(await catalogService.createCategory(name)),
    );
    await ctx.reply(
      ["✅ *دسته اضافه شد*", "", `📦 نام: *${category.name}*`].join("\n"),
      { parse_mode: "Markdown", reply_markup: adminCatalogKeyboard() },
    );
  } catch (err) {
    console.error("addCategoryConversation error:", err);
    await ctx.reply(
      ["⚠️ *خطا در افزودن دسته*", "", "لطفا دوباره تلاش کنید."].join("\n"),
      { parse_mode: "Markdown", reply_markup: adminCatalogKeyboard() },
    );
  }
}

export async function addSubCategoryConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  try {
    const categories = await conversation.external(async () =>
      toPlain(await catalogService.listActiveCategories()),
    );
    if (categories.length === 0) {
      await ctx.reply("⚠️ ابتدا یک دسته فعال بسازید.", {
        reply_markup: adminCatalogKeyboard(),
      });
      return;
    }

    const catData = await waitCallback(
      conversation,
      ctx,
      [
        "🗂 *افزودن سرویس — مرحله ۱ از ۳*",
        "",
        "دسته والد (اصلی) را انتخاب کنید:",
      ].join("\n"),
      convCategoryPickKeyboard(categories),
    );
    if (!catData) {
      await ctx.reply("عملیات لغو شد.", { reply_markup: adminSubCategoriesKeyboard() });
      return;
    }
    const catMatch = /^conv:cat:(\d+)$/.exec(catData);
    if (!catMatch) {
      await ctx.reply("انتخاب نامعتبر بود.", { reply_markup: adminSubCategoriesKeyboard() });
      return;
    }
    const categoryId = Number(catMatch[1]);
    const category = categories.find((c) => c.id === categoryId);
    if (!category) {
      await ctx.reply("دسته یافت نشد.", { reply_markup: adminSubCategoriesKeyboard() });
      return;
    }

    const name = await waitText(
      conversation,
      ctx,
      [
        "📝 *مرحله ۲ از ۳ — نام سرویس*",
        "",
        `دسته والد: *${category.name}*`,
        "",
        "نام سرویس / زیردسته را وارد کنید (مثال: `Gemini Pro` یا `Spotify Premium`):",
      ].join("\n"),
    );
    if (!name) {
      await ctx.reply("عملیات لغو شد.", { reply_markup: adminSubCategoriesKeyboard() });
      return;
    }

    const descChoice = await waitCallback(
      conversation,
      ctx,
      [
        "🔖 *مرحله ۳ از ۳ — توضیحات سرویس*",
        "",
        "آیا می‌خواهید توضیحات برای این سرویس ثبت کنید؟",
      ].join("\n"),
      new InlineKeyboard()
        .text("✍️ وارد کردن توضیحات", "conv:subcat:enter_desc")
        .text("⏩ رد کردن (بدون توضیحات)", "conv:subcat:skip_desc")
        .row()
        .text("❌ لغو", ConvCb.cancel),
    );

    let description: string | null = null;
    if (descChoice === "conv:subcat:enter_desc") {
      description = await waitText(
        conversation,
        ctx,
        "لطفاً متن توضیحات سرویس را ارسال کنید:",
      );
    }

    const subCategory = await conversation.external(async () =>
      toPlain(
        await catalogService.createSubCategory({
          name,
          categoryId,
          description,
        }),
      ),
    );

    await ctx.reply(
      [
        "✅ *سرویس با موفقیت ثبت شد*",
        "",
        `📑 نام سرویس: *${subCategory.name}*`,
        `🗂 دسته والد: *${category.name}*`,
        ...(description ? [`🔖 توضیحات: ${description}`] : []),
      ].join("\n"),
      { parse_mode: "Markdown", reply_markup: adminSubCategoriesKeyboard() },
    );
  } catch (err) {
    console.error("addSubCategoryConversation error:", err);
    await ctx.reply("⚠️ خطا در افزودن سرویس. دوباره تلاش کنید.", {
      reply_markup: adminSubCategoriesKeyboard(),
    });
  }
}

/**
 * Add Product flow:
 * 1) Select Category
 * 2) Select SubCategory / Service (optional / create on the fly)
 * 3) Enter Plan / Product Name
 * 4) Enter Price & Currency
 * 5) Select Delivery Type
 * 6) Enter Description
 * 7) Enter Banner
 */
export async function addProductConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  let panel: PanelRef | null = panelFromCtx(ctx);

  try {
    const categories = await conversation.external(async () =>
      toPlain(await catalogService.listActiveCategories()),
    );
    if (categories.length === 0) {
      await ensurePanel(
        ctx,
        "⚠️ ابتدا یک دسته فعال بسازید.",
        adminCatalogKeyboard(),
        panel,
      );
      return;
    }

    const catPrompt = [
      "🗂 *افزودن محصول — مرحله ۱*",
      "",
      "دسته مورد نظر را انتخاب کنید:",
    ].join("\n");

    const catRes = await waitCallbackOnPanel(
      conversation,
      ctx,
      catPrompt,
      convCategoryPickKeyboard(categories),
      panel,
    );
    panel = catRes.panel;
    if (!catRes.data || catRes.data === ConvCb.cancel) {
      await ensurePanel(ctx, "عملیات لغو شد.", adminCatalogKeyboard(), panel);
      return;
    }
    const catMatch = /^conv:cat:(\d+)$/.exec(catRes.data);
    if (!catMatch) {
      await ensurePanel(ctx, "انتخاب نامعتبر بود.", adminCatalogKeyboard(), panel);
      return;
    }
    const categoryId = Number(catMatch[1]);
    const category = categories.find((c) => c.id === categoryId);
    if (!category) {
      await ensurePanel(ctx, "دسته یافت نشد.", adminCatalogKeyboard(), panel);
      return;
    }

    // Step 2: Select SubCategory (Service)
    const subCategories = await conversation.external(async () =>
      toPlain(await catalogService.listSubCategoriesByCategory(categoryId, true)),
    );

    let subCategoryId: number | null = null;
    let subCategoryName: string | null = null;

    const subKb = convSubCategoryPickKeyboard(subCategories, {
      allowSkip: true,
      allowAddNew: true,
    });

    const subPrompt = [
      "📑 *افزودن محصول — مرحله ۲ (انتخاب سرویس)*",
      "",
      `دسته والد: *${category.name}*`,
      "",
      "سرویس / زیردسته مربوطه را انتخاب کنید:",
      "(برای ساخت سرویس جدید «➕ افزودن سرویس جدید» و در صورت عدم نیاز «⏩ بدون سرویس» را انتخاب کنید)",
    ].join("\n");

    const subRes = await waitCallbackOnPanel(
      conversation,
      ctx,
      subPrompt,
      subKb,
      panel,
    );
    panel = subRes.panel;

    if (!subRes.data || subRes.data === ConvCb.cancel) {
      await ensurePanel(ctx, "عملیات لغو شد.", adminCatalogKeyboard(), panel);
      return;
    }

    if (subRes.data === "conv:subcat:none") {
      subCategoryId = null;
    } else if (subRes.data === "conv:subcat:add") {
      const newSubPrompt = [
        "➕ *افزودن سرویس جدید*",
        "",
        `دسته والد: *${category.name}*`,
        "",
        "نام سرویس جدید را در چت تایپ و ارسال کنید (مثال: `Gemini Pro`):",
      ].join("\n");

      const newSubRes = await waitTextOnPanel(
        conversation,
        ctx,
        newSubPrompt,
        panel,
      );
      panel = newSubRes.panel;
      if (!newSubRes.text) {
        await ensurePanel(ctx, "عملیات لغو شد.", adminCatalogKeyboard(), panel);
        return;
      }
      const newSubName = newSubRes.text.trim();
      const newSub = await conversation.external(async () =>
        toPlain(
          await catalogService.createSubCategory({
            name: newSubName,
            categoryId,
          }),
        ),
      );
      subCategoryId = newSub.id;
      subCategoryName = newSub.name;
    } else {
      const subMatch = /^conv:subcat:(\d+)$/.exec(subRes.data);
      if (!subMatch) {
        await ensurePanel(ctx, "انتخاب نامعتبر بود.", adminCatalogKeyboard(), panel);
        return;
      }
      subCategoryId = Number(subMatch[1]);
      const foundSub = subCategories.find((s) => s.id === subCategoryId);
      if (foundSub) subCategoryName = foundSub.name;
    }

    // Step 3: Enter Plan / Product Name
    const namePrompt = [
      "📝 *مرحله ۳ — نام پلن / محصول*",
      "",
      subCategoryName ? `سرویس: *${subCategoryName}*` : `دسته: *${category.name}*`,
      "",
      "لطفاً نام محصول یا پلن را در چت تایپ و ارسال کنید:",
      "(مثلاً: `اشتراک ۱ ماهه` یا `پلن سالانه`)",
    ].join("\n");

    const nameRes = await waitTextOnPanel(conversation, ctx, namePrompt, panel);
    panel = nameRes.panel;
    if (!nameRes.text) {
      await ensurePanel(ctx, "عملیات لغو شد.", adminCatalogKeyboard(), panel);
      return;
    }
    const name = nameRes.text.trim();

    // Step 4: Price Unit
    const currPrompt = [
      "💵 *مرحله ۴ — واحد قیمت‌گذاری*",
      "",
      `محصول: *${name}*`,
      "",
      "واحد قیمت‌گذاری محصول را انتخاب کنید:",
    ].join("\n");

    const currKb = new InlineKeyboard()
      .text("💵 قیمت دلاری (USD)", "conv:prod_curr:USD")
      .text("🇮🇷 قیمت تومانی (TOMAN)", "conv:prod_curr:TOMAN")
      .row()
      .text("❌ لغو", ConvCb.cancel);

    const currRes = await waitCallbackOnPanel(
      conversation,
      ctx,
      currPrompt,
      currKb,
      panel,
    );
    panel = currRes.panel;
    if (!currRes.data || currRes.data === ConvCb.cancel) {
      await ensurePanel(ctx, "عملیات لغو شد.", adminCatalogKeyboard(), panel);
      return;
    }

    let currency = "TOMAN";
    let price: number | null = null;
    let usdPrice: number | null = null;

    if (currRes.data === "conv:prod_curr:USD") {
      currency = "USD";
      for (let attempt = 0; attempt < 5 && usdPrice === null; attempt++) {
        const usdPrompt =
          attempt === 0
            ? [
                "💵 *قیمت دلاری (USD)*",
                "",
                `محصول: *${name}*`,
                "",
                "قیمت محصول را به *دلار* در چت بفرستید (مثلاً `5` یا `9.99`):",
              ].join("\n")
            : [
                "⚠️ *قیمت دلاری نامعتبر*",
                "",
                `محصول: *${name}*`,
                "",
                "دوباره عدد دلار را بفرستید (مثلاً `5` یا `9.99`):",
              ].join("\n");

        const usdRes = await waitTextOnPanel(conversation, ctx, usdPrompt, panel);
        panel = usdRes.panel;
        if (!usdRes.text) {
          await ensurePanel(ctx, "عملیات لغو شد.", adminCatalogKeyboard(), panel);
          return;
        }
        const cleaned = usdRes.text.trim().replace(/,/g, ".");
        const n = parseFloat(cleaned);
        if (Number.isFinite(n) && n > 0) {
          usdPrice = Math.round(n * 100) / 100;
        }
      }
      if (usdPrice === null) {
        await ensurePanel(ctx, "قیمت دلاری معتبر دریافت نشد.", adminCatalogKeyboard(), panel);
        return;
      }
      price = await conversation.external(async () => {
        const rate = await exchangeRateService.getUsdRate();
        return convertUsdToToman(usdPrice!, rate);
      });
    } else {
      currency = "TOMAN";
      for (let attempt = 0; attempt < 5 && price === null; attempt++) {
        const pricePrompt =
          attempt === 0
            ? [
                "💵 *قیمت تومانی*",
                "",
                `محصول: *${name}*`,
                "",
                "قیمت محصول را به *تومان* در چت بفرستید (فقط عدد، مثلا `50000`):",
              ].join("\n")
            : [
                "⚠️ *قیمت نامعتبر*",
                "",
                `محصول: *${name}*`,
                "",
                "دوباره مبلغ به تومان را بفرستید (فقط عدد، مثلا `50000`):",
              ].join("\n");

        const priceRes = await waitTextOnPanel(conversation, ctx, pricePrompt, panel);
        panel = priceRes.panel;
        if (!priceRes.text) {
          await ensurePanel(ctx, "عملیات لغو شد.", adminCatalogKeyboard(), panel);
          return;
        }
        price = parsePrice(priceRes.text);
      }
      if (price === null) {
        await ensurePanel(ctx, "قیمت معتبر دریافت نشد.", adminCatalogKeyboard(), panel);
        return;
      }
    }

    // Step 6: Delivery Type
    const delivPrompt = [
      "🚚 *مرحله ۵ — نوع تحویل*",
      "",
      `محصول: *${name}*`,
      "",
      "نوع تحویل را انتخاب کنید:",
    ].join("\n");

    const delivRes = await waitCallbackOnPanel(
      conversation,
      ctx,
      delivPrompt,
      convDeliveryAddProductKeyboard(),
      panel,
    );
    panel = delivRes.panel;
    if (!delivRes.data || delivRes.data === ConvCb.cancel) {
      await ensurePanel(ctx, "عملیات لغو شد.", adminCatalogKeyboard(), panel);
      return;
    }
    const delivMatch = /^conv:deladd:([A-Z_]+)$/.exec(delivRes.data);
    if (!delivMatch) {
      await ensurePanel(ctx, "انتخاب نامعتبر بود.", adminCatalogKeyboard(), panel);
      return;
    }
    const deliveryType = delivMatch[1] as DeliveryType;

    // Step 7: Description (optional)
    const descPrompt = [
      "📝 *مرحله ۶ — توضیحات محصول (اختیاری)*",
      "",
      `محصول: *${name}*`,
      "",
      "توضیحات محصول را در چت تایپ و ارسال کنید یا دکمه «⏩ بدون توضیحات» را انتخاب کنید:",
      "",
      "(این متن در صفحه جزئیات محصول نمایش داده می‌شود)",
    ].join("\n");

    const descKb = new InlineKeyboard()
      .text("⏩ بدون توضیحات", "conv:prd:skip_desc")
      .row()
      .text("❌ لغو", ConvCb.cancel);

    panel = await ensurePanel(ctx, descPrompt, descKb, panel);

    let description: string | null = null;
    while (true) {
      const update = await conversation.waitFor(["message:text", "callback_query:data"]);
      const rawText = (update.message?.text ?? "").trim();
      if (rawText === "/start" || rawText.startsWith("/start ")) {
        return;
      }
      if (update.callbackQuery?.data === ConvCb.cancel || rawText === "/cancel") {
        if (update.callbackQuery) {
          try {
            await update.answerCallbackQuery({ text: "لغو شد" });
          } catch {}
        }
        await ensurePanel(update, "عملیات لغو شد.", adminCatalogKeyboard(), panel);
        return;
      }

      if (update.callbackQuery?.data === "conv:prd:skip_desc") {
        try {
          await update.answerCallbackQuery({ text: "بدون توضیحات" });
        } catch {}
        description = null;
        break;
      }

      if (update.callbackQuery) {
        try {
          await update.answerCallbackQuery();
        } catch {}
        continue;
      }

      const text = (update.message?.text ?? "").trim();
      if (text) {
        if (update.chat && update.message) {
          await safeDeleteMessage(update.api, update.chat.id, update.message.message_id);
        }
        if (text === "-" || text === "بدون توضیحات" || text === "skip" || text === "رد") {
          description = null;
        } else {
          description = text;
        }
        break;
      }
    }

    // Step 8: Banner Photo (optional)
    const bannerPrompt = [
      "🖼 *مرحله ۷ — بنر محصول (اختیاری)*",
      "",
      `محصول: *${name}*`,
      "",
      "تصویر بنر محصول را بفرستید، یا دکمه «⏭ بدون بنر» را انتخاب کنید:",
    ].join("\n");

    const bannerKb = new InlineKeyboard()
      .text("⏭ بدون بنر", ConvCb.skipPhoto)
      .row()
      .text("❌ لغو", ConvCb.cancel);

    panel = await ensurePanel(ctx, bannerPrompt, bannerKb, panel);

    let bannerFileId: string | null = null;
    while (true) {
      const update = await conversation.waitFor([
        "message:photo",
        "message:document",
        "message:text",
        "callback_query:data",
      ]);

      const rawText = (update.message?.text ?? "").trim();
      if (rawText === "/start" || rawText.startsWith("/start ")) {
        return;
      }
      if (update.callbackQuery?.data === ConvCb.cancel || rawText === "/cancel") {
        if (update.callbackQuery) {
          try {
            await update.answerCallbackQuery({ text: "لغو شد" });
          } catch {}
        }
        await ensurePanel(update, "عملیات لغو شد.", adminCatalogKeyboard(), panel);
        return;
      }

      if (update.callbackQuery?.data === ConvCb.skipPhoto) {
        try {
          await update.answerCallbackQuery({ text: "بدون بنر" });
        } catch {}
        bannerFileId = null;
        break;
      }

      if (update.callbackQuery) {
        try {
          await update.answerCallbackQuery({ text: "عکس بفرستید یا «بدون بنر» را بزنید" });
        } catch {}
        continue;
      }

      const photos = update.message?.photo;
      if (photos && photos.length > 0) {
        if (update.chat && update.message) {
          await safeDeleteMessage(update.api, update.chat.id, update.message.message_id);
        }
        bannerFileId = photos[photos.length - 1]!.file_id;
        break;
      }

      const doc = update.message?.document;
      if (doc?.mime_type?.startsWith("image/")) {
        if (update.chat && update.message) {
          await safeDeleteMessage(update.api, update.chat.id, update.message.message_id);
        }
        bannerFileId = doc.file_id;
        break;
      }

      const text = (update.message?.text ?? "").trim();
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
        if (update.chat && update.message) {
          await safeDeleteMessage(update.api, update.chat.id, update.message.message_id);
        }
        bannerFileId = null;
        break;
      }

      if (update.chat && update.message) {
        await safeDeleteMessage(update.api, update.chat.id, update.message.message_id);
      }
    }

    const product = await conversation.external(async () =>
      toPlain(
        await catalogService.createProduct({
          name,
          price: price!,
          currency,
          usdPrice,
          categoryId,
          subCategoryId,
          deliveryType,
          description,
          bannerFileId,
          requiredFields: [],
        }),
      ),
    );

    const bannerLine = bannerFileId ? "🖼 بنر: *ثبت شد*" : "🖼 بنر: *ندارد*";
    const subLine = subCategoryName ? `📑 سرویس: *${subCategoryName}*` : null;
    const priceDisplay =
      currency === "USD" && usdPrice != null
        ? `*$${usdPrice}* (معادل فعلی: *${formatToman(price)}*)`
        : `*${formatToman(price)}*`;

    const successLines = [
      "✅ *محصول با موفقیت ثبت شد*",
      "",
      `📦 نام: *${product.name}*`,
    ];
    if (subLine) successLines.push(subLine);
    successLines.push(
      `🗂 دسته: *${category.name}*`,
      `💵 قیمت: ${priceDisplay}`,
      `🚚 تحویل: *${deliveryType}*`,
      bannerLine,
    );

    await ensurePanel(
      ctx,
      successLines.join("\n"),
      adminCatalogKeyboard(),
      panel,
    );
  } catch (err) {
    console.error("addProductConversation error:", err);
    await ensurePanel(
      ctx,
      "⚠️ خطا در افزودن محصول. دوباره تلاش کنید.",
      adminCatalogKeyboard(),
      panel,
    );
  }
}

export async function addPaymentMethodConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  try {
    const name = await waitText(
      conversation,
      ctx,
      [
        "💳 *افزودن روش پرداخت*",
        "",
        "نام روش را بفرستید (مثلاً کارت به کارت یا ZarinPal):",
      ].join("\n"),
    );
    if (!name) {
      await ctx.reply("عملیات لغو شد.", { reply_markup: adminPaymentsKeyboard() });
      return;
    }

    const typeData = await waitCallback(
      conversation,
      ctx,
      [
        "💳 *نوع روش پرداخت*",
        "",
        "نوع روش پرداخت را انتخاب کنید:",
      ].join("\n"),
      convPaymentTypeKeyboard(),
    );
    if (!typeData) {
      await ctx.reply("عملیات لغو شد.", { reply_markup: adminPaymentsKeyboard() });
      return;
    }

    const typeMatch = /^conv:ptype:(CARD|GATEWAY)$/.exec(typeData);
    if (!typeMatch) {
      await ctx.reply("نوع نامعتبر بود.", { reply_markup: adminPaymentsKeyboard() });
      return;
    }
    const type = typeMatch[1] as PaymentMethodType;

    const secretPrompt =
      type === "CARD"
        ? ["💳 *شماره کارت*", "", "شماره کارت را بفرستید:"].join("\n")
        : ["🔑 *توکن درگاه*", "", "توکن / مرچنت ایدی درگاه را بفرستید:"].join("\n");
    const secret = await waitText(conversation, ctx, secretPrompt);
    if (!secret) {
      await ctx.reply("عملیات لغو شد.", { reply_markup: adminPaymentsKeyboard() });
      return;
    }

    const config =
      type === "CARD" ? { cardNumber: secret.replace(/\s+/g, "") } : { token: secret };

    const method = await conversation.external(async () =>
      toPlain(
        await paymentMethodService.create({ name, type, config, isActive: true }),
      ),
    );

    await ctx.reply(
      [
        "✅ *روش پرداخت اضافه شد*",
        "",
        `💳 نام: *${method.name}*`,
        `📊 نوع: *${method.type}*`,
        "",
        "روش پرداخت فعال شد.",
      ].join("\n"),
      { parse_mode: "Markdown", reply_markup: adminPaymentsKeyboard() },
    );
  } catch (err) {
    console.error("addPaymentMethodConversation error:", err);
    await ctx.reply("⚠️ خطا در افزودن روش پرداخت.", {
      reply_markup: adminPaymentsKeyboard(),
    });
  }
}

export async function configurePaymentConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  try {
    const methodId = await conversation.external((c) => c.session.adminTargetId ?? null);
    if (!methodId) {
      await ctx.reply("روش پرداختی انتخاب نشده.", {
        reply_markup: adminPaymentsKeyboard(),
      });
      return;
    }

    const method = await conversation.external(async () =>
      toPlain(await paymentMethodService.getById(methodId)),
    );
    if (!method) {
      await ctx.reply("روش پرداخت یافت نشد.", { reply_markup: adminPaymentsKeyboard() });
      return;
    }

    let panel = panelFromCtx(ctx);

    if (method.type === "CARD") {
      // Step 1 — 16-digit card number (Fluid UI)
      let cardPrompt = [
        "💳 *تنظیم کارت به کارت*",
        "",
        `روش: *${method.name}*`,
        "",
        "مرحله ۱ از ۲ — *شماره ۱۶ رقمی کارت* را بفرستید:",
      ].join("\n");

      if (!panel) {
        panel = await ensurePanel(ctx, cardPrompt, adminPaymentsKeyboard(), null);
      }

      let cardNumber: string | null = null;
      while (!cardNumber) {
        const waited = await waitTextOnPanel(conversation, ctx, cardPrompt, panel);
        panel = waited.panel;
        if (!waited.text) {
          await conversation.external((c) => {
            c.session.adminTargetId = undefined;
            c.session.adminTargetType = undefined;
          });
          await ensurePanel(
            ctx,
            "❌ عملیات لغو شد.",
            adminPaymentsKeyboard(),
            panel,
          );
          return;
        }

        const digits = waited.text.replace(/[\s\-‑–—]/g, "");
        if (!/^\d{16}$/.test(digits)) {
          cardPrompt = [
            "⚠️ *شماره کارت نامعتبر*",
            "",
            "لطفاً دقیقاً *۱۶ رقم* شماره کارت را بفرستید:",
          ].join("\n");
          continue;
        }
        cardNumber = digits;
      }

      // Step 2 — cardholder full name
      let namePrompt = [
        "👤 *نام دارنده کارت*",
        "",
        `روش: *${method.name}*`,
        "",
        "مرحله ۲ از ۲ — *نام و نام خانوادگی* صاحب کارت را بفرستید:",
      ].join("\n");

      let cardName: string | null = null;
      while (!cardName) {
        const waited = await waitTextOnPanel(conversation, ctx, namePrompt, panel);
        panel = waited.panel;
        if (!waited.text) {
          await conversation.external((c) => {
            c.session.adminTargetId = undefined;
            c.session.adminTargetType = undefined;
          });
          await ensurePanel(
            ctx,
            "❌ عملیات لغو شد.",
            adminPaymentsKeyboard(),
            panel,
          );
          return;
        }

        const name = waited.text.trim().replace(/\s+/g, " ");
        if (name.length < 2) {
          namePrompt = [
            "⚠️ *نام نامعتبر*",
            "",
            "لطفاً نام و نام خانوادگی صاحب کارت را بفرستید:",
          ].join("\n");
          continue;
        }
        cardName = name;
      }

      await conversation.external(async () => {
        await paymentMethodService.updateConfig(methodId, { cardNumber, cardName });
      });
      await conversation.external((c) => {
        c.session.adminTargetId = undefined;
        c.session.adminTargetType = undefined;
      });

      await ensurePanel(
        ctx,
        [
          "✅ *تنظیمات کارت به کارت به روز شد*",
          "",
          `💳 روش: *${method.name}*`,
          `💳 کارت: \`${cardNumber}\``,
          `👤 به نام: *${cardName}*`,
        ].join("\n"),
        adminPaymentsKeyboard(),
        panel,
      );
      return;
    }

    // GATEWAY — single Fluid step for token
    let tokenPrompt = [
      "🔑 *تنظیم درگاه*",
      "",
      `روش: *${method.name}*`,
      "",
      "توکن / مرچنت ایدی جدید را بفرستید:",
    ].join("\n");

    if (!panel) {
      panel = await ensurePanel(ctx, tokenPrompt, adminPaymentsKeyboard(), null);
    }

    const tokenWait = await waitTextOnPanel(conversation, ctx, tokenPrompt, panel);
    panel = tokenWait.panel;
    if (!tokenWait.text) {
      await conversation.external((c) => {
        c.session.adminTargetId = undefined;
        c.session.adminTargetType = undefined;
      });
      await ensurePanel(ctx, "❌ عملیات لغو شد.", adminPaymentsKeyboard(), panel);
      return;
    }

    await conversation.external(async () => {
      await paymentMethodService.updateConfig(methodId, {
        token: tokenWait.text!.trim(),
      });
    });
    await conversation.external((c) => {
      c.session.adminTargetId = undefined;
      c.session.adminTargetType = undefined;
    });

    await ensurePanel(
      ctx,
      [
        "✅ *تنظیمات به روز شد*",
        "",
        `💳 روش: *${method.name}*`,
      ].join("\n"),
      adminPaymentsKeyboard(),
      panel,
    );
  } catch (err) {
    console.error("configurePaymentConversation error:", err);
    await ctx.reply("⚠️ خطا در تنظیم روش پرداخت.", {
      reply_markup: adminPaymentsKeyboard(),
    });
  }
}

export async function rejectInvoiceConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  try {
    const invoiceId = await conversation.external(
      (c) => c.session.adminRejectInvoiceId ?? c.session.adminTargetId ?? null,
    );
    if (!invoiceId) {
      await ctx.reply(
        ["⚠️ *فاکتور نامشخص*", "", "فاکتوری برای رد انتخاب نشده."].join("\n"),
        { parse_mode: "Markdown" },
      );
      return;
    }

    const reason = await waitText(
      conversation,
      ctx,
      [
        "❌ *رد فاکتور*",
        "",
        `لطفا دلیل رد فاکتور *#${invoiceId}* را بنویسید`,
        "(یا برای انصراف /cancel را بفرستید):",
      ].join("\n"),
    );

    if (!reason) {
      await conversation.external((c) => {
        c.session.adminRejectInvoiceId = undefined;
        c.session.adminTargetId = undefined;
        c.session.adminTargetType = undefined;
      });
      await ctx.reply(
        [
          "ℹ️ *رد فاکتور لغو شد*",
          "",
          `🧾 فاکتور: *#${invoiceId}*`,
          "",
          "هیچ تغییری اعمال نشد.",
        ].join("\n"),
        { parse_mode: "Markdown" },
      );
      return;
    }

    const rejectResult = await conversation.external(async () => {
      try {
        const invoice = await invoiceService.reject(invoiceId, reason);
        return {
          ok: true as const,
          invoice: toPlain({
            id: invoice.id,
            amount: invoice.amount,
            status: invoice.status,
            product: invoice.product ? { name: invoice.product.name } : null,
            isWalletTopUp: invoice.isWalletTopUp,
            user: { telegramId: invoice.user.telegramId.toString() },
          }),
        };
      } catch (err) {
        return {
          ok: false as const,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    });

    await conversation.external((c) => {
      c.session.adminRejectInvoiceId = undefined;
      c.session.adminTargetId = undefined;
      c.session.adminTargetType = undefined;
    });

    if (!rejectResult.ok) {
      await ctx.reply(
        [
          "⚠️ *خطا در رد فاکتور*",
          "",
          rejectResult.message || "وضعیت فاکتور را بررسی کنید.",
        ].join("\n"),
        { parse_mode: "Markdown" },
      );
      return;
    }

    const invoice = rejectResult.invoice;
    const itemLabel = invoice.isWalletTopUp
      ? "شارژ کیف پول"
      : invoice.product?.name ?? "—";

    await ctx.reply(
      [
        "❌ *فاکتور رد شد*",
        "",
        `🧾 شماره: *#${invoice.id}*`,
        `📦 مورد: *${itemLabel}*`,
        `💵 مبلغ: *${formatToman(invoice.amount)}*`,
        `📊 وضعیت: *CANCELLED*`,
        "",
        `📝 دلیل: ${reason}`,
        "",
        "به کاربر اطلاع داده شد.",
      ].join("\n"),
      { parse_mode: "Markdown" },
    );

    try {
      await ctx.api.sendMessage(
        String(invoice.user.telegramId),
        [
          "❌ *پرداخت رد شد*",
          "",
          `🧾 فاکتور: *#${invoice.id}*`,
          `📦 مورد: *${itemLabel}*`,
          `💵 مبلغ: *${formatToman(invoice.amount)}*`,
          `📊 وضعیت: *CANCELLED*`,
          "",
          `📝 دلیل: ${reason}`,
          "",
          "در صورت نیاز می توانید دوباره از فروشگاه خرید کنید.",
        ].join("\n"),
        { parse_mode: "Markdown" },
      );
    } catch (err) {
      console.error("Failed to notify buyer of rejection:", err);
    }
  } catch (err) {
    console.error("rejectInvoiceConversation error:", err);
    try {
      await conversation.external((c) => {
        c.session.adminRejectInvoiceId = undefined;
        c.session.adminTargetId = undefined;
        c.session.adminTargetType = undefined;
      });
    } catch {
      /* ignore */
    }
    await ctx.reply(
      [
        "⚠️ *خطا در رد فاکتور*",
        "",
        "وضعیت فاکتور را بررسی کنید و دوباره تلاش کنید.",
      ].join("\n"),
      { parse_mode: "Markdown" },
    );
  }
}

export async function adminReplyTicketConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  try {
    let ticketId = 0;
    
    if (ctx.callbackQuery?.data?.startsWith("adm:tkt:reply:")) {
      ticketId = Number(ctx.callbackQuery.data.split(":")[3]);
    } else if (ctx.session?.adminTargetId) {
      ticketId = Number(ctx.session.adminTargetId);
    }

    if (!ticketId || isNaN(ticketId)) {
      await ctx.reply("⚠️ خطای سیستمی: شماره تیکت یافت نشد.");
      return;
    }

    // BULLETPROOF FIX: Return ONLY the primitive string value, never the raw Prisma object.
    const userTelegramId = await conversation.external(async () => {
      const { prisma } = await import("../../lib/prisma.js");
      const t = await prisma.ticket.findUnique({
        where: { id: ticketId },
        include: { user: true }
      });
      return t ? String(t.user.telegramId) : null;
    });

    if (!userTelegramId) {
      await ctx.reply("تیکت یافت نشد.");
      return;
    }

    const promptText = `💬 پاسخ به تیکت\n\n🎫 شماره تیکت: ${ticketId}\n\nمتن پاسخ خود را بنویسید:`;
    const text = await waitText(conversation, ctx, promptText);
    
    if (!text) {
      if (ctx.session) {
        ctx.session.adminTargetId = undefined;
        ctx.session.adminTargetType = undefined;
      }
      await ctx.reply("پاسخ لغو شد.");
      return;
    }

    const adminTelegramId = BigInt(ctx.from!.id);
    
    await conversation.external(async () => {
      const { prisma } = await import("../../lib/prisma.js");
      await prisma.ticketMessage.create({
        data: {
          ticketId: ticketId,
          sender: "ADMIN",
          adminTelegramId: adminTelegramId,
          text: text.trim(),
        },
      });
      await prisma.ticket.update({
        where: { id: ticketId },
        data: { updatedAt: new Date(), status: "ANSWERED" },
      });
    });

    if (ctx.session) {
      ctx.session.adminTargetId = undefined;
      ctx.session.adminTargetType = undefined;
    }

    await conversation.external(async () => {
      try {
        await ctx.api.sendMessage(
          userTelegramId,
          `🎧 پاسخ پشتیبانی\n\n🎫 تیکت: #${ticketId}\n\n${text.trim()}`,
          {
            reply_markup: new InlineKeyboard().text("پاسخ به پشتیبانی 💬", `user:tkt:reply:${ticketId}`)
          }
        );
      } catch (err) {
        console.error("Failed to deliver ticket reply:", err);
      }
    });

    await ctx.reply("✅ پاسخ شما با موفقیت برای کاربر ارسال شد.");

  } catch (error) {
    console.error("Conversation Error:", error);
    await ctx.reply("⚠️ خطا در ارسال پاسخ تیکت. لطفا دوباره تلاش کنید.");
  }
}

export async function setLogGroupConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  try {
    const text = await waitText(
      conversation,
      ctx,
      [
        "🤖 *تنظیم گروه گزارشات*",
        "",
        "لطفا ابتدا ربات را در گروه مورد نظر خود عضو کنید و دسترسی ادمین (ایجاد تاپیک و ارسال پیام) را به آن بدهید.",
        "",
        "سپس **آیدی عددی گروه** (که معمولا با `-100` شروع می شود) را همینجا بفرستید.",
        "",
        "(برای انصراف /cancel را بفرستید)",
      ].join("\n"),
    );

    if (!text) {
      await ctx.reply(
        ["❌ *عملیات لغو شد*", "", "از پنل مدیریت دوباره شروع کنید."].join("\n"),
        { parse_mode: "Markdown", reply_markup: await adminHomeKeyboardAsync() },
      );
      return;
    }

    const groupId = parseLogGroupId(text);
    if (!groupId) {
      await ctx.reply(
        [
          "⚠️ *آیدی نامعتبر*",
          "",
          "لطفا **آیدی عددی گروه** را بفرستید (مثلا `-1001234567890`).",
        ].join("\n"),
        { parse_mode: "Markdown", reply_markup: await adminHomeKeyboardAsync() },
      );
      return;
    }

    await settingsService.setSetting(LOG_GROUP_ID_KEY, groupId);

    await ctx.reply("✅ گروه لاگ با موفقیت تنظیم شد.", {
      reply_markup: await adminHomeKeyboardAsync(),
    });
  } catch (err) {
    console.error("setLogGroupConversation error:", err);
    await ctx.reply(
      ["⚠️ *خطا در تنظیم گروه لاگ*", "", "لطفا دوباره تلاش کنید."].join("\n"),
      { parse_mode: "Markdown", reply_markup: await adminHomeKeyboardAsync() },
    );
  }
}

export async function setAutoBackupConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  try {
    const text = await waitText(
      conversation,
      ctx,
      [
        "⏱ *تنظیم بکاپ خودکار*",
        "",
        "لطفاً مشخص کنید ربات هر چند ساعت یک بار فایل بکاپ را ارسال کند؟ (مثلاً `24` برای روزانه، `12` برای دوبار در روز. برای غیرفعال سازی عدد `0` را بفرستید):",
      ].join("\n"),
    );

    if (!text) {
      await ctx.reply(
        ["❌ *عملیات لغو شد*", "", "از منوی بکاپ دوباره شروع کنید."].join("\n"),
        { parse_mode: "Markdown", reply_markup: adminBackupMenuKeyboard() },
      );
      return;
    }

    const hours = Number(text.trim());
    if (!Number.isFinite(hours) || hours < 0 || !Number.isInteger(hours)) {
      await ctx.reply(
        ["⚠️ *عدد نامعتبر*", "", "لطفاً یک عدد صحیح معتبر بفرستید."].join("\n"),
        { parse_mode: "Markdown", reply_markup: adminBackupMenuKeyboard() },
      );
      return;
    }

    await settingsService.setSetting(AUTO_BACKUP_HOURS_KEY, String(hours));

    await ctx.reply(
      hours === 0
        ? "✅ بکاپ خودکار با موفقیت غیرفعال شد."
        : `✅ بکاپ خودکار با موفقیت روی *هر ${hours} ساعت* تنظیم شد.`,
      {
        parse_mode: "Markdown",
        reply_markup: adminBackupMenuKeyboard(),
      },
    );
  } catch (err) {
    console.error("setAutoBackupConversation error:", err);
    await ctx.reply(
      ["⚠️ *خطا در تنظیم بکاپ خودکار*", "", "لطفا دوباره تلاش کنید."].join("\n"),
      { parse_mode: "Markdown", reply_markup: adminBackupMenuKeyboard() },
    );
  }
}

/** Fluid return target: List & Settings panel (methods + Swap toggle/config). */
async function paymentListKeyboardMarkup() {
  const [methods, swapEnabled] = await Promise.all([
    paymentMethodService.listAll(),
    settingsService.getBoolSetting(SWAPPAY_ENABLED, true),
  ]);
  return adminPaymentListKeyboard(methods, swapEnabled);
}

const paymentListPanelText = [
  "📋 *روش های پرداخت*",
  "",
  "• روی نام بزنید تا فعال / غیرفعال شود",
  "• روی تنظیمات برای ویرایش کارت، توکن یا سواپ ولت",
].join("\n");

/** Fluid UI: set Swap Wallet API key in SystemSetting (deletes admin's text). */
export async function setSwapApiKeyConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  try {
    let panel = panelFromCtx(ctx);
    const listKb = await paymentListKeyboardMarkup();
    const prompt = [
      "🔑 *تنظیم API Key سواپ ولت*",
      "",
      "کلید API شخصی Swap Wallet را بفرستید.",
      "",
      "این کلید فقط روی سرور ذخیره می‌شود و بلافاصله پیام شما حذف می‌گردد.",
      "",
      "(برای انصراف /cancel را بفرستید)",
    ].join("\n");

    if (!panel) {
      panel = await ensurePanel(ctx, prompt, listKb, null);
    }

    const waited = await waitTextOnPanel(conversation, ctx, prompt, panel);
    panel = waited.panel;

    if (!waited.text) {
      await ensurePanel(
        ctx,
        ["❌ *عملیات لغو شد*", "", paymentListPanelText].join("\n\n"),
        await paymentListKeyboardMarkup(),
        panel,
      );
      return;
    }

    const apiKey = waited.text.trim();
    if (apiKey.length < 8) {
      await ensurePanel(
        ctx,
        [
          "⚠️ *کلید نامعتبر*",
          "",
          "لطفاً یک API Key معتبر بفرستید.",
          "",
          paymentListPanelText,
        ].join("\n"),
        await paymentListKeyboardMarkup(),
        panel,
      );
      return;
    }

    await settingsService.setSetting(SWAPPAY_API_KEY, apiKey);

    await ensurePanel(
      ctx,
      ["✅ API Key سواپ ولت با موفقیت ذخیره شد.", "", paymentListPanelText].join(
        "\n",
      ),
      await paymentListKeyboardMarkup(),
      panel,
    );
  } catch (err) {
    console.error("setSwapApiKeyConversation error:", err);
    await ctx.reply(
      ["⚠️ *خطا در ذخیره API Key*", "", "لطفا دوباره تلاش کنید."].join("\n"),
      {
        parse_mode: "Markdown",
        reply_markup: await paymentListKeyboardMarkup(),
      },
    );
  }
}

/** Fluid UI: set Swap Wallet receive address in SystemSetting (deletes admin's text). */
export async function setSwapWalletAddressConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  try {
    let panel = panelFromCtx(ctx);
    const listKb = await paymentListKeyboardMarkup();
    const prompt = [
      "💼 *تنظیم آدرس ولت سواپ*",
      "",
      "آدرس کیف پول مقصد USDT را بفرستید (مثلاً BEP20 / TRC20).",
      "",
      "این آدرس فقط روی سرور ذخیره می‌شود و بلافاصله پیام شما حذف می‌گردد.",
      "",
      "(برای انصراف /cancel را بفرستید)",
    ].join("\n");

    if (!panel) {
      panel = await ensurePanel(ctx, prompt, listKb, null);
    }

    const waited = await waitTextOnPanel(conversation, ctx, prompt, panel);
    panel = waited.panel;

    if (!waited.text) {
      await ensurePanel(
        ctx,
        ["❌ *عملیات لغو شد*", "", paymentListPanelText].join("\n\n"),
        await paymentListKeyboardMarkup(),
        panel,
      );
      return;
    }

    const address = waited.text.trim();
    if (address.length < 20 || address.length > 128 || /\s/.test(address)) {
      await ensurePanel(
        ctx,
        [
          "⚠️ *آدرس نامعتبر*",
          "",
          "لطفاً یک آدرس ولت معتبر بفرستید (بدون فاصله).",
          "",
          paymentListPanelText,
        ].join("\n"),
        await paymentListKeyboardMarkup(),
        panel,
      );
      return;
    }

    await settingsService.setSetting(SWAPPAY_WALLET_ADDRESS, address);

    const preview =
      address.length > 12
        ? `\`${address.slice(0, 6)}…${address.slice(-4)}\``
        : `\`${address}\``;

    await ensurePanel(
      ctx,
      [
        `✅ آدرس ولت سواپ با موفقیت ذخیره شد.`,
        "",
        `💼 ${preview}`,
        "",
        paymentListPanelText,
      ].join("\n"),
      await paymentListKeyboardMarkup(),
      panel,
    );
  } catch (err) {
    console.error("setSwapWalletAddressConversation error:", err);
    await ctx.reply(
      ["⚠️ *خطا در ذخیره آدرس ولت*", "", "لطفا دوباره تلاش کنید."].join("\n"),
      {
        parse_mode: "Markdown",
        reply_markup: await paymentListKeyboardMarkup(),
      },
    );
  }
}

export async function fjSetChannelId(conversation: EshtrakinoConversation, ctx: SessionContext): Promise<void> {
  const initPanel = panelFromCtx(ctx);
  if (!initPanel) return;
  const { text, panel } = await waitTextOnPanel(
    conversation,
    ctx,
    "📢 *تنظیم شناسه کانال*\n\nآیدی کانال را وارد کنید (مثال: @MyChannel یا -10012345678):",
    initPanel,
  );
  if (!text) return;
  await conversation.external(() => settingsService.setSetting(FORCE_JOIN_CHANNEL_ID, text.trim()));
  const enabled = await conversation.external(() => settingsService.getBoolSetting(FORCE_JOIN_ENABLED, false));
  const channelId = await conversation.external(() => settingsService.getSetting(FORCE_JOIN_CHANNEL_ID));
  const inviteLink = await conversation.external(() => settingsService.getSetting(FORCE_JOIN_INVITE_LINK));
  await ensurePanel(ctx, "✅ شناسه کانال ثبت شد.", adminForceJoinKeyboard({ enabled, channelId, inviteLink }), panel);
}

export async function fjSetLink(conversation: EshtrakinoConversation, ctx: SessionContext): Promise<void> {
  const initPanel = panelFromCtx(ctx);
  if (!initPanel) return;
  const { text, panel } = await waitTextOnPanel(
    conversation,
    ctx,
    "📢 *تنظیم لینک دعوت*\n\nلینک عضویت در کانال را بفرستید (https://t.me/...):",
    initPanel,
  );
  if (!text) return;
  await conversation.external(() => settingsService.setSetting(FORCE_JOIN_INVITE_LINK, text.trim()));
  const enabled = await conversation.external(() => settingsService.getBoolSetting(FORCE_JOIN_ENABLED, false));
  const channelId = await conversation.external(() => settingsService.getSetting(FORCE_JOIN_CHANNEL_ID));
  const inviteLink = await conversation.external(() => settingsService.getSetting(FORCE_JOIN_INVITE_LINK));
  await ensurePanel(ctx, "✅ لینک دعوت ثبت شد.", adminForceJoinKeyboard({ enabled, channelId, inviteLink }), panel);
}

export async function fjSetText(conversation: EshtrakinoConversation, ctx: SessionContext): Promise<void> {
  const initPanel = panelFromCtx(ctx);
  if (!initPanel) return;
  const { text, panel } = await waitTextOnPanel(
    conversation,
    ctx,
    "📢 *تنظیم متن پیام جوین اجباری*\n\nمتنی که به کاربرانی که عضو نیستند نمایش داده می‌شود را بفرستید (از Markdown پشتیبانی می‌کند):",
    initPanel,
  );
  if (!text) return;
  await conversation.external(() => settingsService.setSetting(FORCE_JOIN_TEXT, text));
  const enabled = await conversation.external(() => settingsService.getBoolSetting(FORCE_JOIN_ENABLED, false));
  const channelId = await conversation.external(() => settingsService.getSetting(FORCE_JOIN_CHANNEL_ID));
  const inviteLink = await conversation.external(() => settingsService.getSetting(FORCE_JOIN_INVITE_LINK));
  await ensurePanel(ctx, "✅ متن پیام ثبت شد.", adminForceJoinKeyboard({ enabled, channelId, inviteLink }), panel);
}

export async function addDiscountConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  let panel = panelFromCtx(ctx);
  if (!panel) return;

  try {
    // Step A: Product Scope Choice
    const scopePrompt = [
      "🏷 *ثبت کد تخفیف جدید*",
      "",
      "محدوده محصولات مشمول این کد تخفیف را مشخص کنید:",
    ].join("\n");

    panel = await ensurePanel(ctx, scopePrompt, convDiscountScopeKeyboard(), panel);

    let appliesToAll = true;
    let targetProductIds: number[] = [];

    while (true) {
      const update = await conversation.waitFor(["callback_query:data", "message:text"]);
      const rawText = (update.message?.text ?? "").trim();
      if (rawText === "/start" || rawText.startsWith("/start ")) {
        return;
      }
      if (rawText === "/cancel") {
        await ensurePanel(
          update,
          "❌ ثبت کد تخفیف لغو شد.",
          await adminHomeKeyboardAsync(),
          panel,
        );
        return;
      }
      const cb = update.callbackQuery?.data;

      if (cb === ConvCb.cancel) {
        try {
          await update.answerCallbackQuery({ text: "لغو شد" });
        } catch {}
        await ensurePanel(
          update,
          "❌ ثبت کد تخفیف لغو شد.",
          await adminHomeKeyboardAsync(),
          panel,
        );
        return;
      }

      if (cb === ConvCb.discountScopeAll) {
        try {
          await update.answerCallbackQuery();
        } catch {}
        appliesToAll = true;
        break;
      }

      if (cb === ConvCb.discountScopeSpecific) {
        try {
          await update.answerCallbackQuery();
        } catch {}
        appliesToAll = false;
        break;
      }
    }

    // Step B: 3-Tier Hierarchical Multi-Select if specific products chosen
    if (!appliesToAll) {
      const selectedIds = new Set<number>();
      let confirmed = false;

      type DiscountSelectorTier = "categories" | "subcategories" | "products";
      let currentTier: DiscountSelectorTier = "categories";
      let currentCatId: number | null = null;
      let currentCatName: string = "";
      let currentSubCatId: number | null = null;
      let currentSubCatName: string = "";

      while (!confirmed) {
        if (currentTier === "categories") {
          const categories = await conversation.external(async () => {
            const rows = await catalogService.listCategories(true);
            return toPlain(rows);
          });

          if (!categories || categories.length === 0) {
            await ensurePanel(
              ctx,
              "⚠️ هیچ دسته‌بندی فعالی در سیستم تعریف نشده است.",
              await adminHomeKeyboardAsync(),
              panel,
            );
            return;
          }

          const selectPrompt = [
            "🎯 *انتخاب محصولات مشمول تخفیف*",
            "",
            "📁 دسته‌بندی مورد نظر را انتخاب کنید:",
            `▫️ تعداد کل محصولات انتخاب شده: *${selectedIds.size}*`,
          ].join("\n");

          panel = await ensurePanel(
            ctx,
            selectPrompt,
            convDiscountTier1CategoriesKeyboard(categories, selectedIds.size),
            panel,
          );
        } else if (currentTier === "subcategories" && currentCatId != null) {
          const catId = currentCatId;
          const data = await conversation.external(async () => {
            const [subCats, prods] = await Promise.all([
              catalogService.listSubCategoriesByCategory(catId, true),
              catalogService.listActiveProductsByCategory(catId),
            ]);
            return {
              subCategories: toPlain(subCats),
              standaloneProducts: toPlain(prods.filter((p: any) => p.subCategoryId == null)),
            };
          });

          const { subCategories, standaloneProducts } = data;

          const selectPrompt = [
            "🎯 *انتخاب محصولات مشمول تخفیف*",
            "",
            `📁 دسته‌بندی: *${currentCatName}*`,
            "",
            "سرویس مورد نظر را انتخاب کنید یا محصولات تکی را علامت بزنید:",
            `▫️ تعداد کل محصولات انتخاب شده: *${selectedIds.size}*`,
          ].join("\n");

          panel = await ensurePanel(
            ctx,
            selectPrompt,
            convDiscountTier2CategoryContentsKeyboard(
              subCategories,
              standaloneProducts,
              selectedIds,
              selectedIds.size,
            ),
            panel,
          );
        } else if (currentTier === "products" && currentSubCatId != null) {
          const subId = currentSubCatId;
          const plans = await conversation.external(async () => {
            const rows = await catalogService.listActiveProductsBySubCategory(subId);
            return toPlain(rows);
          });

          const selectPrompt = [
            "🎯 *انتخاب محصولات مشمول تخفیف*",
            "",
            `📁 دسته‌بندی: *${currentCatName}*`,
            `📑 سرویس: *${currentSubCatName}*`,
            "",
            "پلن‌های مورد نظر را با کلیک روی آنها انتخاب یا لغو کنید:",
            `▫️ تعداد کل محصولات انتخاب شده: *${selectedIds.size}*`,
          ].join("\n");

          panel = await ensurePanel(
            ctx,
            selectPrompt,
            convDiscountTier3PlansKeyboard(plans, selectedIds, selectedIds.size),
            panel,
          );
        }

        const update = await conversation.waitFor(["callback_query:data", "message:text"]);
        const rawText = (update.message?.text ?? "").trim();
        if (rawText === "/start" || rawText.startsWith("/start ")) {
          return;
        }
        if (rawText === "/cancel") {
          await ensurePanel(
            update,
            "❌ ثبت کد تخفیف لغو شد.",
            await adminHomeKeyboardAsync(),
            panel,
          );
          return;
        }
        const cb = update.callbackQuery?.data;

        if (cb === "dsc:cancel" || cb === ConvCb.cancel) {
          try {
            await update.answerCallbackQuery({ text: "لغو شد" });
          } catch {}
          await ensurePanel(
            update,
            "❌ ثبت کد تخفیف لغو شد.",
            await adminHomeKeyboardAsync(),
            panel,
          );
          return;
        }

        if (cb === "dsc:done" || cb === ConvCb.discountConfirmProducts) {
          if (selectedIds.size === 0) {
            try {
              await update.answerCallbackQuery({
                text: "⚠️ لطفاً حداقل یک محصول را انتخاب کنید.",
                show_alert: true,
              });
            } catch {}
            continue;
          }
          try {
            await update.answerCallbackQuery({ text: "محصولات تایید شدند ✅" });
          } catch {}
          targetProductIds = Array.from(selectedIds);
          confirmed = true;
          break;
        }

        if (cb === "dsc:back_cats") {
          try {
            await update.answerCallbackQuery();
          } catch {}
          currentTier = "categories";
          currentCatId = null;
          currentCatName = "";
          currentSubCatId = null;
          currentSubCatName = "";
          continue;
        }

        if (cb === "dsc:back_subcats") {
          try {
            await update.answerCallbackQuery();
          } catch {}
          currentTier = "subcategories";
          currentSubCatId = null;
          currentSubCatName = "";
          continue;
        }

        if (cb?.startsWith("dsc:cat:")) {
          const catId = Number(cb.split(":")[2]);
          if (!isNaN(catId)) {
            const cat = await conversation.external(async () => {
              const c = await catalogService.getCategory(catId);
              return c ? toPlain(c) : null;
            });
            currentTier = "subcategories";
            currentCatId = catId;
            currentCatName = cat?.name ?? "دسته‌بندی";
            currentSubCatId = null;
            currentSubCatName = "";
          }
          try {
            await update.answerCallbackQuery();
          } catch {}
          continue;
        }

        if (cb?.startsWith("dsc:subcat:")) {
          const subCatId = Number(cb.split(":")[2]);
          if (!isNaN(subCatId)) {
            const sub = await conversation.external(async () => {
              const s = await catalogService.getSubCategoryById(subCatId);
              return s ? toPlain(s) : null;
            });
            currentTier = "products";
            currentSubCatId = subCatId;
            currentSubCatName = sub?.name ?? "سرویس";
            if (sub?.categoryId) {
              currentCatId = sub.categoryId;
            }
          }
          try {
            await update.answerCallbackQuery();
          } catch {}
          continue;
        }

        if (cb?.startsWith("dsc:tog:") || cb?.startsWith("conv:dsc:tog:")) {
          const pid = Number(cb.replace("conv:dsc:tog:", "").replace("dsc:tog:", ""));
          if (!isNaN(pid)) {
            if (selectedIds.has(pid)) {
              selectedIds.delete(pid);
            } else {
              selectedIds.add(pid);
            }
          }
          try {
            await update.answerCallbackQuery();
          } catch {}
          continue;
        }
      }
    }

    // Step C: Discount Code Text
    let codeStr = "";
    while (true) {
      const { text, panel: p } = await waitTextOnPanel(
        conversation,
        ctx,
        [
          "🏷 *عنوان کد تخفیف*",
          "",
          "کد تخفیف را به انگلیسی ارسال کنید (مثال: `OFF20` یا `NOROOZ`):",
        ].join("\n"),
        panel,
      );
      panel = p;
      if (!text) return;

      const normalized = text.trim().toUpperCase();
      if (normalized.length < 2 || normalized.length > 32) {
        continue;
      }

      const exists = await conversation.external(async () => {
        const found = await discountService.getByCode(normalized);
        return Boolean(found);
      });

      if (exists) {
        const pErr = await ensurePanel(
          ctx,
          `⚠️ کد تخفیف \`${normalized}\` قبلاً ثبت شده است. لطفاً کد دیگری بفرستید:`,
          { inline_keyboard: [[{ text: "❌ لغو", callback_data: ConvCb.cancel }]] },
          panel,
        );
        panel = pErr;
        continue;
      }

      codeStr = normalized;
      break;
    }

    // Step D: Percentage
    let percentage = 0;
    while (true) {
      const { text, panel: p } = await waitTextOnPanel(
        conversation,
        ctx,
        [
          "🔢 *درصد تخفیف*",
          "",
          `کد تخفیف: \`${codeStr}\``,
          "درصد تخفیف را به صورت عددی بین ۱ تا ۱۰۰ وارد کنید (مثال: `20`):",
        ].join("\n"),
        panel,
      );
      panel = p;
      if (!text) return;

      const num = parseInt(text.trim(), 10);
      if (isNaN(num) || num < 1 || num > 100) {
        continue;
      }
      percentage = num;
      break;
    }

    // Step E: Usage Limit Count
    let maxUses: number | null = null;
    while (true) {
      const { text, panel: p } = await waitTextOnPanel(
        conversation,
        ctx,
        [
          "👥 *سقف تعداد استفاده*",
          "",
          "حداکثر دفعات قابل استفاده از این کد را وارد کنید (مثال: `10`).",
          "_برای نامحدود بودن عدد 0 را ارسال کنید:_",
        ].join("\n"),
        panel,
      );
      panel = p;
      if (!text) return;

      const num = parseInt(text.trim(), 10);
      if (isNaN(num) || num < 0) {
        continue;
      }
      maxUses = num === 0 ? null : num;
      break;
    }

    // Save record
    const created = await conversation.external(async () => {
      const record = await discountService.createDiscountCode({
        code: codeStr,
        percentage,
        maxUses,
        appliesToAll,
        productIds: targetProductIds,
      });
      return toPlain(record);
    });

    const scopeLabel = created.appliesToAll
      ? "🌐 همه محصولات فروشگاه"
      : `🎯 ${created.productIds.length} محصول اختصاصی`;
    const usesLabel = created.maxUses != null ? `${created.maxUses} بار` : "نامحدود ♾";

    const summaryText = [
      "✅ *کد تخفیف با موفقیت ایجاد شد!*",
      "",
      `🏷 کد تخفیف: \`${created.code}\``,
      `📊 درصد تخفیف: *${created.percentage}٪*`,
      `📦 محدوده اعمال: *${scopeLabel}*`,
      `👥 سقف استفاده: *${usesLabel}*`,
      `🔘 وضعیت: *فعال*`,
    ].join("\n");

    await ensurePanel(ctx, summaryText, adminDiscountHubKeyboard(), panel);
  } catch (err) {
    console.error("addDiscountConversation error:", err);
    await ensurePanel(
      ctx,
      "❌ خطا در ایجاد کد تخفیف.",
      adminDiscountHubKeyboard(),
      panel,
    );
  }
}

export function formatDiscountHubText(
  codes: Array<{ code: string; percentage: number; usedCount: number; maxUses: number | null }>,
): string {
  const lines = [
    "🏷 *مدیریت کدهای تخفیف*",
    "",
  ];
  if (!codes || codes.length === 0) {
    lines.push("در حال حاضر هیچ کد تخفیفی ثبت نشده است.");
  } else {
    for (const c of codes) {
      const maxStr = c.maxUses != null ? c.maxUses : "نامحدود";
      lines.push(`▫️ \`${c.code}\` | تخفیف: *${c.percentage}%* | استفاده: *${c.usedCount}/${maxStr}*`);
    }
  }
  return lines.join("\n");
}

export async function deleteDiscountCodesConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  let panel = panelFromCtx(ctx);
  if (!panel) return;

  try {
    const initialCodes = await conversation.external(async () => {
      const rows = await discountService.listAllDiscountCodes();
      return toPlain(rows);
    });

    if (!initialCodes || initialCodes.length === 0) {
      try {
        await ctx.answerCallbackQuery({
          text: "⚠️ هیچ کد تخفیفی برای حذف وجود ندارد.",
          show_alert: true,
        });
      } catch {}
      await ensurePanel(
        ctx,
        formatDiscountHubText([]),
        adminDiscountHubKeyboard(),
        panel,
      );
      return;
    }

    const selectedIds = new Set<number>();

    while (true) {
      const prompt = [
        "🗑 *حذف کدهای تخفیف*",
        "",
        "کدهای تخفیف مورد نظر برای حذف را انتخاب کنید:",
        `▫️ تعداد انتخاب شده: *${selectedIds.size}*`,
      ].join("\n");

      panel = await ensurePanel(
        ctx,
        prompt,
        convDiscountBatchDeleteKeyboard(initialCodes, selectedIds),
        panel,
      );

      const update = await conversation.waitFor(["callback_query:data", "message:text"]);
      const rawText = (update.message?.text ?? "").trim();
      if (rawText === "/start" || rawText.startsWith("/start ")) {
        return;
      }
      if (rawText === "/cancel") {
        const latestCodes = await conversation.external(async () => {
          const rows = await discountService.listAllDiscountCodes();
          return toPlain(rows);
        });
        await ensurePanel(
          update,
          formatDiscountHubText(latestCodes),
          adminDiscountHubKeyboard(),
          panel,
        );
        return;
      }
      const cb = update.callbackQuery?.data;

      if (cb === "dsc_del:cancel") {
        try {
          await update.answerCallbackQuery({ text: "عملیات لغو شد" });
        } catch {}
        const latestCodes = await conversation.external(async () => {
          const rows = await discountService.listAllDiscountCodes();
          return toPlain(rows);
        });
        await ensurePanel(
          update,
          formatDiscountHubText(latestCodes),
          adminDiscountHubKeyboard(),
          panel,
        );
        return;
      }

      if (cb === "dsc_del:confirm") {
        if (selectedIds.size === 0) {
          try {
            await update.answerCallbackQuery({
              text: "⚠️ لطفاً حداقل یک کد را برای حذف انتخاب کنید.",
              show_alert: true,
            });
          } catch {}
          continue;
        }

        const idsToDelete = Array.from(selectedIds);
        const deletedCount = await conversation.external(async () => {
          return await discountService.deleteDiscountCodes(idsToDelete);
        });

        try {
          await update.answerCallbackQuery({
            text: `✅ تعداد ${deletedCount} کد تخفیف حذف شدند.`,
          });
        } catch {}

        const remainingCodes = await conversation.external(async () => {
          const rows = await discountService.listAllDiscountCodes();
          return toPlain(rows);
        });

        const successText = [
          `✅ تعداد *${deletedCount}* کد تخفیف با موفقیت حذف شدند.`,
          "",
          formatDiscountHubText(remainingCodes),
        ].join("\n");

        await ensurePanel(
          update,
          successText,
          adminDiscountHubKeyboard(),
          panel,
        );
        return;
      }

      if (cb?.startsWith("dsc_del:tog:")) {
        const id = Number(cb.split(":")[2]);
        if (!isNaN(id)) {
          if (selectedIds.has(id)) {
            selectedIds.delete(id);
          } else {
            selectedIds.add(id);
          }
        }
        try {
          await update.answerCallbackQuery();
        } catch {}
        continue;
      }
    }
  } catch (err) {
    console.error("deleteDiscountCodesConversation error:", err);
    await ensurePanel(
      ctx,
      "❌ خطا در حذف کدهای تخفیف.",
      adminDiscountHubKeyboard(),
      panel,
    );
  }
}

export async function editCategoryCmsConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  try {
    const categoryId = await conversation.external((c) => c.session.adminCmsCategoryId ?? null);
    const action = await conversation.external((c) => c.session.adminCmsAction ?? "all");

    if (!categoryId) {
      await presentCmsCategoryList(ctx, panelFromCtx(ctx), "⚠️ دسته هدف مشخص نیست.");
      return;
    }

    let panel = panelFromCtx(ctx);
    const category = await conversation.external(async () => {
      const row = await catalogService.getCategory(categoryId, false);
      return row ? toPlain(row) : null;
    });

    if (!category || !category.isActive) {
      await conversation.external((c) => {
        c.session.adminCmsCategoryId = undefined;
        c.session.adminCmsAction = undefined;
      });
      await presentCmsCategoryList(ctx, panel, "⚠️ دسته یافت نشد.");
      return;
    }

    if (action === "desc") {
      const prompt = [
        "📝 *تنظیم متن توضیحات دسته*",
        "",
        `دسته: *${category.name}*`,
        `توضیحات فعلی: *${(category as any).description || "تنظیم نشده"}*`,
        "",
        "متن جدید توضیحات را بفرستید:",
        "(برای حذف توضیحات علامت - بفرستید یا دکمه زیر را بزنید)",
        "",
        "(برای انصراف /cancel را بفرستید)",
      ].join("\n");

      const kb = new InlineKeyboard()
        .text("🗑 حذف توضیحات", "conv:cat:del_desc")
        .row()
        .text("❌ لغو", ConvCb.cancel);

      panel = await ensurePanel(ctx, prompt, kb, panel);

      while (true) {
        const update = await conversation.waitFor([
          "message:text",
          "callback_query:data",
        ]);

        const rawText = (update.message?.text ?? "").trim();
        if (rawText === "/start" || rawText.startsWith("/start ")) {
          await conversation.external((c) => {
            c.session.adminCmsCategoryId = undefined;
            c.session.adminCmsAction = undefined;
          });
          return;
        }
        if (update.callbackQuery?.data === ConvCb.cancel || rawText === "/cancel") {
          if (update.callbackQuery) {
            try {
              await update.answerCallbackQuery({ text: "لغو شد" });
            } catch {}
          }
          await conversation.external((c) => {
            c.session.adminCmsCategoryId = undefined;
            c.session.adminCmsAction = undefined;
          });
          await presentCmsCategoryView(update, categoryId, panel, "❌ ویرایش متن لغو شد.");
          return;
        }

        if (update.callbackQuery?.data === "conv:cat:del_desc" || (update.message?.text ?? "").trim() === "-") {
          if (update.callbackQuery) {
            try {
              await update.answerCallbackQuery({ text: "توضیحات حذف شد" });
            } catch {}
          }
          await conversation.external(async () => {
            await catalogService.updateCategoryDescription(categoryId, null);
          });
          await conversation.external((c) => {
            c.session.adminCmsCategoryId = undefined;
            c.session.adminCmsAction = undefined;
          });
          await presentCmsCategoryView(update, categoryId, panel, "🗑 توضیحات دسته حذف شد.");
          return;
        }

        const text = (update.message?.text ?? "").trim();
        if (text) {
          await conversation.external(async () => {
            await catalogService.updateCategoryDescription(categoryId, text);
          });
          await conversation.external((c) => {
            c.session.adminCmsCategoryId = undefined;
            c.session.adminCmsAction = undefined;
          });
          await presentCmsCategoryView(update, categoryId, panel, "✅ متن توضیحات دسته با موفقیت ذخیره شد.");
          return;
        }
      }
    } else {
      // Banner mode (or default)
      const prompt = [
        "🖼 *تنظیم بنر دسته*",
        "",
        `دسته: *${category.name}*`,
        "",
        "یک *عکس* برای بنر اختصاصی این دسته بفرستید.",
        "یا دکمه «🗑 حذف بنر» را برای بازگشت به بنر پیش‌فرض ربات انتخاب کنید.",
        "",
        "(برای انصراف /cancel را بفرستید)",
      ].join("\n");

      const kb = new InlineKeyboard()
        .text("🗑 حذف بنر (بازگشت به پیش‌فرض)", "conv:cat:del_banner")
        .row()
        .text("❌ لغو", ConvCb.cancel);

      panel = await ensurePanel(ctx, prompt, kb, panel);

      while (true) {
        const update = await conversation.waitFor([
          "message:photo",
          "message:document",
          "message:text",
          "callback_query:data",
        ]);

        const rawText = (update.message?.text ?? "").trim();
        if (rawText === "/start" || rawText.startsWith("/start ")) {
          await conversation.external((c) => {
            c.session.adminCmsCategoryId = undefined;
            c.session.adminCmsAction = undefined;
          });
          return;
        }
        if (update.callbackQuery?.data === ConvCb.cancel || rawText === "/cancel") {
          if (update.callbackQuery) {
            try {
              await update.answerCallbackQuery({ text: "لغو شد" });
            } catch {}
          }
          await conversation.external((c) => {
            c.session.adminCmsCategoryId = undefined;
            c.session.adminCmsAction = undefined;
          });
          await presentCmsCategoryView(update, categoryId, panel, "❌ تنظیم بنر لغو شد.");
          return;
        }

        if (
          update.callbackQuery?.data === "conv:cat:del_banner" ||
          (update.message?.text ?? "").trim() === "-" ||
          (update.message?.text ?? "").trim() === "بدون بنر"
        ) {
          if (update.callbackQuery) {
            try {
              await update.answerCallbackQuery({ text: "بنر حذف شد" });
            } catch {}
          }
          await conversation.external(async () => {
            await catalogService.updateCategoryBanner(categoryId, null);
          });
          await conversation.external((c) => {
            c.session.adminCmsCategoryId = undefined;
            c.session.adminCmsAction = undefined;
          });
          await presentCmsCategoryView(update, categoryId, panel, "🗑 بنر اختصاصی دسته حذف شد و به حالت پیش‌فرض بازگشت.");
          return;
        }

        let mediaFileId: string | null = null;
        const photos = update.message?.photo;
        if (photos && photos.length > 0) {
          mediaFileId = photos[photos.length - 1]!.file_id;
        } else if (update.message?.document?.mime_type?.startsWith("image/")) {
          mediaFileId = update.message.document.file_id;
        }

        if (mediaFileId) {
          await conversation.external(async () => {
            await catalogService.updateCategoryBanner(categoryId, mediaFileId!);
          });
          await conversation.external((c) => {
            c.session.adminCmsCategoryId = undefined;
            c.session.adminCmsAction = undefined;
          });
          await presentCmsCategoryView(update, categoryId, panel, "✅ بنر اختصاصی دسته با موفقیت ذخیره شد.");
          return;
        }

        if (update.callbackQuery) {
          try {
            await update.answerCallbackQuery({ text: "لطفاً عکس بفرستید" });
          } catch {}
          continue;
        }

        await update.reply("⚠️ لطفاً یک تصویر ارسال کنید یا از دکمه حذف بنر / لغو استفاده کنید.");
      }
    }
  } catch (err) {
    console.error("editCategoryCmsConversation error:", err);
    await conversation.external((c) => {
      c.session.adminCmsCategoryId = undefined;
      c.session.adminCmsAction = undefined;
    }).catch(() => {});
    await presentCmsCategoryList(ctx, panelFromCtx(ctx), "⚠️ خطا در ویرایش دسته.");
  }
}

export async function editSubCategoryCmsConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  try {
    const subCategoryId = await conversation.external((c) => c.session.adminCmsSubCategoryId ?? null);
    const action = await conversation.external((c) => c.session.adminCmsAction ?? "all");

    if (!subCategoryId) {
      await presentCmsSubCategoryList(ctx, panelFromCtx(ctx), "⚠️ زیردسته هدف مشخص نیست.");
      return;
    }

    let panel = panelFromCtx(ctx);
    const subCategory = await conversation.external(async () => {
      const row = await catalogService.getSubCategoryById(subCategoryId);
      return row ? toPlain(row) : null;
    });

    if (!subCategory || !subCategory.isActive) {
      await conversation.external((c) => {
        c.session.adminCmsSubCategoryId = undefined;
        c.session.adminCmsAction = undefined;
      });
      await presentCmsSubCategoryList(ctx, panel, "⚠️ زیردسته یافت نشد.");
      return;
    }

    if (action === "desc") {
      const prompt = [
        "📝 *تنظیم متن توضیحات زیردسته / سرویس*",
        "",
        `زیردسته: *${subCategory.name}*`,
        `توضیحات فعلی: *${subCategory.description || "تنظیم نشده"}*`,
        "",
        "متن جدید توضیحات را بفرستید:",
        "(برای حذف توضیحات علامت - بفرستید یا دکمه زیر را بزنید)",
        "",
        "(برای انصراف /cancel را بفرستید)",
      ].join("\n");

      const kb = new InlineKeyboard()
        .text("🗑 حذف توضیحات", "conv:subcat:del_desc")
        .row()
        .text("❌ لغو", ConvCb.cancel);

      panel = await ensurePanel(ctx, prompt, kb, panel);

      while (true) {
        const update = await conversation.waitFor([
          "message:text",
          "callback_query:data",
        ]);

        const rawText = (update.message?.text ?? "").trim();
        if (rawText === "/start" || rawText.startsWith("/start ")) {
          await conversation.external((c) => {
            c.session.adminCmsSubCategoryId = undefined;
            c.session.adminCmsAction = undefined;
          });
          return;
        }
        if (update.callbackQuery?.data === ConvCb.cancel || rawText === "/cancel") {
          if (update.callbackQuery) {
            try {
              await update.answerCallbackQuery({ text: "لغو شد" });
            } catch {}
          }
          await conversation.external((c) => {
            c.session.adminCmsSubCategoryId = undefined;
            c.session.adminCmsAction = undefined;
          });
          await presentCmsSubCategoryView(update, subCategoryId, panel, "❌ ویرایش متن لغو شد.");
          return;
        }

        if (update.callbackQuery?.data === "conv:subcat:del_desc" || (update.message?.text ?? "").trim() === "-") {
          if (update.callbackQuery) {
            try {
              await update.answerCallbackQuery({ text: "توضیحات حذف شد" });
            } catch {}
          }
          await conversation.external(async () => {
            await catalogService.updateSubCategoryDescription(subCategoryId, null);
          });
          await conversation.external((c) => {
            c.session.adminCmsSubCategoryId = undefined;
            c.session.adminCmsAction = undefined;
          });
          await presentCmsSubCategoryView(update, subCategoryId, panel, "🗑 توضیحات زیردسته حذف شد.");
          return;
        }

        const text = (update.message?.text ?? "").trim();
        if (text) {
          await conversation.external(async () => {
            await catalogService.updateSubCategoryDescription(subCategoryId, text);
          });
          await conversation.external((c) => {
            c.session.adminCmsSubCategoryId = undefined;
            c.session.adminCmsAction = undefined;
          });
          await presentCmsSubCategoryView(update, subCategoryId, panel, "✅ متن توضیحات زیردسته با موفقیت ذخیره شد.");
          return;
        }
      }
    } else {
      // Banner mode
      const prompt = [
        "🖼 *تنظیم بنر زیردسته / سرویس*",
        "",
        `زیردسته: *${subCategory.name}*`,
        "",
        "یک *عکس* برای بنر اختصاصی این زیردسته بفرستید.",
        "یا دکمه «🗑 حذف بنر» را برای ارث‌بری از بنر دسته والد یا پیش‌فرض انتخاب کنید.",
        "",
        "(برای انصراف /cancel را بفرستید)",
      ].join("\n");

      const kb = new InlineKeyboard()
        .text("🗑 حذف بنر (ارث‌بری از دسته والد)", "conv:subcat:del_banner")
        .row()
        .text("❌ لغو", ConvCb.cancel);

      panel = await ensurePanel(ctx, prompt, kb, panel);

      while (true) {
        const update = await conversation.waitFor([
          "message:photo",
          "message:document",
          "message:text",
          "callback_query:data",
        ]);

        const rawText = (update.message?.text ?? "").trim();
        if (rawText === "/start" || rawText.startsWith("/start ")) {
          await conversation.external((c) => {
            c.session.adminCmsSubCategoryId = undefined;
            c.session.adminCmsAction = undefined;
          });
          return;
        }
        if (update.callbackQuery?.data === ConvCb.cancel || rawText === "/cancel") {
          if (update.callbackQuery) {
            try {
              await update.answerCallbackQuery({ text: "لغو شد" });
            } catch {}
          }
          await conversation.external((c) => {
            c.session.adminCmsSubCategoryId = undefined;
            c.session.adminCmsAction = undefined;
          });
          await presentCmsSubCategoryView(update, subCategoryId, panel, "❌ تنظیم بنر لغو شد.");
          return;
        }

        if (
          update.callbackQuery?.data === "conv:subcat:del_banner" ||
          (update.message?.text ?? "").trim() === "-" ||
          (update.message?.text ?? "").trim() === "بدون بنر"
        ) {
          if (update.callbackQuery) {
            try {
              await update.answerCallbackQuery({ text: "بنر حذف شد" });
            } catch {}
          }
          await conversation.external(async () => {
            await catalogService.updateSubCategoryBanner(subCategoryId, null);
          });
          await conversation.external((c) => {
            c.session.adminCmsSubCategoryId = undefined;
            c.session.adminCmsAction = undefined;
          });
          await presentCmsSubCategoryView(update, subCategoryId, panel, "🗑 بنر اختصاصی زیردسته حذف شد.");
          return;
        }

        let mediaFileId: string | null = null;
        const photos = update.message?.photo;
        if (photos && photos.length > 0) {
          mediaFileId = photos[photos.length - 1]!.file_id;
        } else if (update.message?.document?.mime_type?.startsWith("image/")) {
          mediaFileId = update.message.document.file_id;
        }

        if (mediaFileId) {
          await conversation.external(async () => {
            await catalogService.updateSubCategoryBanner(subCategoryId, mediaFileId!);
          });
          await conversation.external((c) => {
            c.session.adminCmsSubCategoryId = undefined;
            c.session.adminCmsAction = undefined;
          });
          await presentCmsSubCategoryView(update, subCategoryId, panel, "✅ بنر اختصاصی زیردسته با موفقیت ذخیره شد.");
          return;
        }

        if (update.callbackQuery) {
          try {
            await update.answerCallbackQuery({ text: "لطفاً عکس بفرستید" });
          } catch {}
          continue;
        }

        await update.reply("⚠️ لطفاً یک تصویر ارسال کنید یا از دکمه حذف بنر / لغو استفاده کنید.");
      }
    }
  } catch (err) {
    console.error("editSubCategoryCmsConversation error:", err);
    await conversation.external((c) => {
      c.session.adminCmsSubCategoryId = undefined;
      c.session.adminCmsAction = undefined;
    }).catch(() => {});
    await presentCmsSubCategoryList(ctx, panelFromCtx(ctx), "⚠️ خطا در ویرایش زیردسته.");
  }
}


