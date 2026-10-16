import { isolateEmbeddedLatin } from "../../lib/telegramLabel";
import { shortenSupplierProductName } from "../../services/catalog/shortenSupplierProductName";
import {
  formatShopProductButtonWithPrice,
  TELEGRAM_INLINE_VISIBLE_MAX,
} from "./shopNavButtonLabel";

const LONG_NAME_THRESHOLD = 28;

function stripPriceFromName(name: string): string {
  return name
    .replace(/\s*[-—–]\s*[\d,۰-۹٠-٩]+\s*(?:تومان|toman)\b/gi, "")
    .replace(/\s*\([\d,۰-۹٠-٩]+\s*(?:تومان|toman)\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Render-time shop inline label: short readable name + optional price, with bidi-safe Latin tokens.
 */
export function formatShopProductInlineLabel(
  rawName: string,
  formattedPrice?: string,
  options?: { maxNameLen?: number; maxVisible?: number },
): string {
  const maxNameLen = options?.maxNameLen ?? 32;
  const maxVisible = options?.maxVisible ?? TELEGRAM_INLINE_VISIBLE_MAX;
  const core = stripPriceFromName(
    rawName.replace(/[🎟🎫⭐]/g, "").replace(/^حساب\s+/u, "").trim(),
  );
  if (!core) {
    return formatShopProductButtonWithPrice(rawName.trim(), formattedPrice, maxVisible);
  }

  const shortCore =
    core.length > LONG_NAME_THRESHOLD
      ? shortenSupplierProductName(core, { maxLen: maxNameLen })
      : core;

  const namePart = isolateEmbeddedLatin(shortCore);
  return formatShopProductButtonWithPrice(namePart, formattedPrice, maxVisible);
}
