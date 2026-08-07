/**
 * User-facing Swap Wallet top-up UI (Fluid UI).
 * Translated from swappay/swap_handlers.py.
 */
import { createConversation } from "@grammyjs/conversations";
import { InlineKeyboard, type Bot } from "grammy";
import { Decimal } from "@prisma/client/runtime/library";
import type { SwapWalletInvoice } from "@prisma/client";
import type { BotContext, EshtrakinoConversation, SessionContext } from "../context";
import { Callbacks } from "../keyboards/callbacks";
import { safeEdit } from "../utils/safeEdit";
import {
  ensurePanel,
  panelFromCtx,
  waitTextOnPanel,
} from "../conversations/wait";
import { invoiceService } from "../../services/invoices/InvoiceService";
import { formatToman } from "../../lib/money";
import { toPlain } from "../../lib/plain";
import {
  settingsService,
  SWAPPAY_ENABLED,
} from "../../services/settings/SettingsService";
import { buildCheckoutPaymentKeyboard } from "../keyboards/paymentChoice";
import { fulfillmentService } from "../../services/fulfillment/FulfillmentService";
import { groupLogger } from "../../services/logger/GroupLogger";
import {
  InsufficientBalanceError,
  walletService,
} from "../../services/wallet/WalletService";
import { prisma } from "../../lib/prisma";
import {
  buildPaymentUrl,
  cancelInvoice,
  checkoutSwapNote,
  createInvoice,
  enforceVerifyCooldown,
  findActivePendingInvoice,
  formatExactUsdt,
  getLiveUsdtIrtRate,
  loadSwapSettings,
  parseCheckoutInvoiceId,
  quantizeUsdt,
  SwapPayError,
  SwappayVerifyRateLimited,
  verifyInvoice,
  type ApproveResult,
} from "../../services/payments/SwapWalletService";

export const DEFAULT_DEPOSIT_AMOUNTS = [
  new Decimal("5"),
  new Decimal("10"),
  new Decimal("20"),
  new Decimal("50"),
];

export function depositAmountsKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const amt of DEFAULT_DEPOSIT_AMOUNTS) {
    const label = amt.toFixed(2).replace(/\.?0+$/, "");
    kb.text(`💵 $${label}`, Callbacks.walletSwapAmount(Number(amt))).row();
  }
  kb.text("⌨️ مبلغ دلخواه (USD)", Callbacks.walletSwapAmountCustom).row();
  kb.text("🔙 بازگشت", Callbacks.wallet);
  return kb;
}

export function invoiceKeyboard(
  paymentLink: string,
  invoiceId: number,
  options?: { checkoutInvoiceId?: number },
): InlineKeyboard {
  const kb = new InlineKeyboard();
  const payUrl = (paymentLink || "").trim();
  if (payUrl.startsWith("http://") || payUrl.startsWith("https://")) {
    kb.url("💳 پرداخت آنلاین", payUrl).row();
  }
  kb.text("🔄 بررسی وضعیت پرداخت", Callbacks.walletSwapVerify(invoiceId)).row();
  kb.text("❌ لغو فاکتور سواپ", Callbacks.walletSwapCancel(invoiceId)).row();
  if (options?.checkoutInvoiceId) {
    kb.text(
      "🔙 بازگشت به روش‌های پرداخت",
      Callbacks.pay(options.checkoutInvoiceId),
    ).row();
  } else {
    kb.text("🔙 بازگشت", Callbacks.wallet).row();
  }
  return kb;
}

export function invoiceText(
  inv: SwapWalletInvoice,
  notice?: string,
  options?: { productName?: string; amountTomanLabel?: string },
): string {
  const exact = inv.exactCryptoAmount ?? inv.amountUsd ?? new Decimal(0);
  const exactStr = formatExactUsdt(exact);
  const tracking = inv.trackingCode || `SP-${inv.id}`;
  const lines = ["✅ *فاکتور پرداخت (Swap Wallet)*", ""];
  if (options?.productName) {
    lines.push(`📦 محصول: *${options.productName}*`);
  }
  if (options?.amountTomanLabel) {
    lines.push(`💵 مبلغ فاکتور: *${options.amountTomanLabel}*`);
  }
  lines.push(
    `🔢 کد پیگیری: \`${tracking}\``,
    `💎 مبلغ دقیق واریز: *${exactStr} USDT*`,
    "",
    "⚠️ دقیقاً همین مبلغ را ارسال کنید (کسری یکتا برای تایید خودکار).",
    "",
    "✅ سیستم به‌صورت خودکار واریزی شما را در کمتر از ۵ دقیقه تایید می‌کند.",
    "",
    "⏳ مهلت پرداخت این فاکتور حداکثر ۵ ساعت می‌باشد.",
  );
  const body = lines.join("\n");
  return notice ? `${notice}\n\n${body}` : body;
}

async function renderInvoice(
  ctx: SessionContext,
  inv: SwapWalletInvoice,
  notice?: string,
  options?: {
    checkoutInvoiceId?: number;
    productName?: string;
    amountTomanLabel?: string;
  },
): Promise<void> {
  const settings = await loadSwapSettings();
  const exact = quantizeUsdt(inv.exactCryptoAmount ?? inv.amountUsd ?? 0);
  const payUrl =
    (inv.paymentUrl || "").trim() || buildPaymentUrl(settings, exact);
  const checkoutInvoiceId =
    options?.checkoutInvoiceId ?? parseCheckoutInvoiceId(inv.note);
  await safeEdit(
    ctx,
    invoiceText(inv, notice, {
      productName: options?.productName,
      amountTomanLabel: options?.amountTomanLabel,
    }),
    {
      parse_mode: "Markdown",
      reply_markup: invoiceKeyboard(payUrl, inv.id, {
        checkoutInvoiceId: checkoutInvoiceId ?? undefined,
      }),
    },
  );
}

function creditedKeyboard(checkoutInvoiceId: number | null): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (checkoutInvoiceId) {
    kb.text(
      "💰 پرداخت از کیف پول و تکمیل خرید",
      Callbacks.payWallet(checkoutInvoiceId),
    ).row();
    kb.text("🔙 روش‌های پرداخت", Callbacks.pay(checkoutInvoiceId)).row();
  } else {
    kb.text("🔙 بازگشت", Callbacks.wallet).row();
  }
  return kb;
}

async function resolveCheckoutInvoiceId(swapInvoiceId: number): Promise<number | null> {
  const row = await prisma.swapWalletInvoice.findUnique({
    where: { id: swapInvoiceId },
    select: { note: true },
  });
  return parseCheckoutInvoiceId(row?.note);
}

/**
 * After Swap credit: auto-finalize product purchase when linked to checkout.
 * Falls back to "pay from wallet" CTA if auto-pay is not possible.
 */
async function handleSwapCreditSuccess(
  ctx: SessionContext,
  userId: number,
  swapInvoiceId: number,
  result: ApproveResult,
): Promise<void> {
  const checkoutInvoiceId = await resolveCheckoutInvoiceId(swapInvoiceId);

  if (checkoutInvoiceId) {
    const pending = await invoiceService.getById(checkoutInvoiceId);
    if (
      pending &&
      pending.userId === userId &&
      !pending.isWalletTopUp &&
      pending.status === "PENDING" &&
      pending.product &&
      Number(result.newBalance) >= Number(pending.amount)
    ) {
      try {
        const invoice = await walletService.processWalletPurchase(
          checkoutInvoiceId,
          userId,
        );
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
            "✅ *پرداخت با سواپ ولت تایید و خرید تکمیل شد*",
            "",
            `🔢 کد پیگیری سواپ: \`${result.trackingCode}\``,
            `💵 واریز: *${formatExactUsdt(result.amountUsd)} USDT*`,
            `🧾 فاکتور: *#${invoice.id}*`,
            `📦 محصول: *${invoice.product!.name}*`,
            `💵 مبلغ: *${formatToman(invoice.amount)}*`,
            `📊 وضعیت: *PAID*`,
          ].join("\n"),
          {
            parse_mode: "Markdown",
            reply_markup: new InlineKeyboard().text(
              "🏠 منوی اصلی",
              Callbacks.mainMenu,
            ),
          },
        );

        await fulfillmentService.processApprovedInvoice(ctx.api, invoice.id);
        return;
      } catch (err) {
        if (!(err instanceof InsufficientBalanceError)) {
          console.error("[SwapPay] checkout auto-purchase failed:", err);
        }
      }
    }
  }

  await safeEdit(
    ctx,
    [
      "✅ *پرداخت تایید شد*",
      "",
      `🔢 کد پیگیری: \`${result.trackingCode}\``,
      `💵 مبلغ: *${formatExactUsdt(result.amountUsd)} USDT*`,
      `💰 شارژ کیف پول: *${formatToman(result.amountIrt)}*`,
      `💰 موجودی جدید: *${formatToman(result.newBalance)}*`,
      ...(checkoutInvoiceId
        ? [
            "",
            "موجودی کیف پول شارژ شد. برای تکمیل خرید محصول، «پرداخت از کیف پول» را بزنید.",
          ]
        : []),
    ].join("\n"),
    {
      parse_mode: "Markdown",
      reply_markup: creditedKeyboard(checkoutInvoiceId),
    },
  );
}

async function createInvoiceForUser(
  ctx: SessionContext,
  userId: number,
  amountUsd: Decimal,
): Promise<void> {
  const active = await findActivePendingInvoice(userId);
  if (active) {
    await renderInvoice(
      ctx,
      active,
      "⚠️ شما یک فاکتور باز دارید. ابتدا آن را پرداخت یا لغو کنید.",
    );
    return;
  }

  try {
    const { invoice } = await createInvoice({ userId, amountUsd });
    await renderInvoice(ctx, invoice);
  } catch (err) {
    if (err instanceof SwapPayError) {
      console.warn("[SwapPay] invoice error:", err.message);
      await safeEdit(
        ctx,
        ["❌ *خطا در ایجاد فاکتور*", "", err.message].join("\n"),
        { parse_mode: "Markdown", reply_markup: depositAmountsKeyboard() },
      );
      return;
    }
    console.error("[SwapPay] invoice creation failed:", err);
    await ctx.answerCallbackQuery?.({
      text: "خطای داخلی. لطفاً دوباره تلاش کنید.",
      show_alert: true,
    });
  }
}

/** Fluid conversation: custom USD amount → delete user text → create invoice. */
export async function swapCustomAmountConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  try {
    if (!ctx.from) return;
    const telegramId = ctx.from.id;
    const user = await conversation.external(async () => {
      const row = await invoiceService.ensureUser(BigInt(telegramId));
      // Lean + toPlain — Decimal/BigInt cannot cross conversation.external()
      return toPlain({ id: row.id });
    });

    let panel = panelFromCtx(ctx);
    if (!panel) {
      panel = await ensurePanel(
        ctx,
        [
          "⌨️ *مبلغ دلخواه (USD)*",
          "",
          "مبلغ شارژ را به دلار وارد کنید (مثلاً `15`):",
        ].join("\n"),
        {
          inline_keyboard: [[{ text: "❌ لغو", callback_data: "conv:cancel" }]],
        },
        null,
      );
    }

    let prompt = [
      "⌨️ *مبلغ دلخواه (USD)*",
      "",
      "مبلغ شارژ را به دلار وارد کنید (مثلاً `15`):",
    ].join("\n");

    while (true) {
      const waited = await waitTextOnPanel(conversation, ctx, prompt, panel);
      panel = waited.panel;
      if (!waited.text) {
        await ensurePanel(
          ctx,
          "❌ عملیات لغو شد.",
          depositAmountsKeyboard(),
          panel,
        );
        return;
      }

      const cleaned = waited.text.replace(/[,،\s]/g, "");
      let amountUsd: Decimal;
      try {
        amountUsd = quantizeUsdt(cleaned);
      } catch {
        prompt = [
          "⚠️ *مبلغ نامعتبر*",
          "",
          "لطفاً یک عدد معتبر به دلار بفرستید (مثلاً `15`):",
        ].join("\n");
        continue;
      }

      if (amountUsd.lte(0) || amountUsd.gt(10_000)) {
        prompt = [
          "⚠️ *مبلغ نامعتبر*",
          "",
          "مبلغ باید بین ۰٫۰۱ تا ۱۰۰۰۰ دلار باشد:",
        ].join("\n");
        continue;
      }

      // Clone-safe primitives only — recreate Decimal inside external()
      const amountUsdStr = formatExactUsdt(amountUsd);
      const userId = user.id;

      const active = await conversation.external(async () =>
        toPlain(await findActivePendingInvoice(userId)),
      );
      if (active) {
        const settings = await conversation.external(() => loadSwapSettings());
        const exact = quantizeUsdt(
          active.exactCryptoAmount ?? active.amountUsd ?? 0,
        );
        const payUrl =
          (active.paymentUrl || "").trim() ||
          buildPaymentUrl(settings, exact);
        await ensurePanel(
          ctx,
          invoiceText(
            active as SwapWalletInvoice,
            "⚠️ شما یک فاکتور باز دارید. ابتدا آن را پرداخت یا لغو کنید.",
          ),
          invoiceKeyboard(payUrl, active.id),
          panel,
        );
        return;
      }

      try {
        const created = await conversation.external(async () =>
          toPlain(
            await createInvoice({
              userId,
              amountUsd: quantizeUsdt(amountUsdStr),
            }),
          ),
        );
        const settings = await conversation.external(() => loadSwapSettings());
        const exact = quantizeUsdt(
          created.invoice.exactCryptoAmount ?? created.invoice.amountUsd ?? 0,
        );
        const payUrl =
          (created.invoice.paymentUrl || "").trim() ||
          buildPaymentUrl(settings, exact);
        await ensurePanel(
          ctx,
          invoiceText(created.invoice as SwapWalletInvoice),
          invoiceKeyboard(payUrl, created.invoice.id),
          panel,
        );
        return;
      } catch (err) {
        if (err instanceof SwapPayError) {
          await ensurePanel(
            ctx,
            ["❌ *خطا در ایجاد فاکتور*", "", err.message].join("\n"),
            depositAmountsKeyboard(),
            panel,
          );
          return;
        }
        throw err;
      }
    }
  } catch (err) {
    console.error("[SwapPay] custom amount conversation error:", err);
    await ctx.reply(
      ["⚠️ *خطا*", "", "لطفا دوباره تلاش کنید."].join("\n"),
      { parse_mode: "Markdown", reply_markup: depositAmountsKeyboard() },
    );
  }
}

export function registerSwapHandlers(bot: Bot<BotContext>): void {
  bot.use(createConversation(swapCustomAmountConversation, "swapCustomAmount"));

  /** Checkout: pay product invoice via Swap Wallet (USD slot → wallet credit → auto purchase). */
  bot.callbackQuery(/^pay:swap:(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const productInvoiceId = Number(ctx.match![1]);

    const enabled = await settingsService.getBoolSetting(SWAPPAY_ENABLED, true);
    if (!enabled) {
      await ctx.answerCallbackQuery({
        text: "سواپ ولت فعلاً غیرفعال است.",
        show_alert: true,
      });
      return;
    }

    const user = await invoiceService.ensureUser(BigInt(ctx.from.id));
    const pending = await invoiceService.getOpenInvoice(user.id);

    if (
      !pending ||
      pending.id !== productInvoiceId ||
      pending.isWalletTopUp ||
      !pending.product ||
      pending.status !== "PENDING"
    ) {
      await ctx.answerCallbackQuery({ text: "فاکتور نامعتبر", show_alert: true });
      return;
    }

    try {
      const tomanAmount = Number(pending.amount);
      if (!Number.isFinite(tomanAmount) || tomanAmount <= 0) {
        await ctx.answerCallbackQuery({ text: "مبلغ فاکتور نامعتبر", show_alert: true });
        return;
      }

      const liveRate = await getLiveUsdtIrtRate();
      const amountUsd = quantizeUsdt(tomanAmount / liveRate);
      if (amountUsd.lte(0)) {
        await ctx.answerCallbackQuery({
          text: "مبلغ دلاری قابل محاسبه نیست.",
          show_alert: true,
        });
        return;
      }

      const active = await findActivePendingInvoice(user.id);
      if (active) {
        const linked = parseCheckoutInvoiceId(active.note);
        if (linked === productInvoiceId) {
          await ctx.answerCallbackQuery();
          await renderInvoice(ctx, active, undefined, {
            checkoutInvoiceId: productInvoiceId,
            productName: pending.product.name,
            amountTomanLabel: formatToman(pending.amount),
          });
          return;
        }
        await ctx.answerCallbackQuery();
        await renderInvoice(
          ctx,
          active,
          "⚠️ شما یک فاکتور سواپ باز دارید. ابتدا آن را پرداخت یا لغو کنید.",
          {
            checkoutInvoiceId: linked ?? undefined,
            productName: pending.product.name,
            amountTomanLabel: formatToman(pending.amount),
          },
        );
        return;
      }

      const { invoice } = await createInvoice({
        userId: user.id,
        amountUsd,
        note: checkoutSwapNote(productInvoiceId),
      });

      await ctx.answerCallbackQuery({ text: "فاکتور سواپ ساخته شد" });
      await renderInvoice(ctx, invoice, undefined, {
        checkoutInvoiceId: productInvoiceId,
        productName: pending.product.name,
        amountTomanLabel: formatToman(pending.amount),
      });
    } catch (err) {
      if (err instanceof SwapPayError) {
        console.warn("[SwapPay] checkout invoice error:", err.message);
        await ctx.answerCallbackQuery({ text: err.message, show_alert: true });
        await safeEdit(
          ctx,
          ["❌ *خطا در ایجاد فاکتور سواپ*", "", err.message].join("\n"),
          {
            parse_mode: "Markdown",
            reply_markup: await buildCheckoutPaymentKeyboard(
              productInvoiceId,
              formatToman(user.balance),
            ),
          },
        );
        return;
      }
      console.error("[SwapPay] checkout pay:swap failed:", err);
      await ctx.answerCallbackQuery({
        text: "خطای داخلی. لطفاً دوباره تلاش کنید.",
        show_alert: true,
      });
    }
  });

  bot.callbackQuery(Callbacks.walletSwapDeposit, async (ctx) => {
    const enabled = await settingsService.getBoolSetting(SWAPPAY_ENABLED, true);
    if (!enabled) {
      await ctx.answerCallbackQuery({
        text: "سواپ ولت فعلاً غیرفعال است.",
        show_alert: true,
      });
      return;
    }
    await ctx.answerCallbackQuery();
    await safeEdit(
      ctx,
      [
        "💎 *شارژ کیف پول با Swap Wallet*",
        "",
        "مبلغ واریزی را انتخاب کنید (به دلار):",
        "",
        "پس از انتخاب، فاکتور با مبلغ دقیق (کسری یکتا) ساخته می‌شود و لینک پرداخت در اختیار شما قرار می‌گیرد.",
      ].join("\n"),
      { parse_mode: "Markdown", reply_markup: depositAmountsKeyboard() },
    );
  });

  bot.callbackQuery(/^swap_amt:(\d+(?:\.\d+)?)$/, async (ctx) => {
    if (!ctx.from) return;
    const raw = ctx.match![1]!;
    let amountUsd: Decimal;
    try {
      amountUsd = quantizeUsdt(raw);
    } catch {
      await ctx.answerCallbackQuery({ text: "مبلغ نامعتبر است.", show_alert: true });
      return;
    }
    if (amountUsd.lte(0)) {
      await ctx.answerCallbackQuery({
        text: "مبلغ باید بزرگ‌تر از صفر باشد.",
        show_alert: true,
      });
      return;
    }

    await ctx.answerCallbackQuery();
    const user = await invoiceService.ensureUser(BigInt(ctx.from.id));
    await createInvoiceForUser(ctx, user.id, amountUsd);
  });

  bot.callbackQuery(Callbacks.walletSwapAmountCustom, async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      await ctx.conversation.exitAll();
    } catch {
      /* ignore */
    }
    await ctx.conversation.enter("swapCustomAmount");
  });

  bot.callbackQuery(/^verify_swappay:(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const invoiceId = Number(ctx.match![1]);
    const user = await invoiceService.ensureUser(BigInt(ctx.from.id));

    try {
      enforceVerifyCooldown(invoiceId);
    } catch (err) {
      if (err instanceof SwappayVerifyRateLimited) {
        await ctx.answerCallbackQuery({ text: err.message });
        return;
      }
      throw err;
    }

    try {
      const result = await verifyInvoice({ invoiceId, userId: user.id });
      if (!result) {
        await ctx.answerCallbackQuery({
          text:
            "❌ هنوز واریزی با این مبلغ دقیق به حساب ما ننشسته است. (اگر تازه واریز کردید، ۱ تا ۳ دقیقه زمان می‌برد)",
          show_alert: true,
        });
        return;
      }

      await ctx.answerCallbackQuery({ text: "پرداخت تأیید شد ✅" });
      await handleSwapCreditSuccess(ctx, user.id, invoiceId, result);
    } catch (err) {
      if (err instanceof SwapPayError) {
        await ctx.answerCallbackQuery({ text: err.message, show_alert: true });
        return;
      }
      console.error("[SwapPay] verify error:", err);
      await ctx.answerCallbackQuery({
        text: "خطای داخلی. لطفاً دوباره تلاش کنید.",
        show_alert: true,
      });
    }
  });

  bot.callbackQuery(/^cancel_swappay:(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const invoiceId = Number(ctx.match![1]);
    const user = await invoiceService.ensureUser(BigInt(ctx.from.id));
    const checkoutInvoiceId = await resolveCheckoutInvoiceId(invoiceId);

    try {
      const result = await cancelInvoice({ invoiceId, userId: user.id });

      if (result.approved && result.approveResult) {
        await ctx.answerCallbackQuery({ text: "پرداخت تأیید شد ✅" });
        await handleSwapCreditSuccess(
          ctx,
          user.id,
          invoiceId,
          result.approveResult,
        );
        return;
      }

      await ctx.answerCallbackQuery({ text: "فاکتور لغو شد" });

      if (checkoutInvoiceId) {
        await safeEdit(
          ctx,
          [
            "❌ فاکتور سواپ لغو شد.",
            "",
            "می‌توانید روش پرداخت دیگری انتخاب کنید.",
          ].join("\n"),
          {
            parse_mode: "Markdown",
            reply_markup: await buildCheckoutPaymentKeyboard(
              checkoutInvoiceId,
              formatToman(user.balance),
            ),
          },
        );
        return;
      }

      await safeEdit(
        ctx,
        "❌ فاکتور لغو شد.\n\nمی‌توانید فاکتور جدیدی بسازید.",
        { parse_mode: "Markdown", reply_markup: depositAmountsKeyboard() },
      );
    } catch (err) {
      if (err instanceof SwapPayError) {
        await ctx.answerCallbackQuery({ text: err.message, show_alert: true });
        return;
      }
      console.error("[SwapPay] cancel error:", err);
      await ctx.answerCallbackQuery({
        text: "خطای داخلی. لطفاً دوباره تلاش کنید.",
        show_alert: true,
      });
    }
  });

  bot.callbackQuery(/^open_swappay:(\d+)$/, async (ctx) => {
    if (!ctx.from) return;
    const invoiceId = Number(ctx.match![1]);
    const user = await invoiceService.ensureUser(BigInt(ctx.from.id));
    const active = await findActivePendingInvoice(user.id);
    if (!active || active.id !== invoiceId) {
      await ctx.answerCallbackQuery({
        text: "فاکتور فعالی یافت نشد یا منقضی شده است.",
        show_alert: true,
      });
      return;
    }
    await ctx.answerCallbackQuery();
    await renderInvoice(ctx, active);
  });
}
