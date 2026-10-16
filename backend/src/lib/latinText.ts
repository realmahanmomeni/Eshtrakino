import { normalizeArabicToPersianChars } from "./telegramLabel";

/** Latin brand tokens (Coursera, FreePik, …) — do not apply Persian char normalization inside these spans. */
const LATIN_TOKEN_RE = /[A-Za-z][A-Za-z0-9+\-_.]*/g;

export function normalizeArabicToPersianCharsPreservingLatin(text: string): string {
  let out = "";
  let lastIndex = 0;
  for (const match of text.matchAll(LATIN_TOKEN_RE)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      out += normalizeArabicToPersianChars(text.slice(lastIndex, start));
    }
    out += match[0];
    lastIndex = start + match[0].length;
  }
  if (lastIndex < text.length) {
    out += normalizeArabicToPersianChars(text.slice(lastIndex));
  }
  return out;
}

/** Replace corrupted mixed Coursera token everywhere it appears as a substring. */
export const CORRUPTED_COURSERA_TOKEN = "کورsera";
export const CANONICAL_COURSERA_LATIN = "Coursera";

export function repairCourseraTokenInText(text: string): string {
  if (!text.includes(CORRUPTED_COURSERA_TOKEN)) return text;
  return text.split(CORRUPTED_COURSERA_TOKEN).join(CANONICAL_COURSERA_LATIN);
}
