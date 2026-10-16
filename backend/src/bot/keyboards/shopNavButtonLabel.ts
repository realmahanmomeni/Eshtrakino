import { truncateInlineButtonLabel } from "../../lib/telegramLabel";

/** Category/subcategory nav buttons — shorter visible target. */
export const TELEGRAM_INLINE_VISIBLE_MAX = 30;

/** Product buttons: Telegram allows 64 chars; aim for readable labels before client-side clip. */
export const TELEGRAM_INLINE_PRODUCT_LABEL_TARGET = 50;

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
  maxVisible = TELEGRAM_INLINE_PRODUCT_LABEL_TARGET,
  durationPart?: string | null,
): string {
  const durationSeg = durationPart?.trim() ? ` ${durationPart.trim()}` : "";
  const priceSuffix = formattedPrice?.trim() ? ` · ${formattedPrice.trim()}` : "";
  const fixedTail = `${durationSeg}${priceSuffix}`;

  const minTitleBudget = 12;
  let nameBudget = Math.max(minTitleBudget, maxVisible - fixedTail.length);
  let shortName = truncateInlineButtonLabel(namePart.trim(), nameBudget);
  let combined = `${shortName}${fixedTail}`;

  while (combined.length > 64 && nameBudget > minTitleBudget) {
    nameBudget -= 2;
    shortName = truncateInlineButtonLabel(namePart.trim(), nameBudget);
    combined = `${shortName}${fixedTail}`;
  }

  if (combined.length > 64) {
    shortName = truncateInlineButtonLabel(
      namePart.trim(),
      Math.max(minTitleBudget, 64 - fixedTail.length),
    );
    combined = `${shortName}${fixedTail}`;
  }

  if (priceSuffix && !combined.includes(priceSuffix.trim())) {
    combined = `${truncateInlineButtonLabel(namePart.trim(), Math.max(8, 64 - fixedTail.length))}${fixedTail}`;
  }

  return combined.length <= 64 ? combined : `${shortName}${fixedTail}`.slice(0, 64);
}
