import { normalizeArabicToPersianChars, truncateInlineButtonLabel } from "../../lib/telegramLabel";
import { normalizeDurationPhrases, stripTitleGarbage } from "./productTitlePolish";

const EMOJI_RE = /\p{Extended_Pictographic}/gu;

const GUARANTEE_PAREN_RE =
  /\(\s*[^)]*(?:گارانتی|guarantee|warranty)[^)]*\)/gi;
const GUARANTEE_BRACKET_RE =
  /\[\s*[^\]]*(?:گارانتی|guarantee|warranty)[^\]]*\]/gi;

function stripEmoji(text: string): string {
  return text.replace(EMOJI_RE, "").replace(/\s+/g, " ").trim();
}

function extractDurationHint(text: string): string | null {
  const normalized = normalizeDurationPhrases(text);
  const m =
    normalized.match(
      /(?:۱|۲|۳|۴|۵|۶|۷|۸|۹|۰|\d+)\s*(?:ماهه?|ساله?|روزه?|ماه|سال|روز)/,
    ) ?? normalized.match(/\b\d+\s*(?:mo|month|yr|year|day)s?\b/i);
  return m ? m[0].replace(/\s+/g, " ").trim() : null;
}

function linkedInShortName(blob: string): string | null {
  const duration = extractDurationHint(blob) ?? "۱ ماهه";
  if (/sales\s*navigator|سیلز\s*نا/i.test(blob)) {
    return truncateInlineButtonLabel(`سیلز ناویگیتور ${duration}`, 32);
  }
  if (/career|کریر/i.test(blob)) {
    return truncateInlineButtonLabel(`لینکدین کریر ${duration}`, 32);
  }
  if (/business|بیزنس/i.test(blob)) {
    return truncateInlineButtonLabel(`لینکدین بیزنس ${duration}`, 32);
  }
  if (/job\s*post|کد\s*شغل|شغلی/i.test(blob)) {
    return truncateInlineButtonLabel(`لینکدین کد شغلی ${duration}`, 32);
  }
  if (/linkedin|لینکدین/i.test(blob)) {
    return truncateInlineButtonLabel(`لینکدین ${duration}`, 32);
  }
  return null;
}

function brandPrefixFromName(brandName: string | null | undefined): string | null {
  const brand = brandName?.trim();
  if (!brand || brand.length < 2) return null;
  const beforeSep = brand.split(/[|—–\-]/)[0]?.trim();
  const core = (beforeSep && beforeSep.length >= 2 ? beforeSep : brand).slice(0, 24);
  return normalizeArabicToPersianChars(core);
}

/**
 * Short Telegram-friendly product title (≈32 chars): brand + plan + duration.
 * Full supplier title should remain in the product description.
 */
export function shortenSupplierProductName(
  rawName: string,
  options?: { brandName?: string | null; maxLen?: number },
): string {
  const maxLen = options?.maxLen ?? 32;
  const raw = rawName.trim();
  if (!raw) return raw;

  let blob = stripEmoji(stripTitleGarbage(raw));
  blob = blob.replace(GUARANTEE_PAREN_RE, " ").replace(GUARANTEE_BRACKET_RE, " ");
  blob = normalizeArabicToPersianChars(normalizeDurationPhrases(blob)).replace(/\s+/g, " ").trim();

  const linkedIn = linkedInShortName(`${options?.brandName ?? ""} ${blob}`);
  if (linkedIn) return linkedIn;

  const brandPrefix = brandPrefixFromName(options?.brandName);
  const duration = extractDurationHint(blob);

  let candidate = blob;
  if (brandPrefix && !blob.toLowerCase().includes(brandPrefix.toLowerCase().slice(0, 4))) {
    candidate = duration ? `${brandPrefix} ${duration}` : brandPrefix;
  } else if (duration && !blob.includes(duration)) {
    candidate = `${blob.split(/\s+/).slice(0, 3).join(" ")} ${duration}`.trim();
  }

  candidate = candidate.replace(/\s+/g, " ").trim();
  if (!candidate) candidate = raw;

  return truncateInlineButtonLabel(candidate, maxLen);
}
