const TRAILING_ELLIPSIS_JUNK_RE = /[.…\u2026\s]+$/u;

function isDigitChar(ch: string): boolean {
  return /[\d۰-۹٠-٩]/.test(ch);
}

/** Prefer cutting on spaces; never leave a dangling partial number token. */
function truncateAtWordBoundary(text: string, max: number): string {
  if (text.length <= max) return text;
  const budget = max - 1;
  const slice = text.slice(0, budget);
  const lastSpace = slice.lastIndexOf(" ");
  let cutEnd = lastSpace > budget * 0.4 ? lastSpace : budget;

  while (cutEnd > 0 && cutEnd < text.length && isDigitChar(text[cutEnd]!)) {
    const prevSpace = text.lastIndexOf(" ", cutEnd - 1);
    if (prevSpace <= budget * 0.25) break;
    cutEnd = prevSpace;
  }

  return text.slice(0, cutEnd).trimEnd().replace(TRAILING_ELLIPSIS_JUNK_RE, "");
}

/** Truncate for Telegram inline button text (max 64); prefer word boundary + ellipsis. */
export function truncateInlineButtonLabel(text: string, max = 64): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const head = truncateAtWordBoundary(trimmed, max);
  return `${head}…`;
}

/** Isolate Latin runs for correct RTL display alongside Persian text. */
export function isolateEmbeddedLatin(text: string): string {
  return text.replace(
    /([A-Za-z0-9][A-Za-z0-9\s.\-+_/]*[A-Za-z0-9]|[A-Za-z0-9]+)/g,
    (m) => `\u2066${m}\u2069`,
  );
}

export function normalizeArabicToPersianChars(text: string): string {
  return text
    .replace(/[\u064A\u0649]/g, "ی")
    .replace(/[\u0643]/g, "ک");
}
