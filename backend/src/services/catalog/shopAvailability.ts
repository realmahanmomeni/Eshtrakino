import type { Product } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { lazyCacheService } from "./LazyCacheService";
import { CANBOSO_SHOP_BLOCKING_STALE_MS } from "../suppliers/canboso/canbosoCatalogTtl";
import { catalogService } from "./CatalogService";
import { isProductOutOfStock } from "./catalogAvailability";

/**
 * Stale-while-revalidate for shop browse: never block on Canboso except when DB sync is extremely stale.
 */
export async function ensureShopCatalogFresh(): Promise<void> {
  const last = await lazyCacheService.getLastCatalogSyncAt();
  const now = Date.now();
  const extremelyStale =
    last <= 0 || now - last > CANBOSO_SHOP_BLOCKING_STALE_MS;
  if (extremelyStale) {
    await lazyCacheService.refreshCatalogIfStale(false);
  } else {
    void lazyCacheService.refreshCatalogIfStale(true);
  }
}

export type ProductAvailabilityRow = {
  id: number;
  name: string;
  outOfStock: boolean;
  formattedPrice?: string;
};

export async function mapProductsAvailability(
  products: Array<Pick<Product, "id" | "name" | "isActive" | "deliveryType">>,
  priceById?: Map<number, string>,
): Promise<ProductAvailabilityRow[]> {
  const rows: ProductAvailabilityRow[] = [];
  for (const p of products) {
    rows.push({
      id: p.id,
      name: p.name,
      outOfStock: await isProductOutOfStock(p as Product),
      formattedPrice: priceById?.get(p.id),
    });
  }
  return rows;
}

export function filterAvailabilityRowsForShop(
  rows: ProductAvailabilityRow[],
  showOutOfStock: boolean,
): ProductAvailabilityRow[] {
  if (showOutOfStock) return rows;
  return rows.filter((r) => !r.outOfStock);
}

export async function subCategoryHasAnyProduct(subCategoryId: number): Promise<boolean> {
  const count = await prisma.product.count({ where: { subCategoryId } });
  return count > 0;
}

export async function categoryHasAnyProduct(categoryId: number): Promise<boolean> {
  const count = await prisma.product.count({ where: { categoryId } });
  return count > 0;
}

export async function subCategoryHasShopAvailableProduct(subCategoryId: number): Promise<boolean> {
  const products = await catalogService.listDisplayProductsBySubCategory(subCategoryId);
  for (const p of products) {
    if (!(await isProductOutOfStock(p))) return true;
  }
  return false;
}

export async function categoryHasShopAvailableProduct(categoryId: number): Promise<boolean> {
  const subs = await catalogService.listDisplaySubCategoriesByCategory(categoryId);
  for (const s of subs) {
    if (await subCategoryHasShopAvailableProduct(s.id)) return true;
  }
  const products = await catalogService.listDisplayProductsByCategory(categoryId);
  for (const p of products) {
    if (p.subCategoryId != null) continue;
    if (!(await isProductOutOfStock(p))) return true;
  }
  return false;
}

/** Delivery-type aware unavailable check (alias for browse/checkout). */
export async function isProductUnavailableForPurchase(product: Product): Promise<boolean> {
  return isProductOutOfStock(product);
}
