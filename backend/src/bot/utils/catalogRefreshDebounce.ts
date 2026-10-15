/** Minimum interval between manual catalog refresh taps per Telegram user */
export const MANUAL_CATALOG_REFRESH_DEBOUNCE_MS = 30_000;

export const MANUAL_CATALOG_REFRESH_DEBOUNCE_TOAST =
  "⏳ لطفاً کمی صبر کنید، اطلاعات اخیراً به‌روز شده است.";

const lastManualRefreshAtByUser = new Map<number, number>();

/**
 * Returns true when a manual refresh is allowed; records the attempt timestamp on success.
 */
export function tryBeginManualCatalogRefresh(telegramUserId: number): boolean {
  const now = Date.now();
  const last = lastManualRefreshAtByUser.get(telegramUserId) ?? 0;
  if (now - last < MANUAL_CATALOG_REFRESH_DEBOUNCE_MS) {
    return false;
  }
  lastManualRefreshAtByUser.set(telegramUserId, now);
  return true;
}
