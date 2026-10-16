import { isLossyShortening } from "./shortenSupplierProductName";
import { normalizeDurationPhrases } from "./productTitlePolish";
import {
  namesAreEquivalentForSync,
  normalizeNameForSyncComparison,
} from "./supplierNameSyncCompare";

const PLAN_TIER_WORDS = ["ultra", "super", "pro", "max", "plus", "api", "magnific"] as const;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const ALNUM_TOKEN_RE = /\b(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{2,}\b/g;
const DURATION_SURFACE_RE =
  /[\d۰-۹]{1,4}\s*(?:ماهه?|ساله?|روزه?)|(?:یک|دو|سه|چهار|پنج|شش|هفت|ده|یازده|دوازده)\s*(?:ماهه?|ساله?|روزه?|ماه|سال|روز)|\b\d+\s*(?:mo|month|months|day|days|yr|year|years)\b/giu;

function tokenize(text: string): Set<string> {
  const normalized = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = normalized.split(" ").filter((t) => t.length >= 2);
  return new Set(tokens);
}

function overlapRatio(a: Set<string>, b: Set<string>): number {
  if (b.size === 0) return 0;
  let hit = 0;
  for (const t of b) {
    if (a.has(t)) hit += 1;
  }
  return hit / b.size;
}

function isPredominantlyPersian(text: string): boolean {
  const persian = (text.match(/[\u0600-\u06FF]/g) ?? []).length;
  const latin = (text.match(/[a-zA-Z]/g) ?? []).length;
  return persian >= 4 && persian > latin;
}

function hasBrandMismatch(current: string, proposed: string): boolean {
  const pairs: Array<[RegExp, RegExp]> = [
    [/outlook|اوت\s*لوک|اوت‌لوک/i, /adobe/i],
    [/filmora|فیلمورا/i, /fil\s*mora|دارایی/i],
    [/prime\s*video|پرایم\s*ویدیو/i, /پریم\s*ویدیو\s*6\s*م/i],
  ];
  for (const [curRe, badPropRe] of pairs) {
    if (curRe.test(current) && badPropRe.test(proposed) && !curRe.test(proposed)) {
      return true;
    }
  }
  if (/api/i.test(current) && !/api/i.test(proposed) && /cursor/i.test(proposed)) {
    return true;
  }
  return false;
}

function normalizeDigitChar(ch: string): string {
  const persian = "۰۱۲۳۴۵۶۷۸۹".indexOf(ch);
  if (persian >= 0) return String(persian);
  const arabic = "٠١٢٣٤٥٦٧٨٩".indexOf(ch);
  if (arabic >= 0) return String(arabic);
  return ch;
}

function significantNumbers(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/[\d۰-۹٠-٩]{1,4}/gu)) {
    const digits = [...m[0]].map(normalizeDigitChar).join("");
    if (digits.length > 0) out.add(digits);
  }
  return out;
}

function dropsSignificantNumbers(sources: string[], proposed: string): boolean {
  const propNums = significantNumbers(proposed);
  const required = new Set<string>();
  for (const src of sources) {
    for (const n of significantNumbers(src)) {
      if (n.length >= 1) required.add(n);
    }
  }
  for (const n of required) {
    if (n.length >= 2 && !propNums.has(n)) {
      return true;
    }
  }
  return false;
}

function dropsYearOrDurationMarker(sources: string[], proposed: string): boolean {
  if (sources.some((s) => /(?:سال|year)/i.test(s)) && !/(?:سال|year)/i.test(proposed)) {
    return true;
  }
  return false;
}

function dropsPlanTierWords(sources: string[], proposed: string): boolean {
  for (const tier of PLAN_TIER_WORDS) {
    const re = new RegExp(`\\b${tier}\\b`, "i");
    if (sources.some((s) => re.test(s)) && !re.test(proposed)) {
      return true;
    }
  }
  return false;
}

function hasMalformedDurationOrSuffix(proposed: string): boolean {
  if (/[\d۰-۹]+م(?:\s|$)/u.test(proposed) && !/[\d۰-۹]+\s*ماه/u.test(proposed)) {
    return true;
  }
  if (/[\d۰-۹]+\s*م(?:\s|$)/u.test(proposed) && !/[\d۰-۹]+\s*ماه/u.test(proposed)) {
    return true;
  }
  if (/\s[\d۰-۹]$/u.test(proposed.trim())) {
    return true;
  }
  return false;
}

function brandTokenMissing(sources: string[], proposed: string): boolean {
  const checks: Array<[RegExp, RegExp]> = [
    [/netflix|نتفلیکس/i, /netflix|نتفلیکس/i],
    [/gmail|جیمیل|جی‌میل/i, /gmail|جیمیل|جی‌میل/i],
    [/cursor|کرسر/i, /cursor|کرسر/i],
  ];
  for (const [srcRe, propRe] of checks) {
    if (sources.some((s) => srcRe.test(s)) && !propRe.test(proposed)) {
      return true;
    }
  }
  return false;
}

function warrantySnippets(text: string): string[] {
  const re = /\(\s*[^)]*(?:گارانتی|guarantee|warranty)[^)]*\)/gi;
  return [...text.matchAll(re)].map((m) => m[0].trim());
}

function dropsWarrantySnippet(sources: string[], proposed: string): boolean {
  for (const src of sources) {
    for (const snippet of warrantySnippets(src)) {
      const compact = snippet.replace(/\s+/g, "");
      if (!proposed.includes(snippet) && !proposed.replace(/\s+/g, "").includes(compact)) {
        return true;
      }
    }
  }
  return false;
}

function corruptsAlphanumericTokens(sources: string[], proposed: string): boolean {
  const propUpper = proposed.toUpperCase();
  for (const src of sources) {
    for (const m of src.matchAll(ALNUM_TOKEN_RE)) {
      const tok = m[0]!;
      if (!propUpper.includes(tok.toUpperCase())) {
        return true;
      }
    }
  }
  return false;
}

function addsEmojiWhenAbsent(current: string, proposed: string): boolean {
  return EMOJI_RE.test(proposed) && !EMOJI_RE.test(current);
}

function durationSurfaces(text: string): string[] {
  const n = normalizeDurationPhrases(text);
  return [...n.matchAll(DURATION_SURFACE_RE)].map((m) => m[0].replace(/\s+/g, " ").trim());
}

function durationSemanticKey(surface: string): string {
  return normalizeDurationPhrases(surface).replace(/\s+/g, " ").trim().toLowerCase();
}

function changesDurationSemantics(current: string, proposed: string): boolean {
  const cur = durationSurfaces(current);
  const prop = durationSurfaces(proposed);
  if (cur.length === 0 || prop.length === 0) return false;
  const curKey = durationSemanticKey(cur[0]!);
  const propKey = durationSemanticKey(prop[0]!);
  return curKey !== propKey;
}

function changesDurationSurfaceOnly(current: string, proposed: string): boolean {
  const cur = durationSurfaces(current);
  const prop = durationSurfaces(proposed);
  if (cur.length === 0 || prop.length === 0) return false;
  if (cur[0] === prop[0]) return false;
  return durationSemanticKey(cur[0]!) === durationSemanticKey(prop[0]!);
}

function stripEmojiForCompare(text: string): string {
  return text.replace(EMOJI_RE, "").replace(/\s+/g, " ").trim();
}

function addsUsefulBrandHint(current: string, remote: string, proposed: string): boolean {
  const brandHint =
    (/linkedin|لینکدین/i.test(remote) || /linkedin|لینکدین/i.test(proposed)) &&
    !/linkedin|لینکدین/i.test(current) &&
    /سیلز\s*نا/i.test(current);
  return brandHint && /لینکدین|linkedin/i.test(proposed);
}

function isCosmeticOrLowValueChange(current: string, remote: string, proposed: string): boolean {
  if (namesAreEquivalentForSync(current, proposed)) return true;

  const curPlain = normalizeNameForSyncComparison(stripEmojiForCompare(current));
  const propPlain = normalizeNameForSyncComparison(stripEmojiForCompare(proposed));
  if (curPlain === propPlain) return true;

  if (changesDurationSurfaceOnly(current, proposed) && !addsUsefulBrandHint(current, remote, proposed)) {
    return true;
  }

  if (/چت/i.test(current) && !/چت/i.test(proposed) && /جی.?پی.?تی|gpt|chatgpt/i.test(current)) {
    return true;
  }

  if (addsEmojiWhenAbsent(current, proposed)) return true;

  const curTokens = tokenize(current);
  const propTokens = tokenize(proposed);
  if (propTokens.size < curTokens.size && overlapRatio(curTokens, propTokens) > 0.85) {
    if (!addsUsefulBrandHint(current, remote, proposed)) return true;
  }

  return false;
}

/**
 * Returns a safe proposed name, or null to keep currentName (no proposal).
 */
export function sanitizeSupplierNameSyncProposal(input: {
  currentName: string;
  remoteName: string;
  proposedName: string;
}): string | null {
  const current = input.currentName.trim();
  const remote = input.remoteName.trim();
  const proposed = input.proposedName.trim();
  const sources = [current, remote].filter(Boolean);

  if (!proposed || namesAreEquivalentForSync(proposed, current)) return null;

  if (hasUnbalancedParens(proposed) || /\…$/.test(proposed)) {
    return null;
  }

  if (hasMalformedDurationOrSuffix(proposed)) {
    return null;
  }

  if (corruptsAlphanumericTokens(sources, proposed)) {
    return null;
  }

  if (dropsWarrantySnippet(sources, proposed)) {
    return null;
  }

  if (changesDurationSemantics(current, proposed)) {
    return null;
  }

  if (isCosmeticOrLowValueChange(current, remote, proposed)) {
    return null;
  }

  if (hasBrandMismatch(current, proposed) || hasBrandMismatch(remote, proposed)) {
    return null;
  }

  if (brandTokenMissing(sources, proposed)) {
    return null;
  }

  if (dropsPlanTierWords(sources, proposed)) {
    return null;
  }

  if (dropsSignificantNumbers(sources, proposed)) {
    return null;
  }

  if (dropsYearOrDurationMarker(sources, proposed)) {
    return null;
  }

  if (isLossyShortening(remote, proposed) || isLossyShortening(current, proposed)) {
    return null;
  }

  const remoteTokens = tokenize(remote);
  const proposedTokens = tokenize(proposed);
  const currentTokens = tokenize(current);

  if (overlapRatio(remoteTokens, proposedTokens) < 0.3) {
    return null;
  }

  if (overlapRatio(currentTokens, proposedTokens) < 0.2 && overlapRatio(remoteTokens, proposedTokens) < 0.45) {
    return null;
  }

  if (
    isPredominantlyPersian(current) &&
    !isPredominantlyPersian(proposed) &&
    overlapRatio(currentTokens, proposedTokens) < 0.35
  ) {
    return null;
  }

  if (/^\d+\s*روز\s/i.test(proposed) && !/adobe/i.test(proposed)) {
    return null;
  }

  return proposed;
}

function hasUnbalancedParens(text: string): boolean {
  let depth = 0;
  for (const ch of text) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (depth < 0) return true;
  }
  return depth !== 0;
}

export { namesAreEquivalentForSync } from "./supplierNameSyncCompare";
