import type { Product } from "@prisma/client";
import { lazyCacheService } from "./LazyCacheService";
import { catalogService } from "./CatalogService";
import { isProductOutOfStock } from "./catalogAvailability";

/** Refresh supplier stock/active flags when catalog sync TTL expired (blocks until done). */
export async function ensureShopCatalogFresh(): Promise<void> {
  await lazyCacheService.refreshCatalogIfStale(false);
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
