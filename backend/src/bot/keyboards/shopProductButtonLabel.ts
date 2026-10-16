import { isolateEmbeddedLatin } from "../../lib/telegramLabel";
import { extractStarCount, isStarsCatalog } from "../../services/catalog/starsPricingService";
import { normalizeDurationPhrases } from "../../services/catalog/productTitlePolish";
import {
  formatShopProductButtonWithPrice,
  TELEGRAM_INLINE_PRODUCT_LABEL_TARGET,
} from "./shopNavButtonLabel";

const ASCII_TO_PERSIAN_DIGIT = "۰۱۲۳۴۵۶۷۸۹";
const DURATION_RE =
  /(?:[\d۰-۹]{1,4}\s*(?:ماهه?|ساله?|روزه?)|(?:یک|دو|سه|چهار|پنج|شش|هفت|ده|یازده|دوازده)\s*(?:ماهه?|ساله?|روزه?|ماه|سال|روز)|\b\d+\s*(?:mo|month|months|yr|year|years|day|days)\b)/giu;

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

function stripShopButtonFiller(name: string): string {
  return name
    .replace(/\([^)]*(?:گارانتی|guarantee|warranty|بازخرید)[^)]*\)/gi, " ")
    .replace(/(?:با\s*)?گارانتی\s*کامل/gi, " ")
    .replace(/^[🔥⚡✨⭐🎟🎫\s]+/u, "")
    .replace(/^لینک\s*-\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDurationToken(token: string): string {
  let t = normalizeDurationPhrases(token.replace(/\s+/g, " ").trim());
  t = t.replace(/\b(\d+)\s*month(s)?\b/i, (_, n) => `${toPersianDigits(n)} ماهه`);
  t = t.replace(/\b(\d+)\s*year(s)?\b/i, (_, n) => `${toPersianDigits(n)} ساله`);
  t = t.replace(/\b(\d+)\s*day(s)?\b/i, (_, n) => `${toPersianDigits(n)} روزه`);
  return t;
}

/** Duration token for shop buttons — never dropped when composing labels. Uses the last clear duration in the name. */
export function extractShopProductDuration(name: string): string | null {
  const normalized = normalizeDurationPhrases(stripPriceFromName(name));
  const matches = [...normalized.matchAll(DURATION_RE)];
  if (matches.length === 0) return null;

  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const raw = matches[i]![0]!;
    const idx = matches[i]!.index ?? 0;
    const before = normalized.slice(Math.max(0, idx - 12), idx);
    if (/veo\s*$/i.test(before) && /^\d+\s*م/i.test(raw)) continue;
    if (/x$/i.test(before.trim()) && /^\d+\s*م/i.test(raw)) continue;
    if (/\d-\d*$/.test(before)) continue;
    return normalizeDurationToken(raw);
  }

  return normalizeDurationToken(matches[matches.length - 1]![0]!);
}

function stripDurationFromCore(core: string, duration: string | null): string {
  if (!duration) return core;
  const idx = core.lastIndexOf(duration);
  if (idx >= 0) {
    return `${core.slice(0, idx)} ${core.slice(idx + duration.length)}`.replace(/\s+/g, " ").trim();
  }
  const loose = duration.replace(/ه$/u, "");
  if (loose !== duration && core.includes(loose)) {
    const i2 = core.lastIndexOf(loose);
    return `${core.slice(0, i2)} ${core.slice(i2 + loose.length)}`.replace(/\s+/g, " ").trim();
  }
  return core;
}

/** Short brand/plan title (duration handled separately). */
export function buildShopProductTitlePart(rawName: string): string {
  let core = stripShopButtonFiller(
    stripPriceFromName(rawName.replace(/[🎟🎫⭐]/g, "").replace(/^حساب\s+/u, "").trim()),
  );
  if (!core) return rawName.trim();

  const starCount = extractStarCount(core);
  if (starCount != null && isStarsCatalog(core)) {
    return `${toPersianDigits(starCount)} استارز`;
  }

  const duration = extractShopProductDuration(core);
  core = stripDurationFromCore(core, duration);
  core = core.replace(/\s*اعتبار\s*$/i, "").replace(/\s+/g, " ").trim();

  if (/^تلگرام\s+(?:پریمیوم|پریموم|پرمیوم)/i.test(core) || /^پریمیوم/i.test(core)) {
    return "پریمیوم";
  }

  if (/coursera|کورسرا/i.test(core)) {
    return /coursera/i.test(core) ? "Coursera" : "کورسرا";
  }

  if (/freepik|فری\s*پیک|فری‌پیک/i.test(core)) {
    return "FreePik";
  }

  if (/fam\s*veo|veo\s*3/i.test(core)) {
    const m = core.match(/(?:مدیر\s*کامل\s*)?FAM\s*VEO\s*3(?:\s*x\s*\d+)?/i);
    if (m) return m[0].replace(/\s+/g, " ").trim();
  }

  if (/kling/i.test(core)) {
    const m = core.match(/KLING\s*[\d۰-۹-]+/i);
    if (m) return `${m[0].replace(/\s+/g, " ").trim()} کره`.trim();
  }

  if (/^تلگرام\s+/i.test(core)) {
    return core.replace(/^تلگرام\s+/i, "").trim();
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
  const maxVisible = options?.maxVisible ?? TELEGRAM_INLINE_PRODUCT_LABEL_TARGET;
  const duration = extractShopProductDuration(rawName);
  let titlePart = buildShopProductTitlePart(rawName);

  if (/[a-zA-Z]/i.test(titlePart)) {
    titlePart = isolateEmbeddedLatin(titlePart);
  }

  return formatShopProductButtonWithPrice(titlePart, formattedPrice, maxVisible, duration);
}
