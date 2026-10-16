import { truncateInlineButtonLabel } from "../../lib/telegramLabel";

/** Telegram inline buttons ~30 visible chars — truncate name, keep price suffix intact. */
export const TELEGRAM_INLINE_VISIBLE_MAX = 30;

export function formatShopNavButtonLabel(raw: string, maxVisible = TELEGRAM_INLINE_VISIBLE_MAX): string {
  const trimmed = raw.trim();
  if (trimmed.length <= maxVisible) return trimmed;

  if (trimmed.includes("|")) {
    const first = trimmed.split("|")[0]!.trim();
    if (first.length > 0 && first.length <= maxVisible) {
      return first;
    }
    if (first.length > maxVisible) {
      return truncateInlineButtonLabel(first, maxVisible);
    }
  }

  return truncateInlineButtonLabel(trimmed, maxVisible);
}

export function formatShopProductButtonWithPrice(
  namePart: string,
  formattedPrice?: string,
  maxVisible = TELEGRAM_INLINE_VISIBLE_MAX,
): string {
  const priceSuffix = formattedPrice?.trim() ? ` · ${formattedPrice.trim()}` : "";
  const nameBudget = Math.max(8, maxVisible - priceSuffix.length);
  const shortName = truncateInlineButtonLabel(namePart.trim(), nameBudget);
  const combined = `${shortName}${priceSuffix}`;
  if (combined.length <= 64) return combined;
  return truncateInlineButtonLabel(combined, 64);
}
