import { DeliveryType, type Product } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import {
  settingsService,
  DEFAULT_PROFIT_MARGIN_PERCENT,
  DEFAULT_PROFIT_MARGIN_PERCENT_KEY,
} from "../settings/SettingsService";
import { exchangeRateService, convertUsdToToman } from "../exchangeRateService";
import { isStarsCatalog } from "./starsPricingService";
import { isInternalEshtrakinoFulfillment } from "./catalogAvailability";
import { canbosoAdapter } from "../suppliers/adapters/CanbosoAdapter";
import { SupplierManager } from "../suppliers/SupplierManager";

export type MarginPriceBreakdown = {
  supplierCostUsd: number;
  marginPercent: number;
  sellingUsd: number;
  sellingToman: number;
  usdRateIrt: number;
};

export function computeSellingUsd(
  supplierCostUsd: number,
  profitMarginPercent: number,
): number {
  const mult = 1 + profitMarginPercent / 100;
  return Math.round(supplierCostUsd * mult * 10_000) / 10_000;
}

export function isMarginPricedProduct(product: {
  name: string;
  supplierCostUsd?: number | null;
  category?: { name: string } | null;
  subCategory?: { name: string } | null;
}): boolean {
  if (isStarsCatalog(product.name)) return false;
  if (product.category && isStarsCatalog(product.category.name)) return false;
  if (product.subCategory && isStarsCatalog(product.subCategory.name)) return false;
  const cost = product.supplierCostUsd;
  return cost != null && Number.isFinite(cost) && cost > 0;
}

export async function getDefaultProfitMarginPercent(): Promise<number> {
  const value = await settingsService.getNumberSetting(
    DEFAULT_PROFIT_MARGIN_PERCENT_KEY,
    DEFAULT_PROFIT_MARGIN_PERCENT,
  );
  return value > 0 ? value : DEFAULT_PROFIT_MARGIN_PERCENT;
}

export async function resolveProfitMarginPercent(product: Product): Promise<number> {
  if (
    product.profitMarginPercent != null &&
    Number.isFinite(product.profitMarginPercent) &&
    product.profitMarginPercent > 0
  ) {
    return product.profitMarginPercent;
  }
  return getDefaultProfitMarginPercent();
}

export async function buildMarginPriceBreakdown(
  product: Product,
  options?: { usdRate?: number; marginPercent?: number },
): Promise<MarginPriceBreakdown | null> {
  if (!isMarginPricedProduct(product)) return null;

  const supplierCostUsd = product.supplierCostUsd!;
  const marginPercent = options?.marginPercent ?? (await resolveProfitMarginPercent(product));
  const usdRateIrt =
    options?.usdRate != null && options.usdRate > 0
      ? options.usdRate
      : await exchangeRateService.getUsdToTomanRate();

  const sellingUsd = computeSellingUsd(supplierCostUsd, marginPercent);
  const sellingToman = convertUsdToToman(sellingUsd, usdRateIrt);

  return {
    supplierCostUsd,
    marginPercent,
    sellingUsd,
    sellingToman,
    usdRateIrt,
  };
}

/** Persists computed selling USD/Toman from supplier cost + margin. */
export async function applyMarginPricingToProduct(productId: number): Promise<Product | null> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { category: true, subCategory: true },
  });
  if (!product || !isMarginPricedProduct(product)) return product;

  const breakdown = await buildMarginPriceBreakdown(product);
  if (!breakdown) return product;

  return prisma.product.update({
    where: { id: productId },
    data: {
      currency: "USD",
      usdPrice: breakdown.sellingUsd,
      price: breakdown.sellingToman,
    },
  });
}

export async function getEffectiveTomanFromMargin(product: Product): Promise<number | null> {
  if (!isMarginPricedProduct(product)) return null;
  const breakdown = await buildMarginPriceBreakdown(product);
  return breakdown?.sellingToman ?? null;
}

export async function fetchLiveSupplierStock(productId: number): Promise<number | null> {
  const mapping = await prisma.supplierProductMapping.findUnique({
    where: { productId },
    include: { supplier: true, product: { include: { category: true, subCategory: true } } },
  });
  if (!mapping?.product || isInternalEshtrakinoFulfillment(mapping.product)) {
    return null;
  }

  const {
    getCanbosoBulkCatalogForCheckout,
    findRemoteInBulkCatalog,
    getCanbosoBulkCatalog,
  } = await import("../suppliers/canboso/canbosoBulkCatalog.js");

  const snap = await getCanbosoBulkCatalogForCheckout("checkout-stock");
  let remote = findRemoteInBulkCatalog(
    snap.indexes,
    mapping.supplierProductKey,
    mapping.product.name,
  );
  if (!remote && mapping.supplierVariantKey) {
    remote = snap.indexes.byId.get(mapping.supplierVariantKey);
  }
  if (!remote) {
    const fresh = await getCanbosoBulkCatalog({
      maxAgeMs: 0,
      reason: "checkout-stock-fresh",
    });
    remote =
      findRemoteInBulkCatalog(
        fresh.indexes,
        mapping.supplierProductKey,
        mapping.product.name,
      ) ??
      (mapping.supplierVariantKey
        ? fresh.indexes.byId.get(mapping.supplierVariantKey)
        : undefined);
  }

  if (!remote) return null;
  if (!remote.isAvailable || remote.stock <= 0) return 0;
  return Math.max(0, Math.round(remote.stock));
}

export async function fetchLiveSupplierCostUsd(productId: number): Promise<number | null> {
  const mapping = await prisma.supplierProductMapping.findUnique({
    where: { productId },
    include: { supplier: true, product: { include: { category: true, subCategory: true } } },
  });
  if (!mapping?.product || isInternalEshtrakinoFulfillment(mapping.product)) {
    return null;
  }

  const apiKeyRow = await prisma.supplierApiKey.findFirst({
    where: {
      supplierId: mapping.supplierId,
      isActive: true,
      isValid: true,
    },
    orderBy: { lastValidatedAt: "desc" },
  });

  const apiKey = apiKeyRow
    ? SupplierManager.decryptKey(apiKeyRow.encryptedKey)
    : canbosoAdapter.resolveApiKey();

  const details = await canbosoAdapter.getProductDetails(
    apiKey,
    mapping.supplierProductKey,
  );
  if (!details?.variants?.length) return null;

  const variant = mapping.supplierVariantKey
    ? details.variants.find((v) => v.variantKey === mapping.supplierVariantKey)
    : details.variants[0];

  if (!variant || variant.price <= 0) return null;

  // Canboso catalog prices are in Toman; convert to USD using live rate when needed.
  const usdRate = await exchangeRateService.getUsdToTomanRate();
  if (variant.price > 50_000) {
    return Math.round((variant.price / usdRate) * 10_000) / 10_000;
  }

  return Math.round(variant.price * 100) / 100;
}

export async function refreshLiveSupplierCostAndPricing(productId: number): Promise<Product | null> {
  const liveCost = await fetchLiveSupplierCostUsd(productId);
  if (liveCost == null || liveCost <= 0) return null;

  await prisma.product.update({
    where: { id: productId },
    data: { supplierCostUsd: liveCost },
  });

  return applyMarginPricingToProduct(productId);
}

export async function updateProductProfitMargin(
  productId: number,
  profitMarginPercent: number,
): Promise<Product | null> {
  if (!Number.isFinite(profitMarginPercent) || profitMarginPercent <= 0) {
    throw new Error("Profit margin must be a positive number");
  }

  await prisma.product.update({
    where: { id: productId },
    data: { profitMarginPercent },
  });

  return applyMarginPricingToProduct(productId);
}

export async function isSupplierMarginAdminProduct(productId: number): Promise<boolean> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      category: true,
      subCategory: true,
      supplierProductMapping: { include: { supplier: true } },
    },
  });
  if (!product) return false;
  if (isInternalEshtrakinoFulfillment(product)) return false;
  if (product.supplierProductMapping) return true;
  return product.deliveryType === DeliveryType.SUPPLIER_AUTO;
}
