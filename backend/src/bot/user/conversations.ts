import type { EshtrakinoConversation, SessionContext } from "../context";
import { Decimal } from "@prisma/client/runtime/library";
import { invoiceService } from "../../services/invoices/InvoiceService";
import { paymentMethodService } from "../../services/paymentMethods/PaymentMethodService";
import { groupLogger } from "../../services/logger/GroupLogger";
import { parseUserInputData, formatToman } from "../../lib/money";
import { toPlain } from "../../lib/plain";
import { ticketService } from "../../services/tickets/TicketService";
import { adminInvoiceReviewKeyboard } from "../keyboards/builders";
import { waitPhoto, waitText } from "../conversations/wait";
import { env } from "../../config/env";

const MIN_TOP_UP_TOMAN = 10_000;

export async function collectCredentialsConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  try {
    const invoiceId = await conversation.external((c) => c.session.credentialsInvoiceId ?? null);
    if (!invoiceId || !ctx.from) {
      await ctx.reply("⚠️ فاکتور معتبری برای ثبت اطلاعات یافت نشد.");
      return;
    }

    const invoice = await conversation.external(async () =>
      invoiceService.getPaidInvoiceForCredentials(invoiceId, BigInt(ctx.from!.id)),
    );

    if (!invoice || !invoice.product) {
      await conversation.external((c) => {
        c.session.credentialsInvoiceId = undefined;
      });
      await ctx.reply(
        [
          "⚠️ *دسترسی نامعتبر*",
          "",
          "این فاکتور برای ثبت اطلاعات اکانت واجد شرایط نیست.",
        ].join("\n"),
        { parse_mode: "Markdown" },
      );
      return;
    }

    const existing = parseUserInputData(invoice.userInputData);
    if (existing.credentialsSubmitted === "true") {
      await conversation.external((c) => {
        c.session.credentialsInvoiceId = undefined;
      });
      await ctx.reply(
        [
          "ℹ️ *قبلا ثبت شده*",
          "",
          "اطلاعات اکانت این فاکتور قبلا ثبت شده است.",
        ].join("\n"),
        { parse_mode: "Markdown" },
      );
      return;
    }

    const email = await waitText(
      conversation,
      ctx,
      "📧 لطفاً **ایمیل** اکانت خود را بفرستید:",
    );
    if (!email) {
      await conversation.external((c) => {
        c.session.credentialsInvoiceId = undefined;
      });
      await ctx.reply("❌ عملیات لغو شد.");
      return;
    }

    let password = "ندارد (فقط ایمیل)";
    if (invoice.product.credentialReq === "BOTH") {
      const passwordInput = await waitText(
        conversation,
        ctx,
        "🔑 لطفاً **رمز عبور** اکانت خود را بفرستید:",
      );
      if (!passwordInput) {
        await conversation.external((c) => {
          c.session.credentialsInvoiceId = undefined;
        });
        await ctx.reply("❌ عملیات لغو شد.");
        return;
      }
      password = passwordInput;
    }

    await conversation.external(async () => {
      await invoiceService.saveBuyerCredentials(invoiceId, email, password);
    });

    await conversation.external(async () => {
      await groupLogger.logCredentials(
        ctx.api,
        invoice.id,
        invoice.user.telegramId.toString(),
        invoice.product!.name,
        email,
        password,
      );
    });

    await conversation.external((c) => {
      c.session.credentialsInvoiceId = undefined;
    });

    await ctx.reply(
      "✅ اطلاعات شما با موفقیت ثبت شد و سفارش در حال انجام است.",
    );
  } catch (err) {
    console.error("collectCredentialsConversation error:", err);
    await conversation.external((c) => {
      c.session.credentialsInvoiceId = undefined;
    });
    await ctx.reply(
      ["⚠️ *خطا در ثبت اطلاعات*", "", "لطفا دوباره تلاش کنید."].join("\n"),
      { parse_mode: "Markdown" },
    );
  }
}

export async function createTicketConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  try {
    if (!ctx.from) return;

    const text = await waitText(
      conversation,
      ctx,
      [
        "🎧 *پشتیبانی / تیکت*",
        "",
        "لطفاً پیام خود را برای پشتیبانی بنویسید:",
      ].join("\n"),
    );

    if (!text) {
      await ctx.reply("❌ عملیات لغو شد.");
      return;
    }

    const userObj = await conversation.external(async () => {
      const u = await invoiceService.ensureUser(BigInt(ctx.from!.id));
      return { id: u.id, telegramIdStr: String(u.telegramId) };
    });

    const ticketObj = await conversation.external(async () => {
      const t = await ticketService.createUserMessage(userObj.id, text);
      const lastMessage = t.messages[t.messages.length - 1];
      return { id: t.id, lastMessageId: lastMessage?.id };
    });

    if (!ticketObj.lastMessageId) {
      throw new Error("Ticket message was not created");
    }

    const messageId = await conversation.external(async () =>
      groupLogger.logNewTicket(
        ctx.api,
        ticketObj.id,
        { telegramId: userObj.telegramIdStr },
        text,
      ),
    );

    if (messageId !== null) {
      await conversation.external(async () => {
        await ticketService.setGroupMessageId(ticketObj.lastMessageId!, messageId);
      });
    }

    await ctx.reply(
      `✅ پیام شما با موفقیت ثبت شد و به زودی پاسخ داده خواهد شد. (کد پیگیری: \`#${ticketObj.id}\`)`,
      { parse_mode: "Markdown" },
    );
  } catch (err) {
    console.error("createTicketConversation error:", err);
    await ctx.reply(
      ["⚠️ *خطا در ثبت تیکت*", "", "لطفا دوباره تلاش کنید."].join("\n"),
      { parse_mode: "Markdown" },
    );
  }
}

export async function walletTopUpConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  try {
    if (!ctx.from) return;

    const methodId = await conversation.external(
      (c) => c.session.walletTopUpMethodId ?? null,
    );

    const method = await conversation.external(async () => {
      if (methodId) {
        const row = await paymentMethodService.getById(methodId);
        if (!row || !row.isActive) return null;
        return toPlain(row);
      }
      // Legacy entry (wallet:topup): first active CARD, else first active method
      const methods = await paymentMethodService.listActive();
      const preferred =
        methods.find((m) => m.type === "CARD") ?? methods[0] ?? null;
      return preferred ? toPlain(preferred) : null;
    });

    if (!method) {
      await conversation.external((c) => {
        c.session.walletTopUpMethodId = undefined;
      });
      await ctx.reply(
        [
          "⚠️ *روش پرداخت در دسترس نیست*",
          "",
          "هیچ روش پرداخت فعالی برای شارژ کیف پول تنظیم نشده است.",
        ].join("\n"),
        { parse_mode: "Markdown" },
      );
      return;
    }

    const amountText = await waitText(
      conversation,
      ctx,
      [
        "💰 *شارژ کیف پول*",
        "",
        `روش: *${method.name}*`,
        "",
        "لطفاً مبلغ شارژ را به *تومان* وارد کنید:",
        "",
        `حداقل مبلغ: *${formatToman(MIN_TOP_UP_TOMAN)}*`,
      ].join("\n"),
    );

    if (!amountText) {
      await conversation.external((c) => {
        c.session.walletTopUpMethodId = undefined;
      });
      await ctx.reply("❌ عملیات لغو شد.");
      return;
    }

    const normalized = amountText.replace(/[,،\s]/g, "");
    const amountNumber = Number(normalized);
    if (!Number.isFinite(amountNumber) || amountNumber < MIN_TOP_UP_TOMAN) {
      await conversation.external((c) => {
        c.session.walletTopUpMethodId = undefined;
      });
      await ctx.reply(
        [
          "⚠️ *مبلغ نامعتبر*",
          "",
          `حداقل مبلغ شارژ *${formatToman(MIN_TOP_UP_TOMAN)}* است.`,
        ].join("\n"),
        { parse_mode: "Markdown" },
      );
      return;
    }

    const amountLabel = formatToman(amountNumber);
    if (method.type === "CARD") {
      await ctx.reply(
        paymentMethodService.buildCardDepositBlock(method, amountLabel),
        { parse_mode: "HTML" },
      );
    } else {
      await ctx.reply(
        paymentMethodService.buildInstructions(method, amountLabel, "شارژ کیف پول"),
        { parse_mode: "HTML" },
      );
    }

    if (method.type !== "CARD") {
      await conversation.external((c) => {
        c.session.walletTopUpMethodId = undefined;
      });
      await ctx.reply(
        [
          "ℹ️ *توجه*",
          "",
          "شارژ خودکار از طریق درگاه آنلاین هنوز فعال نیست.",
          "لطفاً از روش کارت به کارت یا سواپ ولت استفاده کنید.",
        ].join("\n"),
        { parse_mode: "Markdown" },
      );
      return;
    }

    const fileId = await waitPhoto(
      conversation,
      ctx,
      [
        "📷 *ارسال رسید واریز*",
        "",
        `💵 مبلغ: *${amountLabel}*`,
        `💳 روش: *${method.name}*`,
        "",
        "لطفاً تصویر فیش واریزی را همین جا ارسال کنید:",
      ].join("\n"),
    );

    if (!fileId) {
      await conversation.external((c) => {
        c.session.walletTopUpMethodId = undefined;
      });
      await ctx.reply("❌ عملیات لغو شد.");
      return;
    }

    const telegramId = ctx.from.id;
    const username = ctx.from.username ? `@${ctx.from.username}` : "ندارد";

    const result = await conversation.external(async () => {
      try {
        const user = await invoiceService.ensureUser(BigInt(telegramId));
        const invoice = await invoiceService.createWalletTopUpInvoice(
          user.id,
          new Decimal(amountNumber),
        );
        await invoiceService.markAwaitingReceipt(invoice.id);
        const updated = await invoiceService.submitReceipt(invoice.id, fileId);
        return {
          ok: true as const,
          invoiceId: updated.id,
          amount: amountNumber,
          userTelegramId: user.telegramId.toString(),
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

    await conversation.external((c) => {
      c.session.walletTopUpMethodId = undefined;
    });

    if (!result.ok) {
      if (result.code === "PENDING") {
        await ctx.reply(
          [
            "⛔ *فاکتور باز*",
            "",
            "ابتدا فاکتور باز قبلی را پرداخت یا لغو کنید.",
            "",
            `🧾 شماره: *#${result.pendingId}*`,
          ].join("\n"),
          { parse_mode: "Markdown" },
        );
        return;
      }

      await ctx.reply(
        ["⚠️ *ثبت درخواست ناموفق بود*", "", result.message].join("\n"),
        { parse_mode: "Markdown" },
      );
      return;
    }

    await conversation.external(async () => {
      await groupLogger.logWalletTopUpRequest(
        ctx.api,
        result.invoiceId,
        result.amount,
        result.userTelegramId,
        fileId,
        username,
        adminInvoiceReviewKeyboard(result.invoiceId),
      );
    });

    for (const adminId of env.adminIds) {
      try {
        await ctx.api.sendPhoto(adminId, fileId, {
          caption: [
            "💰 *درخواست شارژ کیف پول*",
            "",
            `🧾 فاکتور: *#${result.invoiceId}*`,
            `💵 مبلغ: *${formatToman(result.amount)}*`,
            `👤 شناسه کاربر: \`${result.userTelegramId}\``,
            `🔖 نام کاربری: *${username}*`,
          ].join("\n"),
          parse_mode: "Markdown",
          reply_markup: adminInvoiceReviewKeyboard(result.invoiceId),
        });
      } catch (err) {
        console.error(`notify admin ${adminId} wallet top-up failed:`, err);
      }
    }

    await ctx.reply(
      [
        "✅ *درخواست شارژ ثبت شد*",
        "",
        "رسید شما در حال بررسی توسط ادمین است.",
        "",
        `🧾 فاکتور: *#${result.invoiceId}*`,
        `💵 مبلغ: *${formatToman(result.amount)}*`,
        "",
        "پس از تایید، موجودی کیف پول شما به روز می شود.",
      ].join("\n"),
      { parse_mode: "Markdown" },
    );
  } catch (err) {
    console.error("walletTopUpConversation error:", err);
    await ctx.reply(
      ["⚠️ *خطا در ثبت شارژ کیف پول*", "", "لطفا دوباره تلاش کنید."].join("\n"),
      { parse_mode: "Markdown" },
    );
  }
}
