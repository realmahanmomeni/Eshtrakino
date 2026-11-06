import { escapeHtml } from "../../lib/htmlEscape";

const LEAK_PATTERNS: RegExp[] = [
  /\bpayment\b/i,
  /\bamountText\b/i,
  /\bbalanceText\b/i,
  /\borderCode\b/i,
  /\boriginalAmount\b/i,
  /\{\s*"success"/i,
  /"payment"\s*:/i,
  /"order"\s*:\s*\{/i,
];

export function assertCustomerDeliveryMessageSafe(message: string): void {
  for (const pattern of LEAK_PATTERNS) {
    if (pattern.test(message)) {
      throw new Error(
        `[DeliverySecurity] Customer delivery message contains forbidden supplier metadata: ${pattern}`,
      );
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pickString(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return undefined;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && value.trim().toLowerCase() !== "null";
}

export function extractHttpUrlFromUserField(user: string): string {
  const trimmed = user.trim();
  const markdown = /\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/i.exec(trimmed);
  if (markdown?.[2]) return markdown[2].trim();

  const direct = /(https?:\/\/[^\s<>"')\]]+)/i.exec(trimmed);
  if (direct?.[1]) return direct[1].replace(/[.,;]+$/u, "").trim();

  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return trimmed;
}

function isLinkOnlyAccount(user: string, password: unknown): boolean {
  const url = extractHttpUrlFromUserField(user);
  if (!/^https?:\/\//i.test(url)) return false;
  if (password == null) return true;
  if (typeof password === "string" && password.trim() === "") return true;
  return false;
}

export function formatCanbosoAccountDeliveryHtml(account: Record<string, unknown>): string {
  const user = pickString(account.user, account.username, account.email, account.login) ?? "";
  const password = pickString(account.password, account.pass);
  const verifyEmail = pickString(account.verifyEmail, account.verify_email);
  const expiryText = pickString(account.expiryText, account.expiry_text, account.expiry);
  const otherInfo = pickString(account.otherInfo, account.other_info, account.note);

  if (!user) return "";

  if (isLinkOnlyAccount(user, account.password ?? account.pass)) {
    const url = extractHttpUrlFromUserField(user);
    const lines = ["🔗 <b>لینک اختصاصی فعال‌سازی:</b>", url];
    if (otherInfo) lines.push(`📝 <b>توضیحات تکمیلی:</b> ${escapeHtml(otherInfo)}`);
    if (expiryText) lines.push(`⏳ <b>اعتبار:</b> ${escapeHtml(expiryText)}`);
    return lines.join("\n");
  }

  if (password) {
    const lines = [
      `👤 <b>نام کاربری / ایمیل:</b> <code>${escapeHtml(user)}</code>`,
      `🔑 <b>رمز عبور:</b> <code>${escapeHtml(password)}</code>`,
    ];
    if (verifyEmail) {
      lines.push(`📧 <b>ایمیل تایید:</b> <code>${escapeHtml(verifyEmail)}</code>`);
    }
    if (expiryText) {
      lines.push(`⏳ <b>اعتبار:</b> ${escapeHtml(expiryText)}`);
    }
    if (otherInfo) {
      lines.push(`📝 <b>توضیحات تکمیلی:</b> ${escapeHtml(otherInfo)}`);
    }
    return lines.join("\n");
  }

  return escapeHtml(user);
}

function formatCanbosoDeliveryNode(delivery: Record<string, unknown>): string {
  const blocks: string[] = [];

  const accounts = delivery.accounts;
  if (Array.isArray(accounts)) {
    for (const entry of accounts) {
      const acc = asRecord(entry);
      if (!acc) continue;
      const html = formatCanbosoAccountDeliveryHtml(acc);
      if (html) blocks.push(html);
    }
  }

  const codes = delivery.codes ?? delivery.vouchers ?? delivery.items;
  if (Array.isArray(codes)) {
    for (const entry of codes) {
      if (typeof entry === "string" && entry.trim()) {
        blocks.push(`🎟 <b>کد:</b> <code>${escapeHtml(entry.trim())}</code>`);
        continue;
      }
      const rec = asRecord(entry);
      if (!rec) continue;
      const code = pickString(rec.code, rec.voucher, rec.value, rec.text, rec.key);
      if (code) blocks.push(`🎟 <b>کد:</b> <code>${escapeHtml(code)}</code>`);
    }
  }

  const text = pickString(delivery.text, delivery.message, delivery.link, delivery.url, delivery.data);
  if (text) {
    const url = extractHttpUrlFromUserField(text);
    if (/^https?:\/\//i.test(url) && url === text.trim()) {
      blocks.push("🔗 <b>لینک اختصاصی فعال‌سازی:</b>", url);
    } else {
      blocks.push(escapeHtml(text));
    }
  }

  if (blocks.length === 0) {
    blocks.push(...collectDeliveryStringValuesOnly(delivery));
  }

  return blocks.filter(Boolean).join("\n\n");
}

function collectDeliveryStringValuesOnly(node: unknown, depth = 0): string[] {
  if (depth > 8) return [];
  if (typeof node === "string" && isNonEmptyString(node)) {
    const t = node.trim();
    if (/^https?:\/\//i.test(t) || t.length >= 4) {
      const url = extractHttpUrlFromUserField(t);
      if (/^https?:\/\//i.test(url)) {
        return ["🔗 <b>لینک اختصاصی فعال‌سازی:</b>", url];
      }
      return [escapeHtml(t)];
    }
    return [];
  }
  if (Array.isArray(node)) {
    return node.flatMap((item) => collectDeliveryStringValuesOnly(item, depth + 1));
  }
  const rec = asRecord(node);
  if (!rec) return [];
  return Object.values(rec).flatMap((v) => collectDeliveryStringValuesOnly(v, depth + 1));
}

export function extractCanbosoDeliveryRecord(body: unknown): Record<string, unknown> | null {
  const root = asRecord(body);
  if (!root) {
    if (typeof body === "string") {
      try {
        return extractCanbosoDeliveryRecord(JSON.parse(body) as unknown);
      } catch {
        return null;
      }
    }
    return null;
  }

  const data = asRecord(root.data);
  const delivery =
    asRecord(root.delivery) ??
    asRecord(data?.delivery) ??
    (root.delivery && typeof root.delivery === "object" ? asRecord(root.delivery) : null);

  if (delivery) return delivery;

  if (root.contentHtml && typeof root.contentHtml === "string") {
    return null;
  }

  if (root.accounts || root.codes || root.text) {
    return root;
  }

  return null;
}

/** Sanitized HTML fragment for VIP template (never includes payment/order). */
export function formatCanbosoDeliveryContentHtml(bodyOrStored: unknown): string {
  if (typeof bodyOrStored === "string") {
    try {
      const parsed: unknown = JSON.parse(bodyOrStored);
      const wrapped = asRecord(parsed);
      if (wrapped?.contentHtml && typeof wrapped.contentHtml === "string") {
        return wrapped.contentHtml;
      }
      return formatCanbosoDeliveryContentHtml(parsed);
    } catch {
      return formatPlainCanbosoFallback(bodyOrStored);
    }
  }

  const delivery = extractCanbosoDeliveryRecord(bodyOrStored);
  if (delivery) {
    const html = formatCanbosoDeliveryNode(delivery);
    if (html.trim()) {
      assertCustomerDeliveryMessageSafe(html);
      return html;
    }
  }

  const root = asRecord(bodyOrStored);
  const legacyText = pickString(root?.credentials, root?.text, root?.message);
  if (legacyText) {
    return formatPlainCanbosoFallback(legacyText);
  }

  return "⚠️ اطلاعات تحویل در دسترس نیست. لطفاً با پشتیبانی تماس بگیرید.";
}

function formatPlainCanbosoFallback(text: string): string {
  const trimmed = text.trim();
  if (/^https?:\/\//i.test(trimmed) || /\[.*\]\(https?:\/\//i.test(trimmed)) {
    const url = extractHttpUrlFromUserField(trimmed);
    const html = ["🔗 <b>لینک اختصاصی فعال‌سازی:</b>", url].join("\n");
    assertCustomerDeliveryMessageSafe(html);
    return html;
  }
  const html = escapeHtml(trimmed);
  assertCustomerDeliveryMessageSafe(html);
  return html;
}

export function serializeCanbosoDeliveryPayload(body: unknown): string {
  const contentHtml = formatCanbosoDeliveryContentHtml(body);
  assertCustomerDeliveryMessageSafe(contentHtml);
  return JSON.stringify({ version: 1, contentHtml });
}

export function resolveStoredCanbosoDeliveryHtml(deliveryPayload: string): string {
  return formatCanbosoDeliveryContentHtml(deliveryPayload);
}
