import { truncateInlineButtonLabel } from "../../lib/telegramLabel";

/** Telegram inline buttons ~30 visible chars — truncate name, keep duration + price suffix intact. */
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
  durationPart?: string | null,
): string {
  const durationSeg = durationPart?.trim() ? ` ${durationPart.trim()}` : "";
  const priceSuffix = formattedPrice?.trim() ? ` · ${formattedPrice.trim()}` : "";
  const fixedTail = `${durationSeg}${priceSuffix}`;

  let nameBudget = Math.max(4, maxVisible - fixedTail.length);
  let shortName = truncateInlineButtonLabel(namePart.trim(), nameBudget);
  let combined = `${shortName}${fixedTail}`;

  while (combined.length > 64 && nameBudget > 4) {
    nameBudget -= 2;
    shortName = truncateInlineButtonLabel(namePart.trim(), nameBudget);
    combined = `${shortName}${fixedTail}`;
  }

  if (combined.length > 64 && fixedTail.length < 64) {
    shortName = truncateInlineButtonLabel(namePart.trim(), Math.max(3, 64 - fixedTail.length));
    combined = `${shortName}${fixedTail}`;
  }

  if (combined.length <= 64) return combined;

  if (priceSuffix && combined.length > 64) {
    const tb = Math.max(3, 64 - fixedTail.length);
    return `${truncateInlineButtonLabel(namePart.trim(), tb)}${fixedTail}`;
  }

  return truncateInlineButtonLabel(combined, 64);
}
