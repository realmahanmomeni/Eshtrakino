import type { EshtrakinoConversation, SessionContext } from "../context";
import { catalogService } from "../../services/catalog/CatalogService";
import {
  invoiceService,
  renderInvoiceAmountLines,
  type InvoiceAmountLinesSource,
} from "../../services/invoices/InvoiceService";
import { paymentMethodService } from "../../services/paymentMethods/PaymentMethodService";
import { formatToman, parseUserInputData } from "../../lib/money";
import { toPlain } from "../../lib/plain";
import { ensurePanel, type PanelRef, waitPhoto, waitText } from "./wait";
import {
  mainMenuKeyboard,
  paymentMethodsKeyboard,
  adminInvoiceReviewKeyboard,
  adminTicketReplyKeyboard,
} from "../keyboards/builders";
import { buildCheckoutPaymentKeyboard } from "../keyboards/paymentChoice";
import { deliveryTypeLabel, emojiForLabel } from "../keyboards/grid";
import { env, isAdminTelegramId } from "../../config/env";
import { ticketService } from "../../services/tickets/TicketService";
import { discountService } from "../../services/discount/DiscountService";
import { ConvCb } from "../admin/keyboards";
import { safeDeleteMessage } from "../utils/safeEdit";
import { groupLogger } from "../../services/logger/GroupLogger";
import { verifyBeforeCheckout } from "../../services/catalog/prePaymentGuardService";
import { Callbacks } from "../keyboards/callbacks";
import { priceChangeConfirmKeyboardForProduct } from "../utils/prePaymentFlow";

function menuKb(hasPending: boolean, telegramId?: number) {
  return mainMenuKeyboard(hasPending, isAdminTelegramId(telegramId));
}

type CheckoutInvoicePanel = InvoiceAmountLinesSource & {
  id: number;
  status: string;
  expiresAt: string | Date;
};

function plainInvoiceFields(invoice: {
  id: number;
  amount: unknown;
  status: string;
  expiresAt: Date;
  discountCode?: string | null;
  originalAmount?: unknown;
  discountPercent?: number | null;
  discountAmount?: unknown;
}): CheckoutInvoicePanel {
  return toPlain({
    id: invoice.id,
    amount: invoice.amount,
    status: invoice.status,
    expiresAt: invoice.expiresAt,
    discountCode: invoice.discountCode ?? null,
    originalAmount: invoice.originalAmount ?? null,
    discountPercent: invoice.discountPercent ?? null,
    discountAmount: invoice.discountAmount ?? null,
  }) as CheckoutInvoicePanel;
}

function logConvError(label: string, err: unknown): void {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  console.error(`[${label}] ${msg}`);
  if (stack) console.error(stack);
}

/**
 * Buy flow:
 * 1) Collect requiredFields (if any)
 * 2) Create PENDING invoice with userInputData
 * 3) Show payment methods
 *
 * Important: conversation.external() return values are structuredClone'd.
 * Never return Prisma models / Decimal / BigInt — always toPlain().
 * Never throw Prisma errors out of external — return a plain result object.
 */
export async function checkoutConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  try {
    const productId = await conversation.external((c) => c.session.checkoutProductId ?? null);
    if (!productId || !ctx.from) {
      await ctx.reply(
        ["⚠️ *خرید ناقص*", "", "محصولی برای خرید انتخاب نشده."].join("\n"),
        {
          parse_mode: "Markdown",
          reply_markup: menuKb(false, ctx.from?.id),
        },
      );
      return;
    }

    const product = await conversation.external(async () => {
      const row = await catalogService.getProduct(productId);
      return row ? toPlain(row) : null;
    });
    if (!product) {
      await ctx.reply(
        [
          "⚠️ *محصول نامعتبر*",
          "",
          "محصول یافت نشد یا غیرفعال است.",
        ].join("\n"),
        {
          parse_mode: "Markdown",
          reply_markup: menuKb(false, ctx.from.id),
        },
      );
      return;
    }

    const fields = catalogService.requiredFieldsOf(product);
    const answers: Record<string, string> = {};

    for (const field of fields) {
      const value = await waitText(
        conversation,
        ctx,
        [
          "📝 *اطلاعات خرید*",
          "",
          `لطفا *${field}* را برای محصول *${product.name}* ارسال کنید:`,
        ].join("\n"),
      );
      if (!value) {
        await conversation.external((c) => {
          c.session.checkoutProductId = undefined;
        });
        await ctx.reply(
          ["❌ *خرید لغو شد*", "", "می توانید دوباره از فروشگاه شروع کنید."].join("\n"),
          {
            parse_mode: "Markdown",
            reply_markup: menuKb(false, ctx.from.id),
          },
        );
        return;
      }
      answers[field] = value;
    }

    // Only pass JSON-safe primitives into external (productId + answers + telegramId)
    const telegramId = ctx.from.id;
    const answersCopy: Record<string, string> = { ...answers };

    const createResult = await conversation.external(async () => {
      try {
        const guard = await verifyBeforeCheckout(productId);
        if (guard.status === "OUT_OF_STOCK") {
          return {
            ok: false as const,
            code: "OOS" as const,
            pendingId: 0,
            message: "out of stock",
          };
        }
        if (guard.status === "PRICE_CHANGED") {
          return {
            ok: false as const,
            code: "PRICE_CHANGED" as const,
            pendingId: 0,
            message: guard.message,
            newPriceToman: guard.newPriceToman,
          };
        }

        const user = await invoiceService.ensureUser(BigInt(telegramId));
        const invoice = await invoiceService.createPendingInvoice(
          user.id,
          productId,
          Object.keys(answersCopy).length > 0 ? answersCopy : undefined,
          product.deliveryType === "USER_CHOICE" ? "READY" : undefined,
        );
        return {
          ok: true as const,
          invoice: plainInvoiceFields(invoice),
        };
      } catch (err) {
        const name = err instanceof Error ? err.name : "";
        if (name === "PendingInvoiceExistsError") {
          const pending = (err as { pending?: { id?: number } }).pending;
          return {
            ok: false as const,
            code: "PENDING" as const,
            pendingId: pending?.id ?? 0,
            message: "open invoice exists",
          };
        }
        return {
          ok: false as const,
          code: "ERROR" as const,
          pendingId: 0,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    });

    if (!createResult.ok) {
      if (createResult.code === "OOS") {
        await conversation.external((c) => {
          c.session.checkoutProductId = undefined;
        });
        await ctx.reply(
          "❌ متاسفانه در این لحظه موجودی این اشتراک به اتمام رسید. لطفاً سایر پلن‌ها را بررسی کنید.",
          { reply_markup: menuKb(false, ctx.from.id) },
        );
        return;
      }

      if (createResult.code === "PRICE_CHANGED") {
        await ctx.reply(createResult.message, {
          reply_markup: priceChangeConfirmKeyboardForProduct(productId),
        });
        const confirm = await conversation.waitForCallbackQuery([
          Callbacks.buyConfirmNewPrice(productId),
          Callbacks.buyCancelNewPrice,
        ]);
        await confirm.answerCallbackQuery();
        if (confirm.callbackQuery.data === Callbacks.buyCancelNewPrice) {
          await conversation.external((c) => {
            c.session.checkoutProductId = undefined;
          });
          await ctx.reply("❌ خرید لغو شد.", { reply_markup: menuKb(false, ctx.from.id) });
          return;
        }

        const retry = await conversation.external(async () => {
          try {
            const user = await invoiceService.ensureUser(BigInt(telegramId));
            const invoice = await invoiceService.createPendingInvoice(
              user.id,
              productId,
              Object.keys(answersCopy).length > 0 ? answersCopy : undefined,
              product.deliveryType === "USER_CHOICE" ? "READY" : undefined,
            );
            return { ok: true as const, invoice: plainInvoiceFields(invoice) };
          } catch (err) {
            return {
              ok: false as const,
              message: err instanceof Error ? err.message : String(err),
            };
          }
        });

        if (!retry.ok) {
          await ctx.reply(
            ["⚠️ *ساخت فاکتور ناموفق بود*", "", retry.message].join("\n"),
            { parse_mode: "Markdown", reply_markup: menuKb(false, ctx.from.id) },
          );
          return;
        }

        const invoice = retry.invoice;
        const userBalance = await conversation.external(async () => {
          const user = await invoiceService.ensureUser(BigInt(telegramId));
          return formatToman(user.balance);
        });

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
            reply_markup: await buildCheckoutPaymentKeyboard(invoice.id, userBalance, {
              hasDiscount: false,
            }),
          },
        );
        return;
      }

      if (createResult.code === "PENDING") {
        const refreshed = await conversation.external(async () => {
          const r = await invoiceService.refreshInvoicePriceIfUsd(createResult.pendingId);
          return r
            ? {
                priceChanged: r.priceChanged,
                oldPrice: r.oldPrice,
                newPrice: r.newPrice,
              }
            : null;
        });
        if (refreshed?.priceChanged) {
          const oldPriceFormatted = refreshed.oldPrice.toLocaleString("en-US");
          const newPriceFormatted = refreshed.newPrice.toLocaleString("en-US");
          await ctx.reply(
            [
              "🔄 بروزرسانی مبلغ فاکتور",
              "",
              "کاربر گرامی، با توجه به اینکه این سرویس با نرخ پایه دلاری محاسبه میشود و از زمان صدور فاکتور قبلی نرخ ارز تغییر کرده است، مبلغ سفارش شما مجدداً محاسبه و بهروزرسانی شد.",
              "",
              `▫️ مبلغ قبلی: ${oldPriceFormatted} تومان`,
              `▫️ مبلغ جدید: ${newPriceFormatted} تومان`,
            ].join("\n"),
          );
        }

        await ctx.reply(
          [
            "⛔ *فاکتور باز*",
            "",
            "ابتدا همان را پرداخت یا لغو کنید.",
            "",
            `🧾 شماره: *#${createResult.pendingId}*`,
          ].join("\n"),
          {
            parse_mode: "Markdown",
            reply_markup: menuKb(true, ctx.from.id),
          },
        );
        return;
      }
      console.error("checkout create invoice failed:", createResult.message);
      await ctx.reply(
        [
          "⚠️ *ساخت فاکتور ناموفق بود*",
          "",
          createResult.message || "خطای ناشناخته",
        ].join("\n"),
        {
          parse_mode: "Markdown",
          reply_markup: menuKb(false, ctx.from.id),
        },
      );
      return;
    }

    let currentInvoice = createResult.invoice;
    let hasDiscount = Boolean(currentInvoice.discountCode);

    await conversation.external((c) => {
      c.session.checkoutProductId = undefined;
    });

    const balanceLabel = await conversation.external(async () => {
      const user = await invoiceService.ensureUser(BigInt(telegramId));
      return formatToman(user.balance);
    });

    const paymentKb = await conversation.external(() =>
      buildCheckoutPaymentKeyboard(currentInvoice.id, balanceLabel, {
        hasDiscount,
      }),
    );

    const inputLines =
      Object.keys(answers).length > 0
        ? [
            "",
            "📋 *اطلاعات ثبت شده:*",
            ...Object.entries(answers).map(([k, v]) => `• *${k}:* ${v}`),
          ]
        : [];

    const renderInvoiceText = (inv: typeof currentInvoice) => [
      "✅ *فاکتور ساخته شد*",
      "",
      `🧾 شماره: *#${inv.id}*`,
      `${emojiForLabel(product.name)} محصول: *${product.name}*`,
      ...renderInvoiceAmountLines(inv),
      `📊 وضعیت: *${inv.status}*`,
      `🚚 ${deliveryTypeLabel(product.deliveryType)}`,
      ...inputLines,
      "",
      "روش پرداخت را انتخاب کنید:",
    ].join("\n");

    const sentMsg = await ctx.reply(renderInvoiceText(currentInvoice), {
      parse_mode: "Markdown",
      reply_markup: paymentKb,
    });

    let panel: PanelRef = {
      chatId: sentMsg.chat.id,
      messageId: sentMsg.message_id,
    };

    const cancelKb = {
      inline_keyboard: [[{ text: "🔴 بازگشت", callback_data: ConvCb.cancel }]],
    };

    while (true) {
      const update = await conversation.waitFor([
        "callback_query:data",
        "message:text",
      ]);

      const textMsg = (update.message?.text ?? "").trim();
      if (textMsg === "/start" || textMsg.startsWith("/start ")) {
        return;
      }

      const cbData = update.callbackQuery?.data;

      // Handle Discount Code Button
      if (cbData && /^(?:discount:apply:|inv:dsc:)/.test(cbData)) {
        await update.answerCallbackQuery();

        if (update.callbackQuery?.message?.message_id && update.chat?.id) {
          panel = {
            chatId: update.chat.id,
            messageId: update.callbackQuery.message.message_id,
          };
        }

        const prompt = [
          "🏷 *اعمال کد تخفیف*",
          "",
          `🧾 شماره فاکتور: *#${currentInvoice.id}*`,
          `💵 مبلغ فعلی: *${formatToman(currentInvoice.amount)}*`,
          "",
          "🏷 لطفاً کد تخفیف خود را ارسال کنید:",
        ].join("\n");

        panel = await ensurePanel(update, prompt, cancelKb, panel);

        while (true) {
          const discountInput = await conversation.waitFor([
            "message:text",
            "callback_query:data",
          ]);

          // Handle Back / Cancel Button
          if (discountInput.callbackQuery?.data === ConvCb.cancel) {
            try {
              await discountInput.answerCallbackQuery({ text: "بازگشت" });
            } catch {}

            const curKb = await conversation.external(() =>
              buildCheckoutPaymentKeyboard(currentInvoice.id, balanceLabel, {
                hasDiscount,
              }),
            );
            panel = await ensurePanel(
              discountInput,
              renderInvoiceText(currentInvoice),
              curKb,
              panel,
            );
            break;
          }

          if (discountInput.callbackQuery) {
            if (
              /^(?:discount:apply:|inv:dsc:)/.test(
                discountInput.callbackQuery.data || "",
              )
            ) {
              try {
                await discountInput.answerCallbackQuery();
              } catch {}
              continue;
            }
            // Other button clicked while asking for discount code (e.g. payment/cancel)
            const curKb = await conversation.external(() =>
              buildCheckoutPaymentKeyboard(currentInvoice.id, balanceLabel, {
                hasDiscount,
              }),
            );
            panel = await ensurePanel(
              discountInput,
              renderInvoiceText(currentInvoice),
              curKb,
              panel,
            );
            await conversation.halt({ next: true });
            return;
          }

          const rawText = (discountInput.message?.text ?? "").trim();
          if (rawText === "/start" || rawText.startsWith("/start ")) {
            return;
          }
          if (rawText === "/cancel") {
            const curKb = await conversation.external(() =>
              buildCheckoutPaymentKeyboard(currentInvoice.id, balanceLabel, {
                hasDiscount,
              }),
            );
            panel = await ensurePanel(
              discountInput,
              renderInvoiceText(currentInvoice),
              curKb,
              panel,
            );
            break;
          }

          if (!rawText) continue;

          // Delete user message to keep chat clean
          if (discountInput.chat?.id && discountInput.message?.message_id) {
            await safeDeleteMessage(
              discountInput.api,
              discountInput.chat.id,
              discountInput.message.message_id,
            );
          }

          const codeStr = rawText.toUpperCase();

          try {
            const result = await conversation.external(async () => {
              const res = await discountService.applyDiscountToInvoice(
                currentInvoice.id,
                codeStr,
                productId,
              );
              return {
                invoice: plainInvoiceFields(res.invoice),
                calc: toPlain(res.calc),
              };
            });

            currentInvoice = result.invoice as CheckoutInvoicePanel;
            hasDiscount = true;

            const successMsg = [
              "✅ *کد تخفیف با موفقیت اعمال شد!*",
              "",
              `▫️ درصد تخفیف: *${result.calc.percentage}٪*`,
              `▫️ مبلغ کسر شده: *${formatToman(result.calc.discountAmount)}*`,
              `▫️ مبلغ نهایی قابل پرداخت: *${formatToman(result.calc.finalAmount)}*`,
            ].join("\n");

            await ctx.reply(successMsg, { parse_mode: "Markdown" });

            // RE-RENDER invoice payment screen with updated lower amount
            const refreshedKb = await conversation.external(() =>
              buildCheckoutPaymentKeyboard(currentInvoice.id, balanceLabel, {
                hasDiscount: true,
              }),
            );

            panel = await ensurePanel(
              ctx,
              renderInvoiceText(currentInvoice),
              refreshedKb,
              panel,
            );
            break;
          } catch (err: unknown) {
            const errMsg =
              err instanceof Error ? err.message : "کد تخفیف وارد شده معتبر نیست.";
            const retryPrompt = [
              `❌ *خطا:* ${errMsg}`,
              "",
              "🏷 لطفاً کد تخفیف دیگری ارسال کنید یا دکمه بازگشت را بزنید:",
            ].join("\n");

            panel = await ensurePanel(ctx, retryPrompt, cancelKb, panel);
          }
        }
      } else {
        // Any payment method (pay:wallet, pay:card, pay:swap, pay:custom),
        // cancel invoice (cancel_inv), main menu, or text command:
        // Halt conversation cleanly with next: true so downstream global handlers process it!
        await conversation.halt({ next: true });
        return;
      }
    }
  } catch (err) {
    logConvError("checkoutConversation", err);
    try {
      await conversation.external((c) => {
        c.session.checkoutProductId = undefined;
      });
    } catch {
      /* ignore */
    }
    await ctx.reply(
      [
        "⚠️ *خطا در فرآیند خرید*",
        "",
        "لطفا دوباره تلاش کنید.",
      ].join("\n"),
      {
        parse_mode: "Markdown",
        reply_markup: menuKb(false, ctx.from?.id),
      },
    );
  }
}

/**
 * Card-to-card: ask for receipt photo, mark AWAITING_APPROVAL, notify admins.
 */
export async function uploadReceiptConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  try {
    const invoiceId = await conversation.external((c) => c.session.receiptInvoiceId ?? null);
    if (!invoiceId || !ctx.from) {
      await ctx.reply(
        [
          "⚠️ *رسید نامشخص*",
          "",
          "فاکتوری برای ارسال رسید مشخص نشده.",
        ].join("\n"),
        { parse_mode: "Markdown" },
      );
      return;
    }

    const telegramId = ctx.from.id;
    const username = ctx.from.username ? `@${ctx.from.username}` : "ندارد";

    const invoice = await conversation.external(async () => {
      const row = await invoiceService.getById(invoiceId);
      if (!row) return null;
      return toPlain({
        id: row.id,
        amount: row.amount,
        status: row.status,
        isWalletTopUp: row.isWalletTopUp,
        userInputData: row.userInputData,
        product: row.product ? { name: row.product.name } : null,
        user: { telegramId: row.user.telegramId.toString() },
      });
    });

    if (!invoice || String(invoice.user.telegramId) !== String(telegramId)) {
      await ctx.reply(
        ["⚠️ *فاکتور نامعتبر*", "", "این فاکتور برای شما معتبر نیست."].join("\n"),
        { parse_mode: "Markdown" },
      );
      return;
    }

    const productLabel = invoice.isWalletTopUp
      ? "شارژ کیف پول"
      : invoice.product?.name ?? "—";

    // waitPhoto returns the highest-resolution photo file_id
    const fileId = await waitPhoto(
      conversation,
      ctx,
      [
        "📷 *ارسال رسید واریز*",
        "",
        `🧾 فاکتور: *#${invoice.id}*`,
        `📦 مورد: *${productLabel}*`,
        `💵 مبلغ: *${formatToman(invoice.amount)}*`,
        "",
        "لطفا تصویر فیش واریزی را همین جا ارسال کنید:",
      ].join("\n"),
    );

    if (!fileId) {
      await conversation.external((c) => {
        c.session.receiptInvoiceId = undefined;
      });
      await ctx.reply(
        [
          "❌ *ارسال رسید لغو شد*",
          "",
          "می توانید بعدا دوباره تلاش کنید.",
        ].join("\n"),
        {
          parse_mode: "Markdown",
          reply_markup: menuKb(true, ctx.from.id),
        },
      );
      return;
    }

    const updated = await conversation.external(async () => {
      try {
        const row = await invoiceService.submitReceipt(invoiceId, fileId);
        return { ok: true as const, id: row.id, status: row.status };
      } catch (err) {
        return {
          ok: false as const,
          id: 0,
          status: "",
          message: err instanceof Error ? err.message : String(err),
        };
      }
    });

    await conversation.external((c) => {
      c.session.receiptInvoiceId = undefined;
    });

    if (!updated.ok) {
      console.error("submitReceipt failed:", updated.message);
      await ctx.reply(
        [
          "⚠️ *ثبت رسید ناموفق بود*",
          "",
          updated.message || "خطای ناشناخته",
        ].join("\n"),
        {
          parse_mode: "Markdown",
          reply_markup: menuKb(true, ctx.from.id),
        },
      );
      return;
    }

    const input = parseUserInputData(invoice.userInputData);
    const inputBlock =
      Object.keys(input).length > 0
        ? [
            "",
            "📋 *اطلاعات خریدار:*",
            ...Object.entries(input).map(([k, v]) => `• ${k}: ${v}`),
          ]
        : [];

    const caption = [
      invoice.isWalletTopUp ? "💰 *درخواست شارژ کیف پول*" : "🧾 *رسید جدید برای تایید*",
      "",
      `🧾 فاکتور: *#${invoice.id}*`,
      `📦 مورد: *${productLabel}*`,
      `💵 مبلغ: *${formatToman(invoice.amount)}*`,
      `👤 شناسه کاربر: \`${String(invoice.user.telegramId)}\``,
      `🔖 نام کاربری: *${username}*`,
      `📊 وضعیت: *${updated.status}*`,
      ...inputBlock,
      "",
      "👇 رسید را تایید یا رد کنید:",
    ].join("\n");

    await conversation.external(async () => {
      await groupLogger.logPurchaseReceipt(
        ctx.api,
        invoice.id,
        caption,
        fileId,
        adminInvoiceReviewKeyboard(invoice.id),
      );
    });

    for (const adminId of env.adminIds) {
      try {
        await ctx.api.sendPhoto(adminId, fileId, {
          caption,
          parse_mode: "Markdown",
          reply_markup: adminInvoiceReviewKeyboard(invoice.id),
        });
      } catch (err) {
        logConvError(`notify admin ${adminId}`, err);
      }
    }

    await ctx.reply(
      [
        "✅ *رسید دریافت شد*",
        "",
        "رسید شما در حال بررسی توسط ادمین است.",
        "",
        `🧾 فاکتور: *#${updated.id}*`,
        `📊 وضعیت: *${updated.status}*`,
        "",
        "پس از تایید، نتیجه همین جا اعلام می شود.",
      ].join("\n"),
      {
        parse_mode: "Markdown",
        reply_markup: menuKb(true, ctx.from.id),
      },
    );
  } catch (err) {
    logConvError("uploadReceiptConversation", err);
    await ctx.reply(
      ["⚠️ *خطا در ثبت رسید*", "", "لطفا دوباره تلاش کنید."].join("\n"),
      { parse_mode: "Markdown" },
    );
  }
}

export async function supportConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  try {
    if (!ctx.from) return;

    const text = await waitText(
      conversation,
      ctx,
      [
        "🎧 *پشتیبانی اشتراکینو*",
        "",
        "پیام خود را بنویسید تا برای تیم پشتیبانی ارسال شود:",
      ].join("\n"),
    );
    if (!text) {
      await ctx.reply(
        ["❌ *پشتیبانی لغو شد*", "", "هر زمان آماده بودید دوباره پیام بفرستید."].join(
          "\n",
        ),
        {
          parse_mode: "Markdown",
          reply_markup: menuKb(false, ctx.from.id),
        },
      );
      return;
    }

    const telegramId = ctx.from.id;
    const ticket = await conversation.external(async () => {
      try {
        const user = await invoiceService.ensureUser(BigInt(telegramId));
        const row = await ticketService.createUserMessage(user.id, text);
        return { ok: true as const, id: row.id };
      } catch (err) {
        return {
          ok: false as const,
          id: 0,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    });

    if (!ticket.ok) {
      await ctx.reply(
        [
          "⚠️ *ثبت تیکت ناموفق بود*",
          "",
          ticket.message || "خطای ناشناخته",
        ].join("\n"),
        {
          parse_mode: "Markdown",
          reply_markup: menuKb(false, ctx.from.id),
        },
      );
      return;
    }

    await ctx.reply(
      [
        "✅ *پیام شما ثبت شد*",
        "",
        `🎫 تیکت: *#${ticket.id}*`,
        "",
        "به محض پاسخ، همین جا مطلع می شوید.",
      ].join("\n"),
      {
        parse_mode: "Markdown",
        reply_markup: menuKb(false, ctx.from.id),
      },
    );

    const notify = [
      "🎧 پیام پشتیبانی جدید",
      "",
      `🎫 تیکت: #${ticket.id}`,
      `👤 کاربر: ${ctx.from.id}`,
      "",
      text,
    ].join("\n");

    for (const adminId of env.adminIds) {
      try {
        await ctx.api.sendMessage(adminId, notify, {
          reply_markup: adminTicketReplyKeyboard(ticket.id),
        });
      } catch (err) {
        logConvError(`notify admin ${adminId} ticket`, err);
      }
    }
  } catch (err) {
    logConvError("supportConversation", err);
    await ctx.reply(
      ["⚠️ *خطا در ارسال پیام پشتیبانی*", "", "لطفا دوباره تلاش کنید."].join("\n"),
      { parse_mode: "Markdown" },
    );
  }
}
