import { DeliveryType } from "@prisma/client";
import type { Api } from "grammy";
import { polishCustomerProductTitle } from "../catalog/productTitlePolish";
import { shortenSupplierProductName } from "../catalog/shortenSupplierProductName";
import { prisma } from "../../lib/prisma";
import { isInternalEshtrakinoFulfillment } from "../catalog/catalogAvailability";
import {
  assignProductToShopHierarchy,
  repairAllProductSubCategories,
} from "../catalog/catalogHierarchy";
import { env } from "../../config/env";
import { exchangeRateService, convertUsdToToman } from "../exchangeRateService";
import { canbosoAdapter, type CanbosoCatalogProduct } from "./adapters/CanbosoAdapter";
import {
  findRemoteInBulkCatalog,
  getCanbosoBulkCatalog,
} from "./canboso/canbosoBulkCatalog";
import { CANBOSO_BULK_IN_MEMORY_TTL_MS } from "./canboso/canbosoCatalogTtl";
import { canFetchCanbosoCatalogFromNetwork } from "./canboso/canbosoManualRefreshGate";
import { supplierCostUsdFromRemote } from "./canbosoCost";
import {
  isChargeOrVariantOfMappedParent,
  requiresAdminApprovalBeforeImport,
  supplierKeysFromRemote,
} from "./supplierImportClassification";
import { supplierPendingImportService } from "./SupplierPendingImportService";
import { SupplierManager } from "./SupplierManager";
import { sanitizeCustomerCatalogText } from "../../bot/utils/catalogUi";

export const CANBOSO_SUPPLIER_NAME = "Canboso";

let syncNotifyApi: Api | null = null;

/** Registers bot API so new-supplier-product alerts can DM admins after sync. */
export function setCanbosoSyncNotifyApi(api: Api): void {
  syncNotifyApi = api;
}

export class CanbosoSyncService {
  async ensureSupplierAndKey(): Promise<{
    supplierId: number;
    apiKeyId: number;
    apiKey: string;
  }> {
    const apiKey = canbosoAdapter.resolveApiKey();

    let supplier = await prisma.supplier.findFirst({
      where: {
        OR: [
          { name: CANBOSO_SUPPLIER_NAME },
          { name: { contains: "canboso", mode: "insensitive" } },
        ],
      },
    });

    if (!supplier) {
      supplier = await prisma.supplier.create({
        data: { name: CANBOSO_SUPPLIER_NAME, isActive: true },
      });
    } else if (!supplier.isActive) {
      supplier = await prisma.supplier.update({
        where: { id: supplier.id },
        data: { isActive: true },
      });
    }

    let keyRow = await prisma.supplierApiKey.findFirst({
      where: { supplierId: supplier.id, isActive: true },
      orderBy: { updatedAt: "desc" },
    });

    const encrypted = SupplierManager.encryptKey(apiKey);

    if (!keyRow) {
      keyRow = await prisma.supplierApiKey.create({
        data: {
          supplierId: supplier.id,
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
        data: {
          encryptedKey: encrypted,
          isValid: true,
          lastValidatedAt: new Date(),
        },
      });
    }

    return { supplierId: supplier.id, apiKeyId: keyRow.id, apiKey };
  }

  /**
   * Full catalog sync: hierarchy repair, stock/active, supplier keys, margins, imports.
   */
  async syncProducts(): Promise<{
    updated: number;
    imported: number;
    hierarchyFixed: number;
  }> {
    await this.migrateMappedProductsToSupplierAuto();
    const hierarchyFixed = await repairAllProductSubCategories();
    const { updated, imported } = await this.syncProductAvailability();
    await repairAllProductSubCategories();
    return { updated, imported, hierarchyFixed };
  }

  /** Force SUPPLIER_AUTO on every Canboso-mapped product (fixes legacy MANUAL / wrong labels). */
  async migrateMappedProductsToSupplierAuto(): Promise<number> {
    const mappings = await prisma.supplierProductMapping.findMany({
      select: { productId: true },
    });
    if (mappings.length === 0) return 0;

    const ids = mappings.map((m) => m.productId);
    const result = await prisma.product.updateMany({
      where: {
        id: { in: ids },
        deliveryType: { not: DeliveryType.SUPPLIER_AUTO },
      },
      data: { deliveryType: DeliveryType.SUPPLIER_AUTO },
    });
    return result.count;
  }

  /**
   * Single GET /products fetch (cached ~45s). Updates costs, descriptions, active flags, margins.
   */
  async syncAllSupplierProductsBulk(options?: {
    forceRefresh?: boolean;
    notifyApi?: Api;
  }): Promise<{ updated: number; imported: number; queuedForReview: number }> {
    if (!env.CANBOSO_API_KEY?.trim()) {
      console.warn("[CanbosoSync] CANBOSO_API_KEY missing; skipping bulk sync.");
      return { updated: 0, imported: 0, queuedForReview: 0 };
    }

    await this.migrateMappedProductsToSupplierAuto();
    const { supplierId } = await this.ensureSupplierAndKey();

    const legacySuppliers = await prisma.supplier.findMany({
      where: {
        OR: [
          { name: "QuantumVault" },
          { name: "Quantum Bot" },
          { name: { contains: "quantum", mode: "insensitive" } },
        ],
        NOT: { id: supplierId },
      },
      select: { id: true },
    });
    if (legacySuppliers.length > 0) {
      await prisma.supplierProductMapping.updateMany({
        where: { supplierId: { in: legacySuppliers.map((s) => s.id) } },
        data: { supplierId },
      });
    }

    const force = options?.forceRefresh === true;
    const allowNetwork = !force || canFetchCanbosoCatalogFromNetwork();
    let snap;
    try {
      snap = await getCanbosoBulkCatalog({
        force: force && allowNetwork,
        maxAgeMs: force && allowNetwork ? 0 : CANBOSO_BULK_IN_MEMORY_TTL_MS,
        reason: force ? "sync-force" : "sync",
      });
    } catch (err) {
      console.error("[CanbosoSync] Bulk catalog fetch failed:", err);
      return { updated: 0, imported: 0, queuedForReview: 0 };
    }

    const { indexes, remoteProducts } = snap;
    let updated = 0;

    const mappings = await prisma.supplierProductMapping.findMany({
      where: { supplierId },
      include: {
        product: {
          include: {
            category: true,
            subCategory: true,
            supplierProductMapping: true,
          },
        },
      },
    });

    const usdRate = await exchangeRateService.getUsdToTomanRate();

    for (const mapping of mappings) {
      if (isInternalEshtrakinoFulfillment(mapping.product)) {
        continue;
      }

      let remote = findRemoteInBulkCatalog(
        indexes,
        mapping.supplierProductKey,
        mapping.product.name,
      );
      if (!remote && mapping.supplierVariantKey) {
        remote = indexes.byId.get(mapping.supplierVariantKey);
      }

      if (remote) {
        const supplierProductKey = remote.parentProductId ?? remote.productId;
        const supplierVariantKey =
          remote.variantId && remote.variantId !== supplierProductKey
            ? remote.variantId
            : null;
        if (
          mapping.supplierProductKey !== supplierProductKey ||
          mapping.supplierVariantKey !== supplierVariantKey
        ) {
          await prisma.supplierProductMapping.update({
            where: { id: mapping.id },
            data: { supplierProductKey, supplierVariantKey },
          });
        }
      }

      if (!remote) {
        if (mapping.product.isActive) {
          await prisma.product.update({
            where: { id: mapping.productId },
            data: { isActive: false },
          });
          console.warn(
            `[CanbosoSync] Deactivated product #${mapping.productId} (${mapping.product.name}) — SKU ${mapping.supplierProductKey} missing from remote catalog`,
          );
          updated += 1;
        }
        continue;
      }

      updated += await this.applyRemoteToLocalProduct(
        mapping.productId,
        mapping.product,
        remote,
        usdRate,
      );
    }

    const notifyApi = options?.notifyApi ?? syncNotifyApi;
    const { imported, queuedForReview } = await this.importUnmappedCanbosoProducts(
      supplierId,
      remoteProducts,
      mappings,
      usdRate,
      notifyApi,
    );

    if (notifyApi) {
      await supplierPendingImportService.flushPendingAdminNotifications(notifyApi);
    }

    try {
      const balance = await canbosoAdapter.getBalance();
      await prisma.supplierApiKey.updateMany({
        where: { supplierId, isActive: true },
        data: { lastBalance: balance.balance, lastValidatedAt: new Date() },
      });
    } catch {
      /* non-fatal */
    }

    return { updated, imported, queuedForReview };
  }

  /** Idempotent sync — delegates to single-request bulk catalog (anti-429). */
  async syncProductAvailability(options?: {
    forceRefresh?: boolean;
  }): Promise<{
    updated: number;
    imported: number;
    queuedForReview: number;
  }> {
    return this.syncAllSupplierProductsBulk(options);
  }

  private async applyRemoteToLocalProduct(
    productId: number,
    product: {
      id: number;
      name: string;
      isActive: boolean;
      subCategoryId: number | null;
      deliveryType: DeliveryType;
    },
    remote: CanbosoCatalogProduct,
    usdRate: number,
  ): Promise<number> {
    let changes = 0;
    const shouldBeActive = remote.stock > 0 && remote.isAvailable;

    if (product.isActive !== shouldBeActive) {
      await prisma.product.update({
        where: { id: productId },
        data: { isActive: shouldBeActive },
      });
      changes += 1;
    }

    if (product.deliveryType !== DeliveryType.SUPPLIER_AUTO) {
      await prisma.product.update({
        where: { id: productId },
        data: { deliveryType: DeliveryType.SUPPLIER_AUTO },
      });
      changes += 1;
    }

    if (product.subCategoryId == null) {
      await assignProductToShopHierarchy(productId, product.name);
      changes += 1;
    }

    if (remote.requiredFields.length > 0) {
      await prisma.product.update({
        where: { id: productId },
        data: { requiredFields: remote.requiredFields },
      });
      changes += 1;
    }

    const polishedName = polishCustomerProductTitle(remote.brandName ?? remote.name);
    if (polishedName && polishedName !== product.name) {
      await prisma.product.update({
        where: { id: productId },
        data: { name: polishedName },
      });
      changes += 1;
    }

    const rawRow =
      remote.raw && typeof remote.raw === "object"
        ? (remote.raw as Record<string, unknown>)
        : null;
    const rawDescription =
      typeof rawRow?.description === "string" ? rawRow.description.trim() : "";
    const descriptionSource = rawDescription || remote.description?.trim() || "";
    if (descriptionSource) {
      const desc = sanitizeCustomerCatalogText(descriptionSource).trim();
      if (desc.length > 0) {
        await prisma.product.update({
          where: { id: productId },
          data: { description: desc },
        });
        changes += 1;
      }
    }

    const supplierCostUsd = supplierCostUsdFromRemote(remote, usdRate);
    await prisma.product.update({
      where: { id: productId },
      data: { supplierCostUsd },
    });

    const { applyMarginPricingToProduct } = await import(
      "../catalog/profitMarginService.js"
    );
    await applyMarginPricingToProduct(productId);
    changes += 1;

    await assignProductToShopHierarchy(
      productId,
      polishedName || remote.brandName || product.name,
    );

    return changes;
  }

  private async importUnmappedCanbosoProducts(
    supplierId: number,
    remoteProducts: CanbosoCatalogProduct[],
    existingMappings: Array<{ supplierProductKey: string }>,
    usdRate: number,
    notifyApi?: Api | null,
  ): Promise<{ imported: number; queuedForReview: number }> {
    const mappedKeys = new Set<string>();
    for (const m of existingMappings) {
      mappedKeys.add(m.supplierProductKey);
    }
    const unmapped = remoteProducts.filter(
      (p) =>
        !mappedKeys.has(p.productId) &&
        !(p.variantId && mappedKeys.has(p.variantId)) &&
        !(p.parentProductId && mappedKeys.has(p.parentProductId)),
    );
    if (unmapped.length === 0) return { imported: 0, queuedForReview: 0 };

    const needsReview = unmapped.filter((p) =>
      requiresAdminApprovalBeforeImport(p, mappedKeys),
    );
    const autoImportCandidates = unmapped.filter(
      (p) => !requiresAdminApprovalBeforeImport(p, mappedKeys),
    );

    let queuedForReview = 0;
    if (needsReview.length > 0) {
      queuedForReview = await supplierPendingImportService.queueNewSupplierProductsForReview(
        supplierId,
        needsReview,
        mappedKeys,
        usdRate,
        notifyApi ? { api: notifyApi } : undefined,
      );
    }

    let imported = 0;

    for (const remote of autoImportCandidates) {
      const existingByName = await prisma.product.findFirst({
        where: { name: remote.name },
        include: { supplierProductMapping: true },
      });

      if (existingByName?.supplierProductMapping) {
        const supplierProductKey = remote.parentProductId ?? remote.productId;
        const supplierVariantKey =
          remote.variantId && remote.variantId !== supplierProductKey
            ? remote.variantId
            : null;
        if (
          existingByName.supplierProductMapping.supplierProductKey !== supplierProductKey ||
          existingByName.supplierProductMapping.supplierVariantKey !== supplierVariantKey
        ) {
          await prisma.supplierProductMapping.update({
            where: { productId: existingByName.id },
            data: { supplierProductKey, supplierVariantKey, supplierId },
          });
        }
        await this.applyRemoteToLocalProduct(
          existingByName.id,
          existingByName,
          remote,
          usdRate,
        );
        continue;
      }

      if (existingByName) continue;

      if (
        isChargeOrVariantOfMappedParent(remote, mappedKeys) &&
        remote.parentProductId
      ) {
        const parentMappedProduct = await prisma.product.findFirst({
          where: {
            supplierProductMapping: {
              supplierId,
              supplierProductKey: remote.parentProductId,
            },
          },
        });
        if (parentMappedProduct) {
          await this.autoImportRemoteProduct(supplierId, remote, usdRate, {
            categoryId: parentMappedProduct.categoryId,
          });
          imported += 1;
          continue;
        }
      }

      const categoryId = await this.defaultImportCategoryId();
      if (categoryId == null) continue;

      await this.autoImportRemoteProduct(supplierId, remote, usdRate, { categoryId });
      imported += 1;
    }

    if (imported > 0) {
      console.log(`[CanbosoSync] Imported ${imported} new supplier product(s).`);
    }
    if (queuedForReview > 0) {
      console.log(
        `[CanbosoSync] Queued ${queuedForReview} new supplier product(s) for admin review.`,
      );
    }

    return { imported, queuedForReview };
  }

  private async autoImportRemoteProduct(
    supplierId: number,
    remote: CanbosoCatalogProduct,
    usdRate: number,
    placement: { categoryId: number; subCategoryId?: number | null },
  ): Promise<void> {
    const supplierCostUsd =
      remote.supplierPriceToman > 0 ? supplierCostUsdFromRemote(remote, usdRate) : 1;

    const { supplierProductKey, supplierVariantKey: variantKeyRaw } =
      supplierKeysFromRemote(remote);
    const supplierVariantKey = variantKeyRaw || null;

    const product = await prisma.product.create({
      data: {
        name: shortenSupplierProductName(remote.name, { brandName: remote.brandName }),
        price: convertUsdToToman(supplierCostUsd, usdRate),
        currency: "USD",
        usdPrice: supplierCostUsd,
        supplierCostUsd,
        categoryId: placement.categoryId,
        subCategoryId: placement.subCategoryId ?? null,
        deliveryType: DeliveryType.SUPPLIER_AUTO,
        isActive: remote.stock > 0 && remote.isAvailable,
        description: remote.description?.trim()
          ? sanitizeCustomerCatalogText(remote.description).trim()
          : "تحویل دیجیتال از طریق اشتراکینو",
        requiredFields: remote.requiredFields,
      },
    });

    await assignProductToShopHierarchy(product.id, remote.brandName ?? remote.name);

    await prisma.supplierProductMapping.create({
      data: {
        productId: product.id,
        supplierId,
        supplierProductKey,
        supplierVariantKey,
        isAutoPurchase: true,
      },
    });

    const { applyMarginPricingToProduct } = await import("../catalog/profitMarginService.js");
    await applyMarginPricingToProduct(product.id);
  }

  private async defaultImportCategoryId(): Promise<number | null> {
    let category = await prisma.category.findFirst({
      where: {
        OR: [
          { name: "🤖 ابزارهای هوش مصنوعی" },
          { name: "🤖 ابزارهای هوش مصنوعی | AI Tools" },
          { name: "🤖 ابزارهای AI" },
          { name: "اشتراک دیجیتال" },
          { name: { contains: "هوش مصنوعی" } },
        ],
        isActive: true,
      },
      orderBy: { id: "asc" },
    });

    if (!category) {
      category = await prisma.category.findFirst({
        where: { isActive: true },
        orderBy: { id: "asc" },
      });
    }
    return category?.id ?? null;
  }
}

export const canbosoSyncService = new CanbosoSyncService();
