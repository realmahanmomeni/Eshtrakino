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

/** Shop product list buttons: title + duration only (no price). */
export function formatShopProductListButtonLabel(
  namePart: string,
  maxVisible = TELEGRAM_INLINE_PRODUCT_LABEL_TARGET,
  durationPart?: string | null,
): string {
  const durationSeg = durationPart?.trim() ? ` ${durationPart.trim()}` : "";
  const trimmedName = namePart.trim();
  let combined = `${trimmedName}${durationSeg}`;

  if (combined.length <= maxVisible && combined.length <= 64) {
    return combined;
  }

  const minTitleBudget = 12;
  let nameBudget = Math.max(minTitleBudget, maxVisible - durationSeg.length);
  let shortName = truncateInlineButtonLabel(trimmedName, nameBudget);
  combined = `${shortName}${durationSeg}`;

  while (combined.length > 64 && nameBudget > minTitleBudget) {
    nameBudget -= 2;
    shortName = truncateInlineButtonLabel(trimmedName, nameBudget);
    combined = `${shortName}${durationSeg}`;
  }

  if (combined.length > 64) {
    shortName = truncateInlineButtonLabel(trimmedName, Math.max(minTitleBudget, 64 - durationSeg.length));
    combined = `${shortName}${durationSeg}`;
  }

  return combined.length <= 64 ? combined : `${shortName}${durationSeg}`.slice(0, 64);
}

/** @deprecated List buttons no longer show price; kept for tests that assert price-suffix formatting elsewhere. */
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
