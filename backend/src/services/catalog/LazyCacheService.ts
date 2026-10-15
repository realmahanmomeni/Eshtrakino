import { settingsService, LAST_CATALOG_SYNC_AT_KEY, LAST_FX_RATE_SYNC_AT_KEY } from "../settings/SettingsService";
import { canbosoSyncService } from "../suppliers/CanbosoSyncService";
import { exchangeRateService, EXCHANGE_RATE_TTL_MS } from "../exchangeRateService";

export const LAZY_CACHE_TTL_MS = EXCHANGE_RATE_TTL_MS;

export class LazyCacheService {
  private catalogInflight: Promise<void> | null = null;
  private fxInflight: Promise<void> | null = null;

  async getLastCatalogSyncAt(): Promise<number> {
    const raw = await settingsService.getSetting(LAST_CATALOG_SYNC_AT_KEY);
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) ? n : 0;
  }

  async getLastFxRateSyncAt(): Promise<number> {
    const mem = exchangeRateService.getLastFetchedAt();
    if (mem > 0) return mem;
    const raw = await settingsService.getSetting(LAST_FX_RATE_SYNC_AT_KEY);
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) ? n : 0;
  }

  async isCatalogStale(now = Date.now()): Promise<boolean> {
    const last = await this.getLastCatalogSyncAt();
    return last <= 0 || now - last > LAZY_CACHE_TTL_MS;
  }

  async isFxStale(now = Date.now()): Promise<boolean> {
    const last = await this.getLastFxRateSyncAt();
    return last <= 0 || now - last > LAZY_CACHE_TTL_MS;
  }

  async markCatalogSynced(at = Date.now()): Promise<void> {
    await settingsService.setSetting(LAST_CATALOG_SYNC_AT_KEY, String(at));
  }

  async markFxSynced(at = Date.now()): Promise<void> {
    await settingsService.setSetting(LAST_FX_RATE_SYNC_AT_KEY, String(at));
    exchangeRateService.touchFetchedAt(at);
  }

  async markBothSynced(at = Date.now()): Promise<void> {
    await Promise.all([this.markCatalogSynced(at), this.markFxSynced(at)]);
  }

  /** Non-blocking catalog refresh when stale (customer browse). */
  maybeRefreshOnBrowse(): void {
    void this.refreshCatalogIfStale(true);
    void this.refreshFxIfStale(true);
  }

  async refreshCatalogIfStale(background = false): Promise<void> {
    if (!(await this.isCatalogStale())) return;

    if (this.catalogInflight) {
      if (!background) await this.catalogInflight;
      return;
    }

    this.catalogInflight = (async () => {
      try {
        await canbosoSyncService.syncProductAvailability();
        await this.markCatalogSynced();
      } catch (err) {
        console.warn("[LazyCache] catalog sync failed:", err);
      }
    })().finally(() => {
      this.catalogInflight = null;
    });

    if (!background) await this.catalogInflight;
  }

  async refreshFxIfStale(background = false): Promise<void> {
    if (!(await this.isFxStale())) return;

    if (this.fxInflight) {
      if (!background) await this.fxInflight;
      return;
    }

    this.fxInflight = (async () => {
      try {
        await exchangeRateService.forceRefreshUsdRate();
        await this.markFxSynced();
      } catch (err) {
        console.warn("[LazyCache] FX refresh failed:", err);
      }
    })().finally(() => {
      this.fxInflight = null;
    });

    if (!background) await this.fxInflight;
  }

  /**
   * Manual 🔄 refresh: always sync catalog; FX only if TTL expired.
   */
  async manualCatalogRefresh(): Promise<void> {
    await canbosoSyncService.syncProductAvailability();
    await this.markCatalogSynced();

    if (await this.isFxStale()) {
      await exchangeRateService.forceRefreshUsdRate();
      await this.markFxSynced();
    }
  }

  async hydrateFromSettings(): Promise<void> {
    const fxAt = await this.getLastFxRateSyncAt();
    if (fxAt > 0) {
      exchangeRateService.touchFetchedAt(fxAt);
    }
  }
}

export const lazyCacheService = new LazyCacheService();
