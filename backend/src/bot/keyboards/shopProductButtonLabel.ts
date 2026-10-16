import { isolateEmbeddedLatin } from "../../lib/telegramLabel";
import { extractStarCount, isStarsCatalog } from "../../services/catalog/starsPricingService";
import { shortenSupplierProductName } from "../../services/catalog/shortenSupplierProductName";
import {
  formatShopProductButtonWithPrice,
  TELEGRAM_INLINE_VISIBLE_MAX,
} from "./shopNavButtonLabel";

const LONG_NAME_THRESHOLD = 28;
const ASCII_TO_PERSIAN_DIGIT = "۰۱۲۳۴۵۶۷۸۹";

function toPersianDigits(value: number | string): string {
  return String(value).replace(/\d/g, (d) => ASCII_TO_PERSIAN_DIGIT[Number(d)] ?? d);
}

function stripPriceFromName(name: string): string {
  return name
    .replace(/\s*[-—–]\s*[\d,۰-۹٠-٩]+\s*(?:تومان|toman)\b/gi, "")
    .replace(/\s*\([\d,۰-۹٠-٩]+\s*(?:تومان|toman)\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractDurationSuffix(name: string): string | null {
  const m = name.match(/[\d۰-۹]{1,4}\s*(?:ماهه?|ساله?|روزه?)/);
  return m ? m[0].replace(/\s+/g, " ").trim() : null;
}

/** Build a compact shop button name that keeps brand/plan/duration (drops generic filler). */
export function buildShopProductDisplayName(rawName: string): string {
  let core = stripPriceFromName(
    rawName.replace(/[🎟🎫⭐]/g, "").replace(/^حساب\s+/u, "").trim(),
  );
  if (!core) return rawName.trim();

  const starCount = extractStarCount(core);
  if (starCount != null && isStarsCatalog(core)) {
    return `${toPersianDigits(starCount)} استارز`;
  }

  const duration = extractDurationSuffix(core);

  if (/^تلگرام\s+(?:پریمیوم|پریموم|پرمیوم)/i.test(core) && duration) {
    return `پریمیوم ${duration}`;
  }

  if (/coursera|کورسرا/i.test(core)) {
    const brand = /coursera/i.test(core) ? "Coursera" : "کورسرا";
    const tier = /پرمیوم|پریمیوم|premium|nw/i.test(core) ? "پرمیوم" : "";
    return [brand, tier, duration].filter(Boolean).join(" ").trim();
  }

  if (/^تلگرام\s+/i.test(core) && duration) {
    return core.replace(/^تلگرام\s+/i, "").trim();
  }

  if (core.length > LONG_NAME_THRESHOLD) {
    return shortenSupplierProductName(core, { maxLen: 32 });
  }

  if (duration && !core.includes(duration)) {
    return `${core} ${duration}`.trim();
  }

  return core;
}

/**
 * Render-time shop inline label: short readable name + optional price, with bidi-safe Latin tokens.
 */
export function formatShopProductInlineLabel(
  rawName: string,
  formattedPrice?: string,
  options?: { maxNameLen?: number; maxVisible?: number },
): string {
  const maxVisible = options?.maxVisible ?? TELEGRAM_INLINE_VISIBLE_MAX;
  const displayCore = buildShopProductDisplayName(rawName);
  if (!displayCore) {
    return formatShopProductButtonWithPrice(rawName.trim(), formattedPrice, maxVisible);
  }

  const namePart = /[a-zA-Z]/i.test(displayCore)
    ? isolateEmbeddedLatin(displayCore)
    : displayCore;
  return formatShopProductButtonWithPrice(namePart, formattedPrice, maxVisible);
}
