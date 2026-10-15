import { DeliveryType } from "@prisma/client";
import { polishCustomerProductTitle } from "../catalog/productTitlePolish";
import { prisma } from "../../lib/prisma";
import { isInternalEshtrakinoFulfillment } from "../catalog/catalogAvailability";
import {
  assignProductToShopHierarchy,
  normalizeSupplierProductName,
  repairAllProductSubCategories,
} from "../catalog/catalogHierarchy";
import { env } from "../../config/env";
import { exchangeRateService, convertUsdToToman } from "../exchangeRateService";
import {
  canbosoAdapter,
  extractSupplierCostUsdFromRow,
  type CanbosoCatalogProduct,
} from "./adapters/CanbosoAdapter";
import { SupplierManager } from "./SupplierManager";
import { sanitizeCustomerCatalogText } from "../../bot/utils/catalogUi";

export const CANBOSO_SUPPLIER_NAME = "Canboso";

const BULK_CATALOG_TTL_MS = 45_000;

type BulkCatalogCache = {
  fetchedAt: number;
  remoteProducts: CanbosoCatalogProduct[];
  indexes: RemoteIndexes;
};

let bulkCatalogCache: BulkCatalogCache | null = null;

type RemoteIndexes = {
  byId: Map<string, CanbosoCatalogProduct>;
  byName: Map<string, CanbosoCatalogProduct>;
};

function buildRemoteIndexes(remoteProducts: CanbosoCatalogProduct[]): RemoteIndexes {
  const byId = new Map<string, CanbosoCatalogProduct>();
  const byName = new Map<string, CanbosoCatalogProduct>();
  for (const p of remoteProducts) {
    byId.set(p.productId, p);
    byId.set(String(p.productId), p);
    if (p.variantId) {
      byId.set(p.variantId, p);
      byId.set(String(p.variantId), p);
    }
    if (p.parentProductId && p.variantId) {
      byId.set(`${p.parentProductId}:${p.variantId}`, p);
    }
    byName.set(normalizeSupplierProductName(p.name), p);
    if (p.brandName) {
      byName.set(normalizeSupplierProductName(p.brandName), p);
    }
  }
  return { byId, byName };
}

function findRemoteProduct(
  indexes: RemoteIndexes,
  supplierProductKey: string,
  localName: string,
): CanbosoCatalogProduct | undefined {
  const byKey = indexes.byId.get(supplierProductKey);
  if (byKey) return byKey;

  const normName = normalizeSupplierProductName(localName);
  const byExactName = indexes.byName.get(normName);
  if (byExactName) return byExactName;

  for (const remote of indexes.byName.values()) {
    const rName = normalizeSupplierProductName(remote.name);
    if (rName.includes(normName) || normName.includes(rName)) {
      return remote;
    }
  }

  return undefined;
}

function supplierCostUsdFromRemote(
  remote: CanbosoCatalogProduct,
  usdRate: number,
): number {
  const row =
    remote.raw && typeof remote.raw === "object"
      ? (remote.raw as Record<string, unknown>)
      : {};
  const { costUsd, priceKey } = extractSupplierCostUsdFromRow(row, usdRate);
  if (costUsd > 0) {
    return costUsd;
  }
  if (remote.supplierCostUsd > 0) {
    return remote.supplierCostUsd;
  }
  console.warn(
    `[CanbosoSync] Missing cost for product ${remote.productId} - ${remote.name}`,
    { priceKey, raw: row },
  );
  return 1;
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
  }): Promise<{ updated: number; imported: number }> {
    if (!env.CANBOSO_API_KEY?.trim()) {
      console.warn("[CanbosoSync] CANBOSO_API_KEY missing; skipping bulk sync.");
      return { updated: 0, imported: 0 };
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
    const now = Date.now();
    if (
      !force &&
      bulkCatalogCache &&
      now - bulkCatalogCache.fetchedAt < BULK_CATALOG_TTL_MS
    ) {
      /* use cache */
    } else {
      try {
        const remoteProducts = await canbosoAdapter.getProducts();
        bulkCatalogCache = {
          fetchedAt: now,
          remoteProducts,
          indexes: buildRemoteIndexes(remoteProducts),
        };
      } catch (err) {
        console.error("[CanbosoSync] Bulk catalog fetch failed:", err);
        if (!bulkCatalogCache) {
          return { updated: 0, imported: 0 };
        }
      }
    }

    const cache = bulkCatalogCache!;
    const { indexes, remoteProducts } = cache;
    let updated = 0;

    const mappings = await prisma.supplierProductMapping.findMany({
      where: { supplierId },
      include: { product: { include: { category: true, subCategory: true } } },
    });

    const usdRate = await exchangeRateService.getUsdToTomanRate();

    for (const mapping of mappings) {
      if (isInternalEshtrakinoFulfillment(mapping.product)) {
        continue;
      }

      let remote = findRemoteProduct(
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
        continue;
      }

      updated += await this.applyRemoteToLocalProduct(
        mapping.productId,
        mapping.product,
        remote,
        usdRate,
      );
    }

    const imported = await this.importUnmappedCanbosoProducts(
      supplierId,
      remoteProducts,
      mappings,
    );

    try {
      const balance = await canbosoAdapter.getBalance();
      await prisma.supplierApiKey.updateMany({
        where: { supplierId, isActive: true },
        data: { lastBalance: balance.balance, lastValidatedAt: new Date() },
      });
    } catch {
      /* non-fatal */
    }

    return { updated, imported };
  }

  /** Idempotent sync — delegates to single-request bulk catalog (anti-429). */
  async syncProductAvailability(): Promise<{ updated: number; imported: number }> {
    return this.syncAllSupplierProductsBulk();
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
  ): Promise<number> {
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
    if (unmapped.length === 0) return 0;

    let imported = 0;
    const usdRate = await exchangeRateService.getUsdToTomanRate();

    for (const remote of unmapped) {
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

      const categoryId = await this.defaultImportCategoryId();
      if (categoryId == null) continue;

      const supplierCostUsd =
        remote.supplierPriceToman > 0
          ? supplierCostUsdFromRemote(remote, usdRate)
          : 1;

      const product = await prisma.product.create({
        data: {
          name: polishCustomerProductTitle(remote.brandName ?? remote.name),
          price: convertUsdToToman(supplierCostUsd, usdRate),
          currency: "USD",
          usdPrice: supplierCostUsd,
          supplierCostUsd,
          categoryId,
          deliveryType: DeliveryType.SUPPLIER_AUTO,
          isActive: remote.stock > 0 && remote.isAvailable,
          description: remote.description?.trim()
            ? sanitizeCustomerCatalogText(remote.description).trim()
            : "تحویل دیجیتال از طریق اشتراکینو",
          requiredFields: remote.requiredFields,
        },
      });

      await assignProductToShopHierarchy(product.id, remote.brandName ?? remote.name);

      const supplierProductKey = remote.parentProductId ?? remote.productId;
      const supplierVariantKey =
        remote.variantId && remote.variantId !== supplierProductKey
          ? remote.variantId
          : null;

      await prisma.supplierProductMapping.create({
        data: {
          productId: product.id,
          supplierId,
          supplierProductKey,
          supplierVariantKey,
          isAutoPurchase: true,
        },
      });

      const { applyMarginPricingToProduct } = await import(
        "../catalog/profitMarginService.js"
      );
      await applyMarginPricingToProduct(product.id);
      imported += 1;
    }

    if (imported > 0) {
      console.log(`[CanbosoSync] Imported ${imported} new supplier product(s).`);
    }

    return imported;
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
