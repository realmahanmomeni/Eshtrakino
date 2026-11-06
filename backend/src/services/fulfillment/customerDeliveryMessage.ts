import type { Api } from "grammy";
import { escapeHtml } from "../../lib/htmlEscape";
import { assertCustomerDeliveryMessageSafe } from "./canbosoDeliveryFormat";

export type CustomerDeliveryMessageParams = {
  productName: string;
  invoiceId: number;
  durationDays?: number | null;
  deliveryContentHtml: string;
  instructions?: string | null;
};

export function formatCustomerDeliveryMessage(params: CustomerDeliveryMessageParams): string {
  const lines: string[] = [
    "🎉 <b>سفارش شما با موفقیت آماده و تحویل داده شد!</b>",
    "━━━━━━━━━━━━━━━━━━",
    `🛍 <b>محصول:</b> ${escapeHtml(params.productName)}`,
    `🧾 <b>شماره سفارش:</b> <code>#${params.invoiceId}</code>`,
  ];

  if (params.durationDays != null && params.durationDays > 0) {
    lines.push(`⏳ <b>مدت اشتراک:</b> ${params.durationDays} روز`);
  }

  lines.push(
    "━━━━━━━━━━━━━━━━━━",
    "",
    "📦 <b>اطلاعات تحویل محصول:</b>",
    "",
    params.deliveryContentHtml.trim(),
    "",
    "━━━━━━━━━━━━━━━━━━",
    "💡 <i>از خرید و اعتماد شما به <b>اشتراکینو</b> سپاسگزاریم. در صورت نیاز به راهنمایی، بخش پشتیبانی در خدمت شماست.</i>",
  );

  if (params.instructions?.trim()) {
    lines.splice(lines.length - 1, 0, "", escapeHtml(params.instructions.trim()));
  }

  return lines.join("\n");
}

/** Plain admin / inventory text → safe HTML fragment (links stay clickable). */
export function formatPlainTextDeliveryContentHtml(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "📎 محتوای تحویل در پیام ضمیمه ارسال شده است.";
  }

  const lines = trimmed.split(/\r?\n/);
  const out: string[] = [];

  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      out.push("");
      continue;
    }

    const url = extractFirstHttpUrl(t);
    if (url && isLinkOnlyLine(t, url)) {
      out.push("🔗 <b>لینک اختصاصی فعال‌سازی:</b>", url);
      continue;
    }

    const creds = parseEmailPasswordLine(t);
    if (creds) {
      out.push(
        `👤 <b>نام کاربری / ایمیل:</b> <code>${escapeHtml(creds.user)}</code>`,
        `🔑 <b>رمز عبور:</b> <code>${escapeHtml(creds.password)}</code>`,
      );
      continue;
    }

    out.push(escapeHtml(t));
  }

  return out.join("\n");
}

function extractFirstHttpUrl(text: string): string | null {
  const markdown = /\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/i.exec(text);
  if (markdown?.[2]) return markdown[2].trim();

  const direct = /(https?:\/\/[^\s<>"')\]]+)/i.exec(text);
  if (direct?.[1]) return direct[1].replace(/[.,;]+$/u, "").trim();

  if (/^https?:\/\//i.test(text.trim())) return text.trim();
  return null;
}

function isLinkOnlyLine(line: string, url: string): boolean {
  const withoutMd = line.replace(/\[([^\]]*)\]\([^)]+\)/g, "$1").trim();
  if (/^https?:\/\//i.test(withoutMd) && !withoutMd.includes(":")) return true;
  if (withoutMd === url || withoutMd.startsWith(url)) return true;
  if (withoutMd.includes(url) && !/[:@].*[:@]/.test(withoutMd.replace(url, ""))) return true;
  return /^https?:\/\//i.test(withoutMd);
}

function parseEmailPasswordLine(line: string): { user: string; password: string } | null {
  const sep = line.match(/^([^:\s@]+@[^\s:]+)\s*[:|]\s*(.+)$/);
  if (sep?.[1] && sep[2]) {
    return { user: sep[1].trim(), password: sep[2].trim() };
  }
  const generic = line.match(/^([^:\s]+)\s*[:|]\s*(.+)$/);
  if (generic?.[1] && generic?.[2] && generic[2].length > 0 && !/^https?:\/\//i.test(generic[1])) {
    return { user: generic[1].trim(), password: generic[2].trim() };
  }
  return null;
}

export type CustomerDeliveryCopySource = {
  chatId: number;
  messageId: number;
};

export async function deliverProductToCustomer(
  api: Api,
  telegramUserId: string,
  params: CustomerDeliveryMessageParams,
  options?: { copyMessageFrom?: CustomerDeliveryCopySource },
): Promise<void> {
  assertCustomerDeliveryMessageSafe(params.deliveryContentHtml);
  const message = formatCustomerDeliveryMessage(params);
  assertCustomerDeliveryMessageSafe(message);

  if (options?.copyMessageFrom) {
    await api.copyMessage(
      telegramUserId,
      options.copyMessageFrom.chatId,
      options.copyMessageFrom.messageId,
    );
  }

  await api.sendMessage(telegramUserId, message, { parse_mode: "HTML" });
}
