const MAX_MARGIN_PERCENT = 1000;

export type ParsedMarginResult =
  | { ok: true; value: number }
  | { ok: false; errorMessage: string };

export function parseProfitMarginPercentInput(raw: string): ParsedMarginResult {
  const normalized = raw
    .trim()
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/,/g, ".");

  if (!normalized) {
    return { ok: false, errorMessage: "⚠️ لطفاً درصد سود را وارد کنید." };
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) {
    return { ok: false, errorMessage: "⚠️ عدد نامعتبر است. فقط عدد (مثلاً 20 یا 12.5) وارد کنید." };
  }
  if (value <= 0) {
    return { ok: false, errorMessage: "⚠️ درصد سود باید بزرگ‌تر از صفر باشد." };
  }
  if (value > MAX_MARGIN_PERCENT) {
    return {
      ok: false,
      errorMessage: `⚠️ درصد سود نباید بیشتر از ${MAX_MARGIN_PERCENT} باشد.`,
    };
  }

  const rounded = Math.round(value * 100) / 100;
  return { ok: true, value: rounded };
}
