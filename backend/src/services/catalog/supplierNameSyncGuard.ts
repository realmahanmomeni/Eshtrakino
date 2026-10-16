import { isLossyShortening } from "./shortenSupplierProductName";

const PLAN_TIER_WORDS = ["ultra", "super", "pro", "max", "plus", "api", "magnific"] as const;

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

  if (!proposed || proposed === current) return null;

  if (hasUnbalancedParens(proposed) || /\…$/.test(proposed)) {
    return null;
  }

  if (hasMalformedDurationOrSuffix(proposed)) {
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
