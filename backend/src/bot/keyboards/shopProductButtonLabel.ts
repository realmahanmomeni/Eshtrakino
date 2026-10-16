import { isolateEmbeddedLatin } from "../../lib/telegramLabel";
import { extractStarCount, isStarsCatalog } from "../../services/catalog/starsPricingService";
import { normalizeDurationPhrases } from "../../services/catalog/productTitlePolish";
import {
  formatShopProductButtonWithPrice,
  TELEGRAM_INLINE_VISIBLE_MAX,
} from "./shopNavButtonLabel";

const ASCII_TO_PERSIAN_DIGIT = "۰۱۲۳۴۵۶۷۸۹";

function toPersianDigits(value: number | string): string {
  return String(value).replace(/\d/g, (d) => ASCII_TO_PERSIAN_DIGIT[Number(d)] ?? d);
}

function stripPriceFromName(name: string): string {
  return name
    .replace(/\s*[-—–]\s*[\d,۰-۹٠-٩]+\s*(?:تومان|toman)\b/gi, "")
    .replace(/\s*\([\d,۰-۹٠-٩]+\s*(?:toman|تومان)\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Duration token for shop buttons — never dropped when composing labels. */
export function extractShopProductDuration(name: string): string | null {
  const normalized = normalizeDurationPhrases(stripPriceFromName(name));
  const m =
    normalized.match(/[\d۰-۹]{1,4}\s*(?:ماهه?|ساله?|روزه?)/u) ??
    normalized.match(
      /(?:یک|دو|سه|چهار|پنج|شش|هفت|ده|یازده|دوازده)\s*(?:ماهه?|ساله?|روزه?|ماه|سال|روز)/u,
    ) ??
    normalized.match(/\b\d+\s*(?:mo|month|months|yr|year|years|day|days)\b/i);
  if (!m) return null;
  let token = m[0].replace(/\s+/g, " ").trim();
  token = token.replace(/\b(\d+)\s*month(s)?\b/i, (_, n) => `${toPersianDigits(n)} ماهه`);
  token = token.replace(/\b(\d+)\s*year(s)?\b/i, (_, n) => `${toPersianDigits(n)} ساله`);
  return token;
}

function stripDurationFromCore(core: string, duration: string | null): string {
  if (!duration) return core;
  let rest = core.replace(duration, " ").replace(/\s+/g, " ").trim();
  rest = normalizeDurationPhrases(rest);
  return rest;
}

/** Short brand/plan title (duration handled separately). */
export function buildShopProductTitlePart(rawName: string): string {
  let core = stripPriceFromName(
    rawName.replace(/[🎟🎫⭐]/g, "").replace(/^حساب\s+/u, "").trim(),
  );
  if (!core) return rawName.trim();

  const starCount = extractStarCount(core);
  if (starCount != null && isStarsCatalog(core)) {
    return `${toPersianDigits(starCount)} استارز`;
  }

  const duration = extractShopProductDuration(core);
  core = stripDurationFromCore(core, duration);

  if (/^تلگرام\s+(?:پریمیوم|پریموم|پرمیوم)/i.test(core) || /^پریمیوم/i.test(core)) {
    return "پریمیوم";
  }

  if (/coursera|کورسرا/i.test(core)) {
    return /coursera/i.test(core) ? "Coursera" : "کورسرا";
  }

  if (/freepik|فری\s*پیک|فری‌پیک/i.test(core)) {
    return "FreePik";
  }

  if (/^تلگرام\s+/i.test(core)) {
    return core.replace(/^تلگرام\s+/i, "").trim();
  }

  core = core
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (core.length > 24) {
    const words = core.split(/\s+/);
    const trimmed = words.slice(0, 4).join(" ");
    return trimmed.length >= 4 ? trimmed : core.slice(0, 24);
  }

  return core || rawName.trim();
}

/** @deprecated Use buildShopProductTitlePart + extractShopProductDuration */
export function buildShopProductDisplayName(rawName: string): string {
  const title = buildShopProductTitlePart(rawName);
  const duration = extractShopProductDuration(rawName);
  if (duration && !title.includes(duration)) {
    return `${title} ${duration}`.trim();
  }
  return title;
}

/**
 * Render-time shop inline label: [title][duration] · price — duration and price are never dropped.
 */
export function formatShopProductInlineLabel(
  rawName: string,
  formattedPrice?: string,
  options?: { maxNameLen?: number; maxVisible?: number },
): string {
  const maxVisible = options?.maxVisible ?? TELEGRAM_INLINE_VISIBLE_MAX;
  const duration = extractShopProductDuration(rawName);
  let titlePart = buildShopProductTitlePart(rawName);

  if (/[a-zA-Z]/i.test(titlePart)) {
    titlePart = isolateEmbeddedLatin(titlePart);
  }

  return formatShopProductButtonWithPrice(titlePart, formattedPrice, maxVisible, duration);
}
