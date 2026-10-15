import type { Api, InlineKeyboard } from "grammy";
import { InputFile } from "grammy";
import type { Decimal } from "@prisma/client/runtime/library";
import { formatToman } from "../../lib/money";
import { invoiceService } from "../invoices/InvoiceService";
import {
  settingsService,
  LOG_GROUP_ID_KEY,
  LOG_PURCHASE_TOPIC_ID_KEY,
  LOG_BACKUP_TOPIC_ID_KEY,
  LOG_INVENTORY_TOPIC_ID_KEY,
  LOG_OTHER_TOPIC_ID_KEY,
  LOG_TICKET_TOPIC_ID_KEY,
} from "../settings/SettingsService";

const PURCHASE_TOPIC_NAME = "گزارش های خرید 🛍";
const BACKUP_TOPIC_NAME = "بکاپ ربات 🤖";
const OTHER_TOPIC_NAME = "سایر گزارشات ⚙️";
const INVENTORY_TOPIC_NAME = "گزارش انبار 📦";
const TICKET_TOPIC_NAME = "پشتیبانی 🎧";

/**
 * Sends operational logs to the configured Telegram group.
 * LOG_GROUP_ID is stored in SystemSetting (set via admin panel).
 */
export class GroupLogger {
  async getLogGroupId(): Promise<string | null> {
    const value = await settingsService.getSetting(LOG_GROUP_ID_KEY);
    if (!value || value.trim() === "") return null;
    return value.trim();
  }

  /** Send a plain text message to the log group; no-op if not configured. */
  async sendMessage(api: Api, text: string, extra?: { parse_mode?: "Markdown" | "HTML" }): Promise<void> {
    const chatId = await this.getLogGroupId();
    if (!chatId) return;

    try {
      await api.sendMessage(chatId, text, extra);
    } catch (err) {
      console.warn("[GroupLogger] sendMessage failed:", err);
    }
  }

  /** Forward / relay a photo with caption to the log group; no-op if not configured. */
  async sendPhoto(
    api: Api,
    photo: string,
    caption?: string,
    extra?: { parse_mode?: "Markdown" | "HTML" },
  ): Promise<void> {
    const chatId = await this.getLogGroupId();
    if (!chatId) return;

    try {
      await api.sendPhoto(chatId, photo, {
        caption,
        parse_mode: extra?.parse_mode,
      });
    } catch (err) {
      console.warn("[GroupLogger] sendPhoto failed:", err);
    }
  }

  async logCanbosoDispatchRequest(
    api: Api,
    text: string,
    replyMarkup?: InlineKeyboard,
  ): Promise<void> {
    const chatId = await this.getLogGroupId();
    if (!chatId) return;

    const threadId = await this.ensureTopic(
      api,
      chatId,
      LOG_PURCHASE_TOPIC_ID_KEY,
      PURCHASE_TOPIC_NAME,
    );

    try {
      await api.sendMessage(chatId, text, {
        parse_mode: "Markdown",
        message_thread_id: threadId,
        reply_markup: replyMarkup,
      });
    } catch (err) {
      console.warn("[GroupLogger] logCanbosoDispatchRequest failed:", err);
    }
  }

  async logPurchase(
    api: Api,
    invoiceId: number,
    productName: string,
    amount: Decimal | string | number,
    userTelegramId: string,
  ): Promise<void> {
    const chatId = await this.getLogGroupId();
    if (!chatId) return;

    const threadId = await this.ensureTopic(
      api,
      chatId,
      LOG_PURCHASE_TOPIC_ID_KEY,
      PURCHASE_TOPIC_NAME,
    );

    try {
      await api.sendMessage(
        chatId,
        [
          "🛒 *خرید جدید*",
          "",
          `🧾 فاکتور: *#${invoiceId}*`,
          `📦 محصول: *${productName}*`,
          `💵 مبلغ: *${formatToman(amount)}*`,
          `👤 کاربر: \`${userTelegramId}\``,
        ].join("\n"),
        {
          parse_mode: "Markdown",
          message_thread_id: threadId,
        },
      );
    } catch (err) {
      console.warn("[GroupLogger] logPurchase failed:", err);
    }
  }

  async logWalletTopUpRequest(
    api: Api,
    invoiceId: number,
    amount: Decimal | string | number,
    userTelegramId: string,
    receiptFileId: string,
    username: string,
    replyMarkup?: InlineKeyboard,
  ): Promise<number | null> {
    const chatId = await this.getLogGroupId();
    if (!chatId) return null;

    const threadId = await this.ensureTopic(
      api,
      chatId,
      LOG_PURCHASE_TOPIC_ID_KEY,
      PURCHASE_TOPIC_NAME,
    );

    const caption = [
      "💰 *درخواست شارژ کیف پول*",
      "",
      `🧾 فاکتور: *#${invoiceId}*`,
      `💵 مبلغ: *${formatToman(amount)}*`,
      `👤 شناسه کاربر: \`${userTelegramId}\``,
      `🔖 نام کاربری: *${username}*`,
      "",
      "👇 رسید را تایید یا رد کنید:",
    ].join("\n");

    try {
      const sent = await api.sendPhoto(chatId, receiptFileId, {
        caption,
        parse_mode: "Markdown",
        message_thread_id: threadId,
        reply_markup: replyMarkup,
      });
      await invoiceService.setLogMessageId(invoiceId, sent.message_id);
      return sent.message_id;
    } catch (err) {
      console.warn("[GroupLogger] logWalletTopUpRequest failed:", err);
      return null;
    }
  }

  async logPurchaseReceipt(
    api: Api,
    invoiceId: number,
    caption: string,
    receiptFileId: string,
    replyMarkup?: InlineKeyboard,
  ): Promise<number | null> {
    const chatId = await this.getLogGroupId();
    if (!chatId) return null;

    const threadId = await this.ensureTopic(
      api,
      chatId,
      LOG_PURCHASE_TOPIC_ID_KEY,
      PURCHASE_TOPIC_NAME,
    );

    try {
      const sent = await api.sendPhoto(chatId, receiptFileId, {
        caption,
        parse_mode: "Markdown",
        message_thread_id: threadId,
        reply_markup: replyMarkup,
      });
      await invoiceService.setLogMessageId(invoiceId, sent.message_id);
      return sent.message_id;
    } catch (err) {
      console.warn("[GroupLogger] logPurchaseReceipt failed:", err);
      return null;
    }
  }

  async logFinance(
    api: Api,
    amount: Decimal | string | number,
    paymentType: "CARD" | "GATEWAY",
  ): Promise<void> {
    const label = paymentType === "CARD" ? "کارت به کارت" : "درگاه پرداخت";
    await this.sendMessage(
      api,
      [
        "💰 *ثبت درآمد*",
        "",
        `💵 مبلغ: *${formatToman(amount)}*`,
        `💳 روش: *${label}*`,
      ].join("\n"),
      { parse_mode: "Markdown" },
    );
  }

  async logError(api: Api, message: string, error: unknown): Promise<void> {
    const detail =
      error instanceof Error ? error.message : typeof error === "string" ? error : String(error);
    await this.sendMessage(
      api,
      [
        "🚨 *خطای سیستمی*",
        "",
        message,
        "",
        `\`${detail.slice(0, 500)}\``,
      ].join("\n"),
      { parse_mode: "Markdown" },
    );
  }

  async logOutOfStock(
    api: Api,
    productName: string,
    invoiceId: number,
  ): Promise<void> {
    await this.sendMessage(
      api,
      [
        "⚠️ *هشدار: اتمام موجودی*",
        "",
        `موجودی محصول \`${productName}\` به پایان رسیده است (فاکتور #${invoiceId}).`,
      ].join("\n"),
      { parse_mode: "Markdown" },
    );
  }

  async logCredentials(
    api: Api,
    invoiceId: number,
    userTelegramId: string,
    productName: string,
    email: string,
    password: string,
  ): Promise<void> {
    await this.sendMessage(
      api,
      [
        "🔐 *دریافت اطلاعات اکانت از خریدار*",
        "",
        `🔹 فاکتور: \`#${invoiceId}\``,
        `👤 کاربر: [User](tg://user?id=${userTelegramId}) (\`${userTelegramId}\`)`,
        `📦 محصول: \`${productName}\``,
        "",
        `📧 ایمیل: \`${email}\``,
        `🔑 رمز عبور: \`${password}\``,
      ].join("\n"),
      { parse_mode: "Markdown" },
    );
  }

  async logLowStock(api: Api, productName: string, remaining: number): Promise<void> {
    const chatId = await this.getLogGroupId();
    if (!chatId) return;
    const threadId = await this.ensureTopic(
      api,
      chatId,
      LOG_INVENTORY_TOPIC_ID_KEY,
      INVENTORY_TOPIC_NAME,
    );

    try {
      await api.sendMessage(
        chatId,
        [
          "⚠️ *هشدار موجودی انبار*",
          "",
          `موجودی محصول *${productName}* به نقطه سفارش رسید!`,
          `تعداد باقیمانده: *${remaining}* عدد.`,
        ].join("\n"),
        {
          parse_mode: "Markdown",
          message_thread_id: threadId,
        },
      );
    } catch (err) {
      console.warn("[GroupLogger] logLowStock failed:", err);
    }
  }

  async logNewUser(
    api: Api,
    user: { id: number; username?: string | null },
    referrer?: { id: number; username?: string | null } | null,
  ): Promise<void> {
    const chatId = await this.getLogGroupId();
    if (!chatId) return;
    const threadId = await this.ensureTopic(api, chatId, LOG_OTHER_TOPIC_ID_KEY, OTHER_TOPIC_NAME);
    const date = new Date().toLocaleString("fa-IR", { timeZone: "Asia/Tehran" });
    const referrerInfo = referrer
      ? `[User](tg://user?id=${referrer.id}) (${referrer.id}${referrer.username ? ` · @${referrer.username}` : ""})`
      : "ندارد";

    try {
      await api.sendMessage(
        chatId,
        [
          "🆕 *کاربر جدید عضو شد*",
          "",
          `👤 کاربر: [User](tg://user?id=${user.id}) (${user.id}${user.username ? ` · @${user.username}` : ""})`,
          `📅 تاریخ: ${date}`,
          `🔗 معرف: ${referrerInfo}`,
        ].join("\n"),
        {
          parse_mode: "Markdown",
          message_thread_id: threadId,
        },
      );
    } catch (err) {
      console.warn("[GroupLogger] logNewUser failed:", err);
    }
  }

  async logNewTicket(
    api: Api,
    ticketId: number,
    user: { telegramId: string; name?: string },
    text: string,
  ): Promise<number | null> {
    const msgText = [
      `🎫 *تیکت جدید: #${ticketId}*`,
      `👤 کاربر: [${user.name || "User"}](tg://user?id=${user.telegramId})`,
      "",
      "متن پیام:",
      text,
    ].join("\n");

    const replyMarkup = {
      inline_keyboard: [
        [
          { text: "💬 پاسخ به تیکت", callback_data: `adm:tkt:reply:${ticketId}` },
          { text: "🔒 بستن تیکت", callback_data: `adm:ticket:close:${ticketId}` }
        ],
      ],
    };

    // 1. Notify Log Group
    let groupMessageId: number | null = null;
    try {
      const chatId = await this.getLogGroupId();
      if (chatId) {
        const threadId = await this.ensureTopic(api, chatId, LOG_TICKET_TOPIC_ID_KEY, TICKET_TOPIC_NAME);
        const sent = await api.sendMessage(chatId, msgText, {
          parse_mode: "Markdown",
          message_thread_id: threadId,
          reply_markup: replyMarkup,
        });
        groupMessageId = sent.message_id;
      }
    } catch (err) {
      console.warn("[GroupLogger] logNewTicket group failed:", err);
    }

    // 2. Direct Message to SUPPORT admins
    try {
      const { prisma } = await import("../../lib/prisma.js");
      const { env } = await import("../../config/env.js");
      
      const dbAdmins = await prisma.user.findMany({
        where: { adminPermissions: { has: "SUPPORT" } },
        select: { telegramId: true }
      });
      
      const adminIds = new Set<number>();
      for (const a of dbAdmins) adminIds.add(Number(a.telegramId));
      for (const envId of env.adminIds) adminIds.add(envId);

      for (const adminId of adminIds) {
        try {
          await api.sendMessage(adminId, msgText, {
            parse_mode: "Markdown",
            reply_markup: replyMarkup,
          });
        } catch (e) {
           // silently ignore blocked admins
        }
      }
    } catch (err) {
      console.warn("[GroupLogger] logNewTicket dm failed:", err);
    }

    return groupMessageId;
  }

  /** Create all standard log-group forum topics up front (idempotent via ensureTopic). */
  async initializeAllTopics(api: Api): Promise<void> {
    const chatId = await this.getLogGroupId();
    if (!chatId) {
      throw new Error("LOG_GROUP_ID is not configured");
    }

    await this.ensureTopic(api, chatId, LOG_PURCHASE_TOPIC_ID_KEY, PURCHASE_TOPIC_NAME);
    await this.ensureTopic(api, chatId, LOG_BACKUP_TOPIC_ID_KEY, BACKUP_TOPIC_NAME);
    await this.ensureTopic(api, chatId, LOG_OTHER_TOPIC_ID_KEY, OTHER_TOPIC_NAME);
    await this.ensureTopic(api, chatId, LOG_INVENTORY_TOPIC_ID_KEY, INVENTORY_TOPIC_NAME);
    await this.ensureTopic(api, chatId, LOG_TICKET_TOPIC_ID_KEY, TICKET_TOPIC_NAME);
  }

  private async ensureTopic(
    api: Api,
    chatId: string,
    settingKey: string,
    topicName: string,
  ): Promise<number | undefined> {
    const stored = await settingsService.getSetting(settingKey);
    if (stored && Number.isFinite(Number(stored))) {
      return Number(stored);
    }

    try {
      const topic = await api.createForumTopic(chatId, topicName);
      const threadId = topic.message_thread_id;
      await settingsService.setSetting(settingKey, String(threadId));
      return threadId;
    } catch (err) {
      console.warn("[GroupLogger] ensureTopic failed:", err);
      return undefined;
    }
  }

  async logBackup(api: Api, filePath: string, caption: string): Promise<void> {
    const chatId = await this.getLogGroupId();
    if (!chatId) {
      throw new Error("LOG_GROUP_ID is not configured");
    }

    const threadId = await this.ensureTopic(api, chatId, LOG_BACKUP_TOPIC_ID_KEY, BACKUP_TOPIC_NAME);

    try {
      await api.sendDocument(chatId, new InputFile(filePath), {
        caption,
        parse_mode: "Markdown",
        message_thread_id: threadId,
      });
    } catch (err) {
      console.warn("[GroupLogger] logBackup failed:", err);
      throw err;
    }
  }
}

export const groupLogger = new GroupLogger();
