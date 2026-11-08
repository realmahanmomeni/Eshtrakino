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
import type { CanbosoCatalogProduct } from "../suppliers/adapters/CanbosoAdapter";
import { isCanbosoRemoteInStock } from "../suppliers/canboso/canbosoStock";
import { supplierCostUsdFromRemote } from "../suppliers/canbosoCost";

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

/** E2E/dry-run only: set `E2E_MOCK_SUPPLIER_STOCK` to `0`, `5`, or `null` to skip Canboso HTTP. */
function readE2eMockSupplierStock(): number | null | undefined {
  const raw = process.env.E2E_MOCK_SUPPLIER_STOCK;
  if (raw === undefined || raw.trim() === "") return undefined;
  if (raw.trim().toLowerCase() === "null") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

type MappedCanbosoRemote = {
  mapping: {
    supplierProductKey: string;
    supplierVariantKey: string | null;
    product: { name: string };
  };
  remote: CanbosoCatalogProduct;
};

async function fetchMappedCanbosoRemoteProduct(
  productId: number,
  reason: string,
): Promise<MappedCanbosoRemote | null> {
  const mapping = await prisma.supplierProductMapping.findUnique({
    where: { productId },
    include: {
      supplier: true,
      product: {
        include: {
          category: true,
          subCategory: true,
          supplierProductMapping: true,
        },
      },
    },
  });
  if (!mapping?.product || isInternalEshtrakinoFulfillment(mapping.product)) {
    return null;
  }

  const {
    getCanbosoBulkCatalogForCheckout,
    findRemoteInBulkCatalog,
    getCanbosoBulkCatalog,
  } = await import("../suppliers/canboso/canbosoBulkCatalog.js");

  const snap = await getCanbosoBulkCatalogForCheckout(reason);
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
      reason: `${reason}-fresh`,
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
  return { mapping, remote };
}

type LiveSupplierStockState = {
  /** null when the supplier omitted the count, or the SKU is missing from the catalog. */
  stock: number | null;
  /** True when the supplier still lists the SKU as purchasable (count may be unknown). */
  inStock: boolean;
};

async function readLiveSupplierStockState(productId: number): Promise<LiveSupplierStockState> {
  const e2eMock = readE2eMockSupplierStock();
  if (e2eMock !== undefined) {
    return { stock: e2eMock, inStock: e2eMock != null && e2eMock > 0 };
  }

  const resolved = await fetchMappedCanbosoRemoteProduct(productId, "checkout-stock");
  if (!resolved) return { stock: null, inStock: false };

  const { remote } = resolved;
  if (remote.stock == null) {
    return {
      stock: remote.isAvailable ? null : 0,
      inStock: remote.isAvailable,
    };
  }

  const stock = Math.max(0, Math.round(remote.stock));
  const inStock = isCanbosoRemoteInStock({ stock, isAvailable: remote.isAvailable });
  return { stock: inStock ? stock : 0, inStock };
}

export async function fetchLiveSupplierStock(productId: number): Promise<number | null> {
  return (await readLiveSupplierStockState(productId)).stock;
}

/**
 * Admin product card. Returns the supplier's numeric count, or null when that
 * count was not reported (`stock=null` in sync logs). Never invents 1.
 */
export async function fetchSupplierStockCountForAdmin(productId: number): Promise<number | null> {
  const e2eMock = readE2eMockSupplierStock();
  if (e2eMock !== undefined) return e2eMock;

  const resolved = await fetchMappedCanbosoRemoteProduct(productId, "admin-stock");
  if (!resolved || resolved.remote.stock == null || !Number.isFinite(resolved.remote.stock)) {
    return null;
  }
  return Math.max(0, Math.round(resolved.remote.stock));
}

/** Whether turning manual fallback off should leave the product active. */
export async function isLiveSupplierInStock(productId: number): Promise<boolean> {
  return (await readLiveSupplierStockState(productId)).inStock;
}

/** Same USD extraction as `CanbosoSyncService` (`supplierCostUsdFromRemote` + bulk catalog). */
export async function fetchLiveSupplierCostUsd(productId: number): Promise<number | null> {
  if (readE2eMockSupplierStock() !== undefined) {
    return null;
  }

  const resolved = await fetchMappedCanbosoRemoteProduct(productId, "checkout-cost");
  if (!resolved) return null;

  const usdRate = await exchangeRateService.getUsdToTomanRate();
  const costUsd = supplierCostUsdFromRemote(resolved.remote, usdRate);
  return costUsd > 0 ? costUsd : null;
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
