import { env } from "../../../config/env";

/** Lazy DB/catalog sync interval for Canboso stock flags (not FX). Default 3 minutes. */
export const CANBOSO_CATALOG_TTL_MS =
  env.CANBOSO_CATALOG_TTL_MS ?? 3 * 60 * 1000;

/** In-memory bulk GET /products dedupe within one sync wave. */
export const CANBOSO_BULK_IN_MEMORY_TTL_MS = 45_000;

/** Checkout/payment stock verification may reuse bulk catalog younger than this. */
export const CANBOSO_CHECKOUT_CATALOG_MAX_AGE_MS = 20_000;

/** Shop browse blocks on sync only when last successful sync is older than this. */
export const CANBOSO_SHOP_BLOCKING_STALE_MS = 15 * 60 * 1000;

/** Manual 🔄 refresh — at most one Canboso catalog fetch per window (global). */
export const CANBOSO_MANUAL_REFRESH_MIN_INTERVAL_MS = 60_000;
