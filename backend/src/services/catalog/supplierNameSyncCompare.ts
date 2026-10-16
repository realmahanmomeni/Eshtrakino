/** Normalise product names for supplier sync equivalence (no-op) checks. */
export function normalizeNameForSyncComparison(name: string): string {
  return name
    .replace(/[\u2066-\u2069\u200e\u200f\ufeff]/g, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function namesAreEquivalentForSync(a: string, b: string): boolean {
  return normalizeNameForSyncComparison(a) === normalizeNameForSyncComparison(b);
}
