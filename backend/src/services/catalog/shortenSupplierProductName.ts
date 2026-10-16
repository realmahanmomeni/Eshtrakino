import {
  isolateEmbeddedLatin,
  truncateInlineButtonLabel,
} from "../../lib/telegramLabel";
import { normalizeArabicToPersianCharsPreservingLatin } from "../../lib/latinText";
import { normalizeDurationPhrases, stripTitleGarbage } from "./productTitlePolish";

const EMOJI_RE = /\p{Extended_Pictographic}/gu;

const GUARANTEE_PAREN_RE =
  /\(\s*[^)]*(?:گارانتی|guarantee|warranty|بازخرید)[^)]*\)/gi;
const GUARANTEE_BRACKET_RE =
  /\[\s*[^\]]*(?:گارانتی|guarantee|warranty)[^\]]*\]/gi;

function stripEmoji(text: string): string {
  return text.replace(EMOJI_RE, "").replace(/\s+/g, " ").trim();
}

function extractDurationHint(text: string): string | null {
  const normalized = normalizeDurationPhrases(text);
  const m =
    normalized.match(
      /[\d۰-۹]{1,4}\s*(?:ماهه?|ساله?|روزه?|ماه|سال|روز)/,
    ) ??
    normalized.match(
      /(?:یک|دو|سه|چهار|پنج|شش|هفت|ده|یازده|دوازده)\s*(?:ماهه?|ساله?|روزه?|ماه|سال|روز)/,
    ) ??
    normalized.match(/\b\d+\s*(?:mo|month|yr|year|day)s?\b/i);
  return m ? m[0].replace(/\s+/g, " ").trim() : null;
}

function extractQuantityHint(text: string): string | null {
  const normalized = normalizeDurationPhrases(text);
  const credit =
    normalized.match(
      /(?:\+?\s*)?(?:[\d۰-۹]+)\s*(?:هزار|میلیون|میلیارد)\s*(?:اعتبار|توکن|credit|token)?/i,
    ) ??
    normalized.match(
      /(?:[\d۰-۹]+)\s*(?:هزار|میلیون|میلیارد)\s*(?:توکن|token|اعتبار)/i,
    );
  if (credit) return credit[0].replace(/\s+/g, " ").trim();

  const apiCredits = normalized.match(/\b(?:API\s*)?(?:[\d۰-۹]+)\s*(?:اعتبار|credit)/i);
  if (apiCredits) return apiCredits[0].replace(/\s+/g, " ").trim();

  return null;
}

function extractPlanTier(blob: string): string | null {
  const tiers: Array<[RegExp, string]> = [
    [/\bultra\b/i, "Ultra"],
    [/\bsuper\b|سوپر/i, "Super"],
    [/\bpro\s*max\b/i, "Pro Max"],
    [/\bpro\b/i, "Pro"],
    [/\bplus\b/i, "Plus"],
    [/\bmax\b/i, "Max"],
    [/magnific/i, "magnific"],
    [/پریمیوم|premium/i, "پریمیوم"],
  ];
  for (const [re, label] of tiers) {
    if (re.test(blob)) return label;
  }
  return null;
}

function detectLatinBrand(blob: string): string | null {
  const patterns: Array<[RegExp, string]> = [
    [/freepik(?:\s*\(\s*magnific\s*\))?/i, "FreePik"],
    [/muse\s*ai/i, "Muse AI"],
    [/quilbot/i, "Quilbot"],
    [/cursor/i, "Cursor"],
    [/runway(?:\s*max)?/i, "Runway"],
    [/\bgrok\b/i, "GROK"],
    [/adobe|ادوبی/i, "Adobe"],
    [/express|اکسپرس/i, "Express"],
    [/coursera/i, "Coursera"],
  ];
  for (const [re, label] of patterns) {
    if (re.test(blob)) return label;
  }
  return null;
}

function linkedInShortName(blob: string): string | null {
  const duration = extractDurationHint(blob) ?? "۱ ماهه";
  if (/sales\s*navigator|سیلز\s*نا/i.test(blob)) {
    return `سیلز ناویگیتور ${duration}`;
  }
  if (/career|کریر/i.test(blob)) {
    return `لینکدین کریر ${duration}`;
  }
  if (/business|بیزنس/i.test(blob)) {
    return `لینکدین بیزنس ${duration}`;
  }
  if (/job\s*post|کد\s*شغل|شغلی/i.test(blob)) {
    return `لینکدین کد شغلی ${duration}`;
  }
  if (/linkedin|لینکدین/i.test(blob)) {
    return `لینکدین ${duration}`;
  }
  return null;
}

function brandPrefixFromName(brandName: string | null | undefined): string | null {
  const brand = brandName?.trim();
  if (!brand || brand.length < 2) return null;
  const beforeSep = brand.split(/[|—–\-]/)[0]?.trim();
  const core = (beforeSep && beforeSep.length >= 2 ? beforeSep : brand).slice(0, 24);
  return normalizeArabicToPersianCharsPreservingLatin(core);
}

function hasUnbalancedParens(text: string): boolean {
  let depth = 0;
  for (const ch of text) {
    if (ch === "(" || ch === "（") depth += 1;
    if (ch === ")" || ch === "）") depth -= 1;
    if (depth < 0) return true;
  }
  return depth !== 0;
}

const TIER_RE = /ultra|super|pro|plus|max|سوپر|پرو|اولترا|magnific|پریمیوم|premium/i;

export function isLossyShortening(original: string, short: string): boolean {
  if (hasUnbalancedParens(short)) return true;
  if (TIER_RE.test(original) && !TIER_RE.test(short)) return true;
  const durOrig = extractDurationHint(original);
  const durShort = extractDurationHint(short);
  if (durOrig && !durShort) return true;
  if (durOrig && durShort && durOrig.length > durShort.length + 2) return true;
  if (
    /(?:و\s*(?:[\d۰-۹]+|ده|یازده|دوازده)\s*روز)/i.test(original) &&
    !/(?:و\s*(?:[\d۰-۹]+|ده|یازده|دوازده)\s*روز)/i.test(short)
  ) {
    return true;
  }
  if (/[\d۰-۹]+\s*م(?:\s|$)/u.test(short) && !/[\d۰-۹]+\s*ماه/u.test(short)) return true;
  if (/\(\s*[^)]*$/.test(short)) return true;
  return false;
}

function composeShortName(parts: Array<string | null | undefined>, maxLen: number): string {
  const joined = parts
    .filter((p): p is string => Boolean(p?.trim()))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const withBidi = isolateEmbeddedLatin(joined);
  return truncateInlineButtonLabel(withBidi, maxLen);
}

function buildFromParts(
  rawCleaned: string,
  parts: Array<string | null | undefined>,
  maxLen: number,
): string {
  const short = composeShortName(parts, maxLen);
  if (isLossyShortening(rawCleaned, short)) {
    return composeShortName([rawCleaned], maxLen);
  }
  return short;
}

/**
 * Short Telegram-friendly product title (≈32 chars): brand + plan + duration.
 * Full supplier title should remain in the product description.
 */
export function shortenSupplierProductName(
  rawName: string,
  options?: {
    brandName?: string | null;
    maxLen?: number;
    keepWarranty?: boolean;
    durationHintFrom?: string | null;
  },
): string {
  const maxLen = options?.maxLen ?? 32;
  const raw = rawName.trim();
  if (!raw) return raw;

  let blob = stripEmoji(stripTitleGarbage(raw));
  if (!options?.keepWarranty) {
    blob = blob.replace(GUARANTEE_PAREN_RE, " ").replace(GUARANTEE_BRACKET_RE, " ");
  }
  blob = normalizeArabicToPersianCharsPreservingLatin(normalizeDurationPhrases(blob))
    .replace(/\s+/g, " ")
    .trim();

  const durationHintSource = options?.durationHintFrom?.trim() || blob;
  const durationFromHint = extractDurationHint(durationHintSource);
  const linkedIn = linkedInShortName(`${options?.brandName ?? ""} ${blob}`);
  if (linkedIn) {
    let label = linkedIn;
    if (durationFromHint) {
      const dInLabel = extractDurationHint(label);
      if (dInLabel) label = label.replace(dInLabel, durationFromHint);
      else label = `${label} ${durationFromHint}`.trim();
    }
    return composeShortName([label], maxLen);
  }

  const latinBrand = detectLatinBrand(blob) ?? detectLatinBrand(options?.brandName ?? "");
  const duration = durationFromHint ?? extractDurationHint(blob);
  const quantity = extractQuantityHint(blob);
  const plan = extractPlanTier(blob);

  if (/adobe|ادوبی/i.test(blob) && /express|اکسپرس/i.test(blob)) {
    const persianBrand = /ادوبی/.test(blob) ? "ادوبی اکسپرس" : "Adobe Express";
    return buildFromParts(blob, [persianBrand, duration], maxLen);
  }

  if (latinBrand) {
    if (/grok/i.test(latinBrand)) {
      return buildFromParts(blob, [latinBrand, plan ?? "Super", duration], maxLen);
    }
    if (/muse\s*ai/i.test(latinBrand) || /muse/i.test(blob)) {
      const qty =
        quantity ??
        (/\b۱\s*میلیارد\b/.test(blob) ? "۱ میلیارد توکن" : null);
      return buildFromParts(blob, [latinBrand, qty ?? plan, duration], maxLen);
    }
    if (/freepik/i.test(latinBrand)) {
      return buildFromParts(blob, [latinBrand, plan, quantity, duration], maxLen);
    }
    if (/cursor/i.test(latinBrand)) {
      const cursorQty = quantity ?? (/\b400\b/.test(blob) ? "۴۰۰ اعتبار" : null);
      return buildFromParts(blob, [latinBrand, plan, cursorQty, duration], maxLen);
    }
    if (/runway/i.test(latinBrand)) {
      return buildFromParts(blob, [latinBrand, plan, quantity, duration], maxLen);
    }
    if (/quilbot/i.test(latinBrand)) {
      return buildFromParts(blob, [latinBrand, plan ?? "پریمیوم", duration], maxLen);
    }
    return buildFromParts(blob, [latinBrand, plan, quantity, duration], maxLen);
  }

  const brandPrefix = brandPrefixFromName(options?.brandName);

  let candidate = blob;
  if (brandPrefix && !blob.toLowerCase().includes(brandPrefix.toLowerCase().slice(0, 4))) {
    candidate = duration ? `${brandPrefix} ${duration}` : brandPrefix;
  } else if (duration && !blob.includes(duration)) {
    candidate = `${blob.split(/\s+/).slice(0, 4).join(" ")} ${duration}`.trim();
  } else {
    candidate = blob;
  }

  candidate = candidate.replace(/\s+/g, " ").trim();
  if (!candidate) candidate = raw;

  return buildFromParts(blob, [candidate], maxLen);
}
