import type { Api } from "grammy";
import type { InlineKeyboard } from "grammy";
import type { Prisma, SupplierOrder, SupplierOrderStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";
import { groupLogger } from "../logger/GroupLogger";
import {
  buildSupplierAdminActionKeyboard,
  supplierOrderAdminKeyboard,
} from "../../bot/admin/supplierOrderKeyboards";
import { isMessageNotModified } from "../../bot/utils/safeEdit";

export type SupplierAlertMessageRef = { chatId: string; messageId: number };

function parseDmRefs(raw: Prisma.JsonValue | null | undefined): SupplierAlertMessageRef[] {
  if (!Array.isArray(raw)) return [];
  const out: SupplierAlertMessageRef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const chatId = (item as { chatId?: unknown }).chatId;
    const messageId = (item as { messageId?: unknown }).messageId;
    if (typeof chatId === "string" && typeof messageId === "number") {
      out.push({ chatId, messageId });
    }
  }
  return out;
}

function refKey(ref: SupplierAlertMessageRef): string {
  return `${ref.chatId}:${ref.messageId}`;
}

export async function getSupplierOrderAdminTelegramIds(): Promise<number[]> {
  const ids = new Set<number>();
  for (const envId of env.adminIds) {
    ids.add(envId);
  }

  const dbAdmins = await prisma.user.findMany({
    where: { adminPermissions: { isEmpty: false } },
    select: { telegramId: true },
  });
  for (const row of dbAdmins) {
    ids.add(Number(row.telegramId));
  }

  return [...ids];
}

export class SupplierOrderAlertService {
  collectAlertRefs(order: SupplierOrder | null | undefined): SupplierAlertMessageRef[] {
    if (!order) return [];
    const refs: SupplierAlertMessageRef[] = [];
    const seen = new Set<string>();

    if (order.logGroupChatId && order.logGroupMessageId != null) {
      const ref = {
        chatId: order.logGroupChatId,
        messageId: order.logGroupMessageId,
      };
      refs.push(ref);
      seen.add(refKey(ref));
    }

    for (const ref of parseDmRefs(order.adminDmAlertRefs)) {
      const key = refKey(ref);
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push(ref);
    }

    return refs;
  }

  messageRefFromCallback(ctx: {
    callbackQuery?: { message?: { chat: { id: number; type: string }; message_id: number } };
  }): SupplierAlertMessageRef | undefined {
    const msg = ctx.callbackQuery?.message;
    if (!msg) return undefined;
    return { chatId: String(msg.chat.id), messageId: msg.message_id };
  }

  async captureCallbackOrigin(
    invoiceId: number,
    ctx: {
      callbackQuery?: { message?: { chat: { id: number; type: string }; message_id: number } };
    },
  ): Promise<void> {
    const ref = this.messageRefFromCallback(ctx);
    if (!ref) return;

    const chatType = ctx.callbackQuery?.message?.chat.type;
    const isGroup = chatType === "group" || chatType === "supergroup";

    const order = await prisma.supplierOrder.findUnique({
      where: { internalInvoiceId: invoiceId },
    });
    if (!order) return;

    if (isGroup) {
      await prisma.supplierOrder.update({
        where: { id: order.id },
        data: {
          logGroupChatId: ref.chatId,
          logGroupMessageId: ref.messageId,
        },
      });
      return;
    }

    const dmRefs = parseDmRefs(order.adminDmAlertRefs);
    if (!dmRefs.some((r) => refKey(r) === refKey(ref))) {
      dmRefs.push(ref);
    }
    await prisma.supplierOrder.update({
      where: { id: order.id },
      data: { adminDmAlertRefs: dmRefs as Prisma.InputJsonValue },
    });
  }

  async registerDmAlertRef(invoiceId: number, ref: SupplierAlertMessageRef): Promise<void> {
    const order = await prisma.supplierOrder.findUnique({
      where: { internalInvoiceId: invoiceId },
    });
    if (!order) return;

    const dmRefs = parseDmRefs(order.adminDmAlertRefs);
    if (!dmRefs.some((r) => refKey(r) === refKey(ref))) {
      dmRefs.push(ref);
    }
    await prisma.supplierOrder.update({
      where: { id: order.id },
      data: { adminDmAlertRefs: dmRefs as Prisma.InputJsonValue },
    });
  }

  async persistPublishedAlertRefs(
    invoiceId: number,
    logRef: SupplierAlertMessageRef | null,
    dmRefs: SupplierAlertMessageRef[],
  ): Promise<void> {
    await prisma.supplierOrder.updateMany({
      where: { internalInvoiceId: invoiceId },
      data: {
        ...(logRef
          ? {
              logGroupChatId: logRef.chatId,
              logGroupMessageId: logRef.messageId,
            }
          : {}),
        adminDmAlertRefs: dmRefs as Prisma.InputJsonValue,
      },
    });
  }

  async publishOpenOrderAlert(api: Api, invoiceId: number, text: string): Promise<void> {
    const kb = buildSupplierAdminActionKeyboard(invoiceId);
    const logRef = await groupLogger.sendPurchaseTopicAlert(api, text, kb);

    const dmRefs: SupplierAlertMessageRef[] = [];
    const adminIds = await getSupplierOrderAdminTelegramIds();
    for (const adminId of adminIds) {
      try {
        const sent = await api.sendMessage(String(adminId), text, {
          parse_mode: "Markdown",
          reply_markup: kb,
        });
        dmRefs.push({ chatId: String(adminId), messageId: sent.message_id });
      } catch {
        /* blocked or unreachable */
      }
    }

    await this.persistPublishedAlertRefs(invoiceId, logRef, dmRefs);
  }

  async refreshLegacyCardKeyboard(
    api: Api,
    invoiceId: number,
    chatId: number | string,
    messageId: number,
  ): Promise<void> {
    const kb = buildSupplierAdminActionKeyboard(invoiceId);
    try {
      await api.editMessageReplyMarkup(String(chatId), messageId, { reply_markup: kb });
    } catch (err) {
      if (!isMessageNotModified(err)) {
        console.warn("[SupplierOrderAlert] refreshLegacyCardKeyboard failed:", err);
      }
    }
  }

  private async editTrackedMessage(
    api: Api,
    ref: SupplierAlertMessageRef,
    text: string,
    replyMarkup?: InlineKeyboard,
  ): Promise<void> {
    try {
      await api.editMessageText(ref.chatId, ref.messageId, text, {
        parse_mode: "Markdown",
        reply_markup: replyMarkup ?? { inline_keyboard: [] },
      });
    } catch (err) {
      if (isMessageNotModified(err)) return;
      console.warn(
        `[SupplierOrderAlert] edit failed chat=${ref.chatId} msg=${ref.messageId}:`,
        err,
      );
    }
  }

  async syncSupplierOrderAlertMessages(
    api: Api,
    invoiceId: number,
    text: string,
    options?: {
      exclude?: SupplierAlertMessageRef;
      replyMarkup?: InlineKeyboard;
    },
  ): Promise<void> {
    const order = await prisma.supplierOrder.findUnique({
      where: { internalInvoiceId: invoiceId },
    });
    const refs = this.collectAlertRefs(order);
    const excludeKey = options?.exclude ? refKey(options.exclude) : null;

    for (const ref of refs) {
      if (excludeKey && refKey(ref) === excludeKey) continue;
      await this.editTrackedMessage(api, ref, text, options?.replyMarkup);
    }
  }

  async syncSupplierOrderResolution(
    api: Api,
    invoiceId: number,
    resolvedText: string,
    exclude?: SupplierAlertMessageRef,
  ): Promise<void> {
    await this.syncSupplierOrderAlertMessages(api, invoiceId, resolvedText, {
      exclude,
      replyMarkup: undefined,
    });
  }

  createActionSync(
    api: Api,
    invoiceId: number,
    sourceRef?: SupplierAlertMessageRef,
  ): {
    resolved: (text: string) => Promise<void>;
    openWithKeyboard: (text: string) => Promise<void>;
  } {
    return {
      resolved: async (text: string) => {
        await this.syncSupplierOrderResolution(api, invoiceId, text, sourceRef);
      },
      openWithKeyboard: async (text: string) => {
        const kb = supplierOrderAdminKeyboard(invoiceId);
        await this.syncSupplierOrderAlertMessages(api, invoiceId, text, {
          exclude: sourceRef,
          replyMarkup: kb,
        });
      },
    };
  }

  formatOpenOrderCardText(order: {
    internalInvoiceId: number;
    status: SupplierOrderStatus;
    errorMessage: string | null;
    invoice: {
      createdAt: Date;
      user: { telegramId: bigint };
      product: { name: string } | null;
    };
  }): string {
    const invoice = order.invoice;
    const productName = invoice.product?.name ?? "—";
    const userId = invoice.user.telegramId.toString();
    const date = invoice.createdAt.toLocaleString("fa-IR", { timeZone: "Asia/Tehran" });
    const err = order.errorMessage?.trim();

    const statusLine =
      order.status === "PENDING_MANUAL_DELIVERY"
        ? "🚨 *تحویل دستی (تامین‌کننده ناموجود)*"
        : order.status === "PENDING_ADMIN_DISPATCH"
          ? "📦 *سفارش تامین‌کننده (منتظر ارسال)*"
          : order.status === "FAILED"
            ? "❌ *سفارش ناموفق / لغو شده*"
            : order.status === "UNCERTAIN"
              ? "❓ *سفارش نامشخص (نیاز به بررسی)*"
              : `📦 *وضعیت:* \`${order.status}\``;

    const lines = [
      statusLine,
      "",
      `▫️ شماره فاکتور: \`#${order.internalInvoiceId}\``,
      `▫️ محصول: *${productName}*`,
      `▫️ کاربر: \`${userId}\``,
      `▫️ تاریخ: ${date}`,
    ];
    if (err) {
      lines.push("", `❌ *آخرین خطا:* ${err}`);
    }
    lines.push("", "👇 اقدام مورد نظر را انتخاب کنید:");
    return lines.join("\n");
  }
}

export const supplierOrderAlertService = new SupplierOrderAlertService();
