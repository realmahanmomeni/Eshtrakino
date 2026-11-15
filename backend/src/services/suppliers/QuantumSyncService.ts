import { DeliveryType, Prisma, SupplierPendingImportStatus } from "@prisma/client";
import type { Api } from "grammy";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { getCatalogAdminTelegramIds } from "../../lib/catalogAdminNotify";
import { sendMessageThrottled } from "../../lib/telegramSend";
import { sanitizeCustomerCatalogText } from "../../bot/utils/catalogUi";
import { exchangeRateService } from "../exchangeRateService";
import { settingsService } from "../settings/SettingsService";
import { SupplierManager } from "./SupplierManager";
import { supplierPendingImportService } from "./SupplierPendingImportService";
import { requiresAdminApprovalBeforeImport } from "./supplierImportClassification";
import { quantumVaultAdapter } from "./quantumvault/QuantumVaultAdapter";
import { quantumVaultHttp } from "./quantumvault/quantumVaultHttp";
import { quantumRequestGate } from "./quantumvault/quantumLimiter";
import { parseUsdAmount, formatUsdAmount } from "./quantumvault/quantumMoney";
import {
  QUANTUM_SUPPLIER_NAME,
  expandQuantumCatalog,
  findQuantumCachedUnit,
  isQuantumUnitInStock,
  quantumMappingIdentity,
  quantumUnitToCatalogProduct,
  setQuantumCatalogCache,
  type QuantumSellableUnit,
} from "./quantumvault/quantumCatalog";
import {
  buildQuantumBatchNotice,
  buildQuantumFirstSyncSummary,
  buildQuantumLowBalanceAlert,
  quantumPendingReviewKeyboard,
} from "./quantumvault/quantumNotify";

export const QUANTUM_INITIAL_SUMMARY_SENT_KEY = "QUANTUM_INITIAL_SUMMARY_SENT";
export const QUANTUM_LOW_BALANCE_ALERTED_AT_KEY = "QUANTUM_LOW_BALANCE_ALERTED_AT";
const LOW_BALANCE_ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

let syncNotifyApi: Api | null = null;

export function setQuantumSyncNotifyApi(api: Api): void {
  syncNotifyApi = api;
}

export function quantumSyncIntervalMs(): number {
  const configured = env.QUANTUMVAULT_SYNC_INTERVAL_MS;
  const value = configured == null ? 12 * 60 * 1000 : configured;
  return Math.max(60_000, value);
}

export function quantumLowBalanceUsd(): number {
  const configured = env.QUANTUMVAULT_LOW_BALANCE_USD;
  return configured == null ? 5 : configured;
}

export class QuantumSyncService {
  private running = false;

  async ensureSupplier(): Promise<{ supplierId: number }> {
    let supplier = await prisma.supplier.findFirst({
      where: { name: QUANTUM_SUPPLIER_NAME },
    });
    if (!supplier) {
      supplier = await prisma.supplier.create({
        data: { name: QUANTUM_SUPPLIER_NAME, isActive: true },
      });
    } else if (!supplier.isActive) {
      supplier = await prisma.supplier.update({
        where: { id: supplier.id },
        data: { isActive: true },
      });
    }
    return { supplierId: supplier.id };
  }

  async ensureSupplierAndKey(): Promise<{
    supplierId: number;
    apiKeyId: number;
    apiKey: string;
  } | null> {
    const { supplierId } = await this.ensureSupplier();
    let apiKey = "";
    try {
      apiKey = quantumVaultAdapter.resolveApiKey();
    } catch {
      return null;
    }

    const encrypted = SupplierManager.encryptKey(apiKey);
    let keyRow = await prisma.supplierApiKey.findFirst({
      where: { supplierId, isActive: true },
      orderBy: { updatedAt: "desc" },
    });

    if (!keyRow) {
      keyRow = await prisma.supplierApiKey.create({
        data: {
          supplierId,
          keyName: "default",
          encryptedKey: encrypted,
          isActive: true,
          isValid: true,
          lastValidatedAt: new Date(),
        },
      });
    } else if (keyRow.encryptedKey !== encrypted) {
      keyRow = await prisma.supplierApiKey.update({
        where: { id: keyRow.id },
        data: { encryptedKey: encrypted, isValid: true, lastValidatedAt: new Date() },
      });
    }

    return { supplierId, apiKeyId: keyRow.id, apiKey };
  }

  /**
   * One GET /products per cycle. Updates mapped price/stock/active state and
   * queues everything else for the existing approve/reject flow.
   * Does not call POST /purchase.
   */
  async syncCatalog(options?: { notifyApi?: Api }): Promise<{
    updated: number;
    queuedForReview: number;
    skipped: boolean;
  }> {
    if (this.running) return { updated: 0, queuedForReview: 0, skipped: true };
    this.running = true;
    try {
      return await this.syncCatalogOnce(options);
    } finally {
      this.running = false;
    }
  }

  private async syncCatalogOnce(options?: { notifyApi?: Api }): Promise<{
    updated: number;
    queuedForReview: number;
    skipped: boolean;
  }> {
    const ensured = await this.ensureSupplierAndKey();
    if (!ensured) {
      console.warn("[QuantumSync] QUANTUMVAULT_API_KEY missing; supplier row ensured, sync skipped.");
      return { updated: 0, queuedForReview: 0, skipped: true };
    }
    if (quantumRequestGate.isPaused()) {
      console.warn("[QuantumSync] Circuit open; skipping catalog sync.");
      return { updated: 0, queuedForReview: 0, skipped: true };
    }

    const { supplierId, apiKey } = ensured;
    let body: unknown;
    try {
      const result = await quantumVaultHttp.request("/products", apiKey, { retry: true });
      if (!result.ok) {
        console.error(`[QuantumSync] GET /products failed: HTTP ${result.status}`);
        return { updated: 0, queuedForReview: 0, skipped: true };
      }
      body = result.body;
    } catch (err) {
      console.error("[QuantumSync] GET /products failed:", err instanceof Error ? err.message : err);
      return { updated: 0, queuedForReview: 0, skipped: true };
    }

    const units = expandQuantumCatalog(body);
    setQuantumCatalogCache(units);

    const mappings = await prisma.supplierProductMapping.findMany({
      where: { supplierId },
      include: { product: true },
    });

    const summarySent = await settingsService.getSetting(QUANTUM_INITIAL_SUMMARY_SENT_KEY);
    const isFirstSync = mappings.length === 0 && summarySent !== "1";

    let updated = 0;
    const matchedKeys = new Set<string>();

    for (const mapping of mappings) {
      const unit = findQuantumCachedUnit({
        productKey: mapping.supplierProductKey,
        variantKey: mapping.supplierVariantKey,
        offerGroup: mapping.supplierOfferGroup,
      });
      if (!unit) {
        if (mapping.product.isActive) {
          await prisma.product.update({
            where: { id: mapping.productId },
            data: { isActive: false },
          });
          updated += 1;
          console.warn(
            `[QuantumSync] Deactivated product #${mapping.productId} — missing from Quantum catalog`,
          );
        }
        continue;
      }

      const identity = quantumMappingIdentity(unit);
      if (
        mapping.supplierProductKey !== identity.supplierProductKey ||
        (mapping.supplierVariantKey ?? "") !== identity.supplierVariantKey ||
        mapping.supplierOfferGroup !== unit.offerGroup
      ) {
        await prisma.supplierProductMapping.update({
          where: { id: mapping.id },
          data: {
            supplierProductKey: identity.supplierProductKey,
            supplierVariantKey: identity.supplierVariantKey || null,
            supplierOfferGroup: unit.offerGroup,
          },
        });
      }
      matchedKeys.add(identity.supplierProductKey);
      if (identity.supplierVariantKey) matchedKeys.add(identity.supplierVariantKey);
      updated += await this.applyRemoteToLocalProduct(mapping.productId, mapping.product, unit);
    }

    const remoteProducts = units.map(quantumUnitToCatalogProduct);
    const needsReview = remoteProducts.filter((remote) =>
      requiresAdminApprovalBeforeImport(remote, matchedKeys),
    );

    const pendingBefore = await prisma.supplierPendingImport.findMany({
      where: { supplierId, status: SupplierPendingImportStatus.PENDING },
      select: { id: true },
    });
    const beforeIds = new Set(pendingBefore.map((row) => row.id));

    const usdRate = await exchangeRateService.getUsdToTomanRate();
    const queuedForReview =
      needsReview.length === 0
        ? 0
        : await supplierPendingImportService.queueNewSupplierProductsForReview(
            supplierId,
            needsReview,
            matchedKeys,
            usdRate,
          );

    const notifyApi = options?.notifyApi ?? syncNotifyApi;
    if (notifyApi) {
      await this.notifyAdmins(notifyApi, supplierId, isFirstSync, beforeIds);
    }

    await this.refreshBalance(supplierId, apiKey, notifyApi);
    return { updated, queuedForReview, skipped: false };
  }

  private async applyRemoteToLocalProduct(
    productId: number,
    product: {
      isActive: boolean;
      deliveryType: DeliveryType;
      description: string | null;
      forceManualFallback: boolean;
    },
    unit: QuantumSellableUnit,
  ): Promise<number> {
    let changes = 0;
    const remoteInStock = isQuantumUnitInStock(unit);
    const shouldBeActive = remoteInStock || product.forceManualFallback === true;

    if (product.isActive !== shouldBeActive) {
      await prisma.product.update({
        where: { id: productId },
        data: { isActive: shouldBeActive },
      });
      changes += 1;
      console.log(
        `[QuantumSync] Product #${productId} ${shouldBeActive ? "activated" : "deactivated"} ` +
          `(inStock=${remoteInStock}, fallback=${product.forceManualFallback === true})`,
      );
    }

    if (product.deliveryType !== DeliveryType.SUPPLIER_AUTO) {
      await prisma.product.update({
        where: { id: productId },
        data: { deliveryType: DeliveryType.SUPPLIER_AUTO },
      });
      changes += 1;
    }

    if (unit.description.trim()) {
      const desc = sanitizeCustomerCatalogText(unit.description).trim();
      if (desc && desc !== product.description) {
        await prisma.product.update({
          where: { id: productId },
          data: { description: desc },
        });
        changes += 1;
      }
    }

    if (unit.deliverFieldNames.length > 0) {
      await prisma.product.update({
        where: { id: productId },
        data: { requiredFields: unit.deliverFieldNames },
      });
      changes += 1;
    }

    if (unit.priceUsd != null && unit.priceUsd > 0) {
      await prisma.product.update({
        where: { id: productId },
        data: { supplierCostUsd: unit.priceUsd },
      });
      const { applyMarginPricingToProduct } = await import("../catalog/profitMarginService.js");
      await applyMarginPricingToProduct(productId);
      changes += 1;
    }

    return changes;
  }

  private async notifyAdmins(
    api: Api,
    supplierId: number,
    isFirstSync: boolean,
    pendingIdsBefore: Set<number>,
  ): Promise<void> {
    const adminIds = await getCatalogAdminTelegramIds();
    const pending = await prisma.supplierPendingImport.findMany({
      where: { supplierId, status: SupplierPendingImportStatus.PENDING },
      orderBy: { id: "asc" },
    });
    if (pending.length === 0 || adminIds.length === 0) return;

    const fresh = pending.filter((row) => !pendingIdsBefore.has(row.id));
    if (!isFirstSync && fresh.length === 0) return;

    const text = isFirstSync
      ? buildQuantumFirstSyncSummary({
          total: pending.length,
          folders: pending.map((row) => row.remoteFolder),
        })
      : buildQuantumBatchNotice(
          fresh.map((row) => ({ name: row.displayName, folder: row.remoteFolder })),
        );

    const keyboard = quantumPendingReviewKeyboard();
    let delivered = false;
    for (const adminId of adminIds) {
      const msg = await sendMessageThrottled(api, adminId, text, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      });
      if (msg) delivered = true;
    }
    if (!delivered) return;

    const ids = (isFirstSync ? pending : fresh).map((row) => row.id);
    await prisma.supplierPendingImport.updateMany({
      where: { id: { in: ids } },
      data: {
        notifiedAdminIds: adminIds,
        notifiedAt: new Date(),
      },
    });
    if (isFirstSync) {
      await settingsService.setSetting(QUANTUM_INITIAL_SUMMARY_SENT_KEY, "1");
    }
  }

  private async refreshBalance(supplierId: number, apiKey: string, api: Api | null): Promise<void> {
    try {
      const result = await quantumVaultHttp.request("/balance", apiKey, { retry: true });
      if (!result.ok) return;
      const record =
        result.body && typeof result.body === "object"
          ? (result.body as { balance?: unknown })
          : null;
      const balance = parseUsdAmount(record?.balance);
      if (balance == null) return;

      await prisma.supplierApiKey.updateMany({
        where: { supplierId, isActive: true },
        data: {
          lastBalance: new Prisma.Decimal(formatUsdAmount(balance)),
          lastValidatedAt: new Date(),
          isValid: true,
        },
      });

      await this.maybeAlertLowBalance(balance, api);
    } catch (err) {
      console.warn(
        "[QuantumSync] GET /balance failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  private async maybeAlertLowBalance(balance: number, api: Api | null): Promise<void> {
    const threshold = quantumLowBalanceUsd();
    const alertedAt = await settingsService.getSetting(QUANTUM_LOW_BALANCE_ALERTED_AT_KEY);
    if (balance >= threshold) {
      if (alertedAt) await settingsService.setSetting(QUANTUM_LOW_BALANCE_ALERTED_AT_KEY, "");
      return;
    }
    if (!api) return;
    const last = alertedAt ? Number(alertedAt) : 0;
    if (Number.isFinite(last) && last > 0 && Date.now() - last < LOW_BALANCE_ALERT_COOLDOWN_MS) {
      return;
    }
    const adminIds = await getCatalogAdminTelegramIds();
    const text = buildQuantumLowBalanceAlert();
    for (const adminId of adminIds) {
      await sendMessageThrottled(api, adminId, text);
    }
    await settingsService.setSetting(QUANTUM_LOW_BALANCE_ALERTED_AT_KEY, String(Date.now()));
  }
}

export const quantumSyncService = new QuantumSyncService();
