/** Truncate for Telegram inline button text (max 64); prefer word boundary + ellipsis. */
export function truncateInlineButtonLabel(text: string, max = 64): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const slice = trimmed.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > max * 0.4 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trim()}…`;
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
