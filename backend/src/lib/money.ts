import { Decimal } from "@prisma/client/runtime/library";

/**
 * Format amounts as Iranian Toman with thousand separators.
 * Example: 750000 → "750,000 تومان"
 */
export function formatToman(amount: Decimal | string | number | null | undefined): string {
  const raw = amount == null ? 0 : amount;
  const n = Math.round(Number(new Decimal(raw).toFixed(0)));
  if (!Number.isFinite(n)) return `0 تومان`;
  return `${n.toLocaleString("en-US")} تومان`;
}

/**
 * Parse user-entered prices: strips commas/spaces, accepts integers.
 * Returns null if invalid.
 */
export function parsePrice(raw: string): number | null {
  const cleaned = raw
    .trim()
    .replace(/[,\u060C\u066C\s]/g, "") // commas (EN/AR) + spaces
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))) // Persian digits
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))); // Arabic-Indic

  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

/**
 * Parse signed amounts for admin balance adjustments.
 * Positive adds, negative deducts. Example: "50000" | "-10000"
 */
export function parseSignedAmount(raw: string): number | null {
  const cleaned = raw
    .trim()
    .replace(/[,\u060C\u066C\s]/g, "")
    .replace(/[−–—]/g, "-")
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));

  if (!cleaned || cleaned === "-" || cleaned === "+") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n === 0) return null;
  return Math.round(n);
}

export function parseRequiredFields(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map(String).map((s) => s.trim()).filter(Boolean);
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parseRequiredFields(parsed);
    } catch {
      return [];
    }
  }
  return [];
}

export function parseUserInputData(raw: unknown): Record<string, string> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      out[k] = String(v ?? "");
    }
    return out;
  }
  if (typeof raw === "string") {
    try {
      return parseUserInputData(JSON.parse(raw));
    } catch {
      return {};
    }
  }
  return {};
}
