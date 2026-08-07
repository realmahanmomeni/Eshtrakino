import type { DeliveryType, PaymentMethodType } from "@prisma/client";
import type { EshtrakinoConversation, SessionContext } from "../context";
import { catalogService } from "../../services/catalog/CatalogService";
import { paymentMethodService } from "../../services/paymentMethods/PaymentMethodService";
import { invoiceService } from "../../services/invoices/InvoiceService";
import { formatToman, parsePrice } from "../../lib/money";
import { toPlain } from "../../lib/plain";
import { waitCallback, waitOptionalPhoto, waitText, ensurePanel, panelFromCtx, waitTextOnPanel } from "../conversations/wait";
import {
  adminBackupMenuKeyboard,
  adminCatalogKeyboard,
  adminHomeKeyboard,
  adminPaymentListKeyboard,
  adminPaymentsKeyboard,
  convCategoryPickKeyboard,
  convDeliveryAddProductKeyboard,
  convPaymentTypeKeyboard,
} from "./keyboards";
import { env } from "../../config/env";
import { ticketService } from "../../services/tickets/TicketService";
import {
  settingsService,
  AUTO_BACKUP_HOURS_KEY,
  LOG_GROUP_ID_KEY,
  SWAPPAY_API_KEY,
  SWAPPAY_ENABLED,
  SWAPPAY_WALLET_ADDRESS,
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

/**
 * Add Product flow:
 * 1) Select Category
 * 2) Enter Product Name
 * 3) Enter Price
 * 4) Select Delivery Type (READY / MANUAL / CREDENTIALS_REQUIRED / USER_CHOICE)
 * 5) Ask for requiredFields (comma-separated or "no")
 */
export async function addProductConversation(
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
        "🗂 *افزودن محصول — مرحله ۱*",
        "",
        "دسته مورد نظر را انتخاب کنید:",
      ].join("\n"),
      convCategoryPickKeyboard(categories),
    );
    if (!catData) {
      await ctx.reply("عملیات لغو شد.", { reply_markup: adminCatalogKeyboard() });
      return;
    }
    const catMatch = /^conv:cat:(\d+)$/.exec(catData);
    if (!catMatch) {
      await ctx.reply("انتخاب نامعتبر بود.", { reply_markup: adminCatalogKeyboard() });
      return;
    }
    const categoryId = Number(catMatch[1]);
    const category = categories.find((c) => c.id === categoryId);
    if (!category) {
      await ctx.reply("دسته یافت نشد.", { reply_markup: adminCatalogKeyboard() });
      return;
    }

    const name = await waitText(
      conversation,
      ctx,
      [
        "📝 *مرحله ۲*",
        "",
        "نام محصول را بفرستید:",
      ].join("\n"),
    );
    if (!name) {
      await ctx.reply("عملیات لغو شد.", { reply_markup: adminCatalogKeyboard() });
      return;
    }

    let price: number | null = null;
    for (let attempt = 0; attempt < 5 && price === null; attempt++) {
      const priceRaw = await waitText(
        conversation,
        ctx,
        attempt === 0
          ? [
              "💵 *مرحله ۳*",
              "",
              "قیمت محصول را به *تومان* بفرستید",
              "(مثلاً `750000` یا `750,000`):",
            ].join("\n")
          : [
              "⚠️ *قیمت نامعتبر*",
              "",
              "دوباره عدد تومان را بفرستید:",
            ].join("\n"),
      );
      if (!priceRaw) {
        await ctx.reply("عملیات لغو شد.", { reply_markup: adminCatalogKeyboard() });
        return;
      }
      price = parsePrice(priceRaw);
    }
    if (price === null) {
      await ctx.reply("قیمت معتبر دریافت نشد.", { reply_markup: adminCatalogKeyboard() });
      return;
    }

    const delData = await waitCallback(
      conversation,
      ctx,
      [
        "🚚 *مرحله ۴*",
        "",
        "نوع تحویل را انتخاب کنید:",
      ].join("\n"),
      convDeliveryAddProductKeyboard(),
    );
    if (!delData) {
      await ctx.reply("عملیات لغو شد.", { reply_markup: adminCatalogKeyboard() });
      return;
    }
    const delMatch =
      /^conv:deladd:(READY|MANUAL|CREDENTIALS_REQUIRED|USER_CHOICE)$/.exec(delData);
    if (!delMatch) {
      await ctx.reply("نوع تحویل نامعتبر بود.", { reply_markup: adminCatalogKeyboard() });
      return;
    }
    const deliveryType = delMatch[1] as DeliveryType;

    const description = await waitText(
      conversation,
      ctx,
      [
        "🔖 *مرحله ۵ — توضیحات (کپشن)*",
        "",
        "توضیحات محصول را بفرستید:",
        "",
        "(این متن در صفحه جزئیات محصول نمایش داده می شود)",
      ].join("\n"),
    );
    if (!description) {
      await ctx.reply("عملیات لغو شد.", { reply_markup: adminCatalogKeyboard() });
      return;
    }

    const bannerRaw = await waitOptionalPhoto(
      conversation,
      ctx,
      [
        "🖼 *مرحله ۶ — بنر محصول (اختیاری)*",
        "",
        "تصویر بنر محصول را بفرستید، یا «بدون بنر» را بزنید:",
      ].join("\n"),
    );
    if (bannerRaw === null) {
      await ctx.reply("عملیات لغو شد.", { reply_markup: adminCatalogKeyboard() });
      return;
    }
    const bannerFileId = bannerRaw.length > 0 ? bannerRaw : null;

    const product = await conversation.external(async () =>
      toPlain(
        await catalogService.createProduct({
          name,
          price,
          categoryId,
          deliveryType,
          description,
          bannerFileId,
          requiredFields: [],
        }),
      ),
    );

    const bannerLine = bannerFileId ? "🖼 بنر: *ثبت شد*" : "🖼 بنر: *ندارد*";

    await ctx.reply(
      [
        "✅ *محصول ثبت شد*",
        "",
        `📦 نام: *${product.name}*`,
        `🗂 دسته: *${category.name}*`,
        `💵 قیمت: *${formatToman(price)}*`,
        `🚚 تحویل: *${deliveryType}*`,
        bannerLine,
      ].join("\n"),
      { parse_mode: "Markdown", reply_markup: adminCatalogKeyboard() },
    );
  } catch (err) {
    console.error("addProductConversation error:", err);
    await ctx.reply("⚠️ خطا در افزودن محصول. دوباره تلاش کنید.", {
      reply_markup: adminCatalogKeyboard(),
    });
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
    const ticketId = await conversation.external((c) => c.session.adminTargetId ?? null);
    if (!ticketId) {
      await ctx.reply("تیکتی انتخاب نشده.");
      return;
    }

    const ticket = await conversation.external(async () =>
      toPlain(await ticketService.getByIdWithUser(ticketId)),
    );
    if (!ticket) {
      await ctx.reply("تیکت یافت نشد.");
      return;
    }

    const text = await waitText(
      conversation,
      ctx,
      [
        "💬 *پاسخ به تیکت*",
        "",
        `🎫 تیکت: *#${ticketId}*`,
        "",
        "متن پاسخ را بنویسید:",
      ].join("\n"),
    );
    if (!text) {
      await conversation.external((c) => {
        c.session.adminTargetId = undefined;
        c.session.adminTargetType = undefined;
      });
      await ctx.reply("پاسخ لغو شد.");
      return;
    }

    const adminTelegramId = ctx.from!.id;
    await conversation.external(async () => {
      await ticketService.createAdminReply(ticketId, BigInt(adminTelegramId), text);
    });
    await conversation.external((c) => {
      c.session.adminTargetId = undefined;
      c.session.adminTargetType = undefined;
    });

    try {
      await ctx.api.sendMessage(
        String(ticket.user.telegramId),
        [
          "🎧 پاسخ پشتیبانی",
          "",
          `🎫 تیکت: #${ticketId}`,
          "",
          text,
        ].join("\n"),
      );
    } catch (err) {
      console.error("Failed to deliver ticket reply:", err);
    }

    for (const id of env.adminIds) {
      if (id === ctx.from!.id) continue;
      try {
        await ctx.api.sendMessage(
          id,
          [
            "✅ پاسخ ادمین ارسال شد",
            "",
            `🎫 تیکت: #${ticketId}`,
          ].join("\n"),
        );
      } catch {
        /* ignore */
      }
    }

    await ctx.reply(
      [
        "✅ *پاسخ ارسال شد*",
        "",
        `🎫 تیکت: *#${ticketId}*`,
        "",
        "پیام برای کاربر ارسال شد.",
      ].join("\n"),
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "🎫 بازگشت به تیکت", callback_data: `adm:tkt:v:${ticketId}` },
              { text: "🟢 تیکت های باز", callback_data: "adm:tkt:open" },
            ],
          ],
        },
      },
    );
  } catch (err) {
    console.error("adminReplyTicketConversation error:", err);
    await ctx.reply(
      ["⚠️ *خطا در ارسال پاسخ تیکت*", "", "لطفا دوباره تلاش کنید."].join("\n"),
      { parse_mode: "Markdown" },
    );
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
        { parse_mode: "Markdown", reply_markup: adminHomeKeyboard() },
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
        { parse_mode: "Markdown", reply_markup: adminHomeKeyboard() },
      );
      return;
    }

    await settingsService.setSetting(LOG_GROUP_ID_KEY, groupId);

    await ctx.reply("✅ گروه لاگ با موفقیت تنظیم شد.", {
      reply_markup: adminHomeKeyboard(),
    });
  } catch (err) {
    console.error("setLogGroupConversation error:", err);
    await ctx.reply(
      ["⚠️ *خطا در تنظیم گروه لاگ*", "", "لطفا دوباره تلاش کنید."].join("\n"),
      { parse_mode: "Markdown", reply_markup: adminHomeKeyboard() },
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
