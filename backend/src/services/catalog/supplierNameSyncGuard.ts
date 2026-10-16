import { isLossyShortening } from "./shortenSupplierProductName";

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
  const cur = current.toLowerCase();
  const prop = proposed.toLowerCase();
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
  let proposed = input.proposedName.trim();

  if (!proposed || proposed === current) return null;

  if (hasUnbalancedParens(proposed) || /\…$/.test(proposed)) {
    return null;
  }

  if (/[\d۰-۹]+\s*م(?:\s|$)/u.test(proposed) && !/[\d۰-۹]+\s*ماه/u.test(proposed)) {
    return null;
  }

  if (hasBrandMismatch(current, proposed) || hasBrandMismatch(remote, proposed)) {
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
