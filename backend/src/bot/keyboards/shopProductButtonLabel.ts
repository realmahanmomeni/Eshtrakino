import {
  isolateEmbeddedLatin,
  truncateInlineButtonLabel,
} from "../../lib/telegramLabel";
import { shortenSupplierProductName } from "../../services/catalog/shortenSupplierProductName";

const LONG_NAME_THRESHOLD = 28;
const TELEGRAM_INLINE_MAX = 64;

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
  options?: { maxNameLen?: number; maxTotalLen?: number },
): string {
  const maxNameLen = options?.maxNameLen ?? 32;
  const maxTotalLen = options?.maxTotalLen ?? TELEGRAM_INLINE_MAX;
  const core = stripPriceFromName(
    rawName.replace(/[🎟🎫⭐]/g, "").replace(/^حساب\s+/u, "").trim(),
  );
  if (!core) return truncateInlineButtonLabel(rawName.trim(), maxTotalLen);

  const shortCore =
    core.length > LONG_NAME_THRESHOLD
      ? shortenSupplierProductName(core, { maxLen: maxNameLen })
      : core;

  const namePart = isolateEmbeddedLatin(shortCore);
  const withPrice = formattedPrice?.trim()
    ? `${namePart} · ${formattedPrice.trim()}`
    : namePart;

  return truncateInlineButtonLabel(withPrice, maxTotalLen);
}
