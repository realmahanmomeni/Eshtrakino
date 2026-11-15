import { InlineKeyboard } from "grammy";

export const QUANTUM_PENDING_REVIEW_CALLBACK = "adm:sup:pending:from:suppliers";

/** How many new product names fit in one later-sync message. */
export const QUANTUM_NOTIFY_NAME_LIMIT = 20;

export type QuantumFolderCount = {
  folder: string;
  count: number;
};

export function quantumPendingReviewKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text(
    "📥 بررسی و تایید محصولات",
    QUANTUM_PENDING_REVIEW_CALLBACK,
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fa(n: number): string {
  return n.toLocaleString("fa-IR");
}

export function countByFolder(
  folders: Array<string | null | undefined>,
): QuantumFolderCount[] {
  const map = new Map<string, number>();
  for (const folder of folders) {
    const key = folder?.trim() ? folder.trim() : "بدون پوشه";
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([folder, count]) => ({ folder, count }))
    .sort((a, b) => b.count - a.count || a.folder.localeCompare(b.folder));
}

/**
 * First Quantum sync, when nothing is mapped yet: one summary, not one
 * message per product.
 */
export function buildQuantumFirstSyncSummary(input: {
  total: number;
  folders: Array<string | null | undefined>;
}): string {
  const counts = countByFolder(input.folders);
  const lines = [
    "📥 <b>همگام‌سازی اول Quantum</b>",
    "",
    `تعداد محصولات جدید در صف تایید: <b>${fa(input.total)}</b>`,
    "",
    "پوشه‌ها:",
  ];
  if (counts.length === 0) {
    lines.push("• موردی نیست");
  } else {
    for (const row of counts) {
      lines.push(`• ${escapeHtml(row.folder)}: <b>${fa(row.count)}</b>`);
    }
  }
  lines.push("", "برای بررسی و انتخاب دسته‌بندی، دکمه زیر را بزنید.");
  return lines.join("\n");
}

export type QuantumBatchItem = {
  name: string;
  folder?: string | null;
};

/** Later syncs: one message listing the new items, truncated when long. */
export function buildQuantumBatchNotice(items: QuantumBatchItem[]): string {
  const shown = items.slice(0, QUANTUM_NOTIFY_NAME_LIMIT);
  const hidden = items.length - shown.length;
  const lines = [
    `📥 <b>محصولات جدید Quantum</b> (${fa(items.length)})`,
    "",
  ];
  for (const item of shown) {
    const folder = item.folder?.trim();
    const suffix = folder ? ` — ${escapeHtml(folder)}` : "";
    lines.push(`• ${escapeHtml(item.name)}${suffix}`);
  }
  if (hidden > 0) {
    lines.push(`و ${fa(hidden)} مورد دیگر`);
  }
  lines.push("", "برای تایید دسته‌بندی، دکمه زیر را بزنید.");
  return lines.join("\n");
}

export function buildQuantumCircuitAlert(reason: string): string {
  return [
    "⛔ <b>اتصال Quantum موقتاً متوقف شد</b>",
    "",
    escapeHtml(reason),
    "",
    "همه درخواست‌های Quantum برای چند دقیقه متوقف هستند تا محدودیت یا کلید باعث مسدود شدن نشود.",
  ].join("\n");
}

export function buildQuantumLowBalanceAlert(): string {
  return "موجودی کیف پول Quantum کم است، ربات کوانتوم را شارژ کنید";
}

export function buildCanbosoLowBalanceAlert(): string {
  return "موجودی کیف پول Canboso کم است، ربات کانبوسو را شارژ کنید";
}
