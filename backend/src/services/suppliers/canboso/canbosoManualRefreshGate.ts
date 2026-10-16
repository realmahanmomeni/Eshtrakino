import { CANBOSO_MANUAL_REFRESH_MIN_INTERVAL_MS } from "./canbosoCatalogTtl";
import { getLastCanbosoNetworkFetchAt } from "./canbosoBulkCatalog";

export const MANUAL_CANBOSO_REFRESH_TOAST =
  "ℹ️ اطلاعات همین لحظه از آخرین بروزرسانی استفاده شد. لطفاً حدود یک دقیقه بعد دوباره «بروزرسانی» بزنید.";

/** True when a new Canboso network catalog fetch is allowed (global 60s). */
export function canFetchCanbosoCatalogFromNetwork(now = Date.now()): boolean {
  const last = getLastCanbosoNetworkFetchAt();
  if (last <= 0) return true;
  return now - last >= CANBOSO_MANUAL_REFRESH_MIN_INTERVAL_MS;
}
