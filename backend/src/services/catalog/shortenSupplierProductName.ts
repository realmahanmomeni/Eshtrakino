import {
  isolateEmbeddedLatin,
  normalizeArabicToPersianChars,
  truncateInlineButtonLabel,
} from "../../lib/telegramLabel";
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
      /(?:۱|۲|۳|۴|۵|۶|۷|۸|۹|۰|\d+)\s*(?:ماهه?|ساله?|روزه?|ماه|سال|روز)/,
    ) ?? normalized.match(/\b\d+\s*(?:mo|month|yr|year|day)s?\b/i);
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

function detectLatinBrand(blob: string): string | null {
  const patterns: Array<[RegExp, string]> = [
    [/freepik(?:\s*\(\s*magnific\s*\))?/i, "FreePik"],
    [/muse\s*ai/i, "Muse AI"],
    [/quilbot/i, "Quilbot"],
    [/cursor(?:\s*pro)?/i, "Cursor"],
    [/runway(?:\s*max)?/i, "Runway"],
  ];
  for (const [re, label] of patterns) {
    if (re.test(blob)) return label;
  }
  return null;
}

function planKeyword(blob: string): string | null {
  if (/magnific/i.test(blob)) return "magnific";
  if (/پریمیوم|premium/i.test(blob)) return "پریمیوم";
  if (/pro\s*max|max/i.test(blob)) return "Max";
  if (/\bpro\b/i.test(blob)) return "Pro";
  if (/plus/i.test(blob)) return "Plus";
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
  return normalizeArabicToPersianChars(core);
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
  if (linkedIn) return composeShortName([linkedIn], maxLen);

  const latinBrand = detectLatinBrand(blob) ?? detectLatinBrand(options?.brandName ?? "");
  const duration = extractDurationHint(blob);
  const quantity = extractQuantityHint(blob);
  const plan = planKeyword(blob);

  if (latinBrand) {
    if (/muse\s*ai/i.test(latinBrand) || /muse/i.test(blob)) {
      const qty =
        quantity ??
        (/\b۱\s*میلیارد\b/.test(blob) ? "۱ میلیارد توکن" : null);
      return composeShortName([latinBrand, qty ?? plan, duration], maxLen);
    }
    if (/freepik/i.test(latinBrand)) {
      return composeShortName([latinBrand, plan, quantity, duration], maxLen);
    }
    if (/cursor/i.test(latinBrand)) {
      const cursorQty = quantity ?? (/\b400\b/.test(blob) ? "۴۰۰ اعتبار" : null);
      return composeShortName([latinBrand, plan, cursorQty, duration], maxLen);
    }
    if (/runway/i.test(latinBrand)) {
      return composeShortName([latinBrand, plan, quantity, duration], maxLen);
    }
    if (/quilbot/i.test(latinBrand)) {
      return composeShortName([latinBrand, plan ?? "پریمیوم", duration], maxLen);
    }
    return composeShortName([latinBrand, plan, quantity, duration], maxLen);
  }

  const brandPrefix = brandPrefixFromName(options?.brandName);

  let candidate = blob;
  if (brandPrefix && !blob.toLowerCase().includes(brandPrefix.toLowerCase().slice(0, 4))) {
    candidate = duration ? `${brandPrefix} ${duration}` : brandPrefix;
  } else if (duration && !blob.includes(duration)) {
    candidate = `${blob.split(/\s+/).slice(0, 3).join(" ")} ${duration}`.trim();
  }

  candidate = candidate.replace(/\s+/g, " ").trim();
  if (!candidate) candidate = raw;

  return composeShortName([candidate], maxLen);
}
