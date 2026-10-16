import { SupplierRateLimitError } from "../SupplierAdapter";

/** Client-side cap for Canboso read calls (products/balance/orders). */
export const CANBOSO_READ_LIMIT_PER_WINDOW = 20;
export const CANBOSO_READ_WINDOW_MS = 60_000;

const readTimestamps: number[] = [];

export function resetCanbosoReadLimiterForTests(): void {
  readTimestamps.length = 0;
}

function pruneReadTimestamps(now: number): void {
  const cutoff = now - CANBOSO_READ_WINDOW_MS;
  while (readTimestamps.length > 0 && readTimestamps[0]! < cutoff) {
    readTimestamps.shift();
  }
}

/**
 * Reserve a slot before sending a read request. Throws when over cap (callers use DB/cache).
 * Optional brief wait when one slot will free within 500ms.
 */
export async function acquireCanbosoReadSlot(options?: {
  waitUpToMs?: number;
}): Promise<void> {
  const waitUpToMs = options?.waitUpToMs ?? 0;
  const started = Date.now();

  for (;;) {
    const now = Date.now();
    pruneReadTimestamps(now);
    if (readTimestamps.length < CANBOSO_READ_LIMIT_PER_WINDOW) {
      readTimestamps.push(now);
      return;
    }

    if (waitUpToMs <= 0 || now - started >= waitUpToMs) {
      throw new SupplierRateLimitError(
        "Canboso read rate limit (client): too many requests in the last minute.",
      );
    }

    const oldest = readTimestamps[0]!;
    const waitMs = Math.min(
      waitUpToMs - (now - started),
      oldest + CANBOSO_READ_WINDOW_MS - now + 5,
    );
    if (waitMs <= 0) {
      throw new SupplierRateLimitError(
        "Canboso read rate limit (client): too many requests in the last minute.",
      );
    }
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

export function getCanbosoReadCountInWindow(now = Date.now()): number {
  pruneReadTimestamps(now);
  return readTimestamps.length;
}
