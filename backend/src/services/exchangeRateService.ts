import { settingsService, LAST_EXCHANGE_RATE_KEY } from "./settings/SettingsService";
import { SWAPWALLET_API_BASE } from "./payments/SwapWalletService";

/** 30 minutes lazy cache TTL */
export const EXCHANGE_RATE_TTL_MS = 30 * 60 * 1000;

/** Default fallback exchange rate in Tomans if both API and DB cache are unavailable */
export const DEFAULT_USD_TOMAN_RATE = 100_000;

export class ExchangeRateService {
  private cachedRate: number | null = null;
  private lastFetchedAt = 0;
  private inflight: Promise<number> | null = null;

  /**
   * Get current cached rate synchronously without triggering a fetch.
   * Returns null if no rate has been fetched yet.
   */
  getCachedRate(): number | null {
    return this.cachedRate;
  }

  /**
   * Get last fetch timestamp in milliseconds.
   */
  getLastFetchedAt(): number {
    return this.lastFetchedAt;
  }

  /**
   * Get USD/USDT to Toman exchange rate.
   * Uses 30-minute lazy caching.
   * If expired or uninitialized, queries SwapWallet API.
   * Falls back to stale cache, DB setting, or default rate if API fails.
   */
  async getUsdToTomanRate(): Promise<number> {
    const now = Date.now();
    if (
      this.cachedRate !== null &&
      this.cachedRate > 0 &&
      now - this.lastFetchedAt < EXCHANGE_RATE_TTL_MS
    ) {
      return this.cachedRate;
    }

    if (this.inflight) {
      return this.inflight;
    }

    this.inflight = this.fetchAndCacheRate().finally(() => {
      this.inflight = null;
    });

    return this.inflight;
  }

  /**
   * Alias for getUsdToTomanRate().
   */
  async getUsdRate(): Promise<number> {
    return this.getUsdToTomanRate();
  }

  /**
   * Fetches latest rate from SwapWallet API with fallbacks.
   */
  private async fetchAndCacheRate(): Promise<number> {
    try {
      const liveRate = await this.fetchFromSwapWalletApi();
      this.cachedRate = liveRate;
      this.lastFetchedAt = Date.now();

      // Persist to DB asynchronously as last known good rate
      settingsService
        .setSetting(LAST_EXCHANGE_RATE_KEY, String(liveRate))
        .catch((err) => {
          console.warn(
            "[ExchangeRateService] Failed to persist last exchange rate to DB:",
            err instanceof Error ? err.message : err,
          );
        });

      return liveRate;
    } catch (err) {
      console.warn(
        "⚠️ [ExchangeRateService] Failed to fetch live rate from SwapWallet, using fallback:",
        err instanceof Error ? err.message : err,
      );

      // Fallback 1: Stale in-memory rate
      if (this.cachedRate !== null && this.cachedRate > 0) {
        return this.cachedRate;
      }

      // Fallback 2: Stored rate in DB
      try {
        const dbRate = await settingsService.getNumberSetting(
          LAST_EXCHANGE_RATE_KEY,
          0,
        );
        if (dbRate > 0) {
          this.cachedRate = dbRate;
          return dbRate;
        }
      } catch (dbErr) {
        console.warn(
          "[ExchangeRateService] Failed to read last exchange rate from DB:",
          dbErr instanceof Error ? dbErr.message : dbErr,
        );
      }

      // Fallback 3: Hardcoded safe default rate
      this.cachedRate = DEFAULT_USD_TOMAN_RATE;
      return DEFAULT_USD_TOMAN_RATE;
    }
  }

  /**
   * Directly queries SwapWallet /v1/market/prices for USDT/IRT rate.
   */
  private async fetchFromSwapWalletApi(): Promise<number> {
    const response = await fetch(`${SWAPWALLET_API_BASE}/v1/market/prices`, {
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`SwapWallet API returned HTTP ${response.status}`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    if (!data || typeof data !== "object") {
      throw new Error("Invalid response format from SwapWallet API");
    }

    let raw: unknown = data["USDT/IRT"];
    if (raw == null && data.result && typeof data.result === "object") {
      raw = (data.result as Record<string, unknown>)["USDT/IRT"];
    }

    if (raw == null) {
      throw new Error("USDT/IRT pair missing from SwapWallet market prices");
    }

    const rate = Number(String(raw).replace(/,/g, "").trim());
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error(`Invalid USDT/IRT rate received: ${String(raw)}`);
    }

    return rate;
  }
}

export const exchangeRateService = new ExchangeRateService();

/**
 * Converts a USD amount to Iranian Toman.
 * Rounds to the nearest 1,000 Tomans.
 *
 * @param usdAmount The price in USD.
 * @param rate Optional exchange rate (Tomans per USD). If omitted, uses current cached or default rate.
 * @returns Amount rounded to nearest 1,000 Tomans.
 */
export function convertUsdToToman(usdAmount: number, rate?: number): number {
  if (!Number.isFinite(usdAmount) || usdAmount <= 0) {
    return 0;
  }
  const effectiveRate =
    rate != null && Number.isFinite(rate) && rate > 0
      ? rate
      : (exchangeRateService.getCachedRate() ?? DEFAULT_USD_TOMAN_RATE);

  return Math.round((usdAmount * effectiveRate) / 1000) * 1000;
}
