import type { Product } from "@prisma/client";
import { DeliveryType } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { inventoryService } from "../inventory/InventoryService";
import { isStarsCatalog } from "./starsPricingService";

export const OUT_OF_STOCK_ALERT =
  "⚠️ این محصول در حال حاضر ناموجود است. با زدن دکمه «بروزرسانی» می‌توانید آخرین وضعیت را بررسی کنید.";

/** Products fulfilled internally by اشتراکینو — never routed to external supplier APIs. */
export function isInternalEshtrakinoFulfillment(product: {
  name: string;
  deliveryType: DeliveryType;
  category?: { name: string } | null;
  subCategory?: { name: string } | null;
}): boolean {
  const cat = product.category?.name ?? "";
  const sub = product.subCategory?.name ?? "";
  const blob = `${cat} ${sub} ${product.name}`;

  if (isStarsCatalog(blob)) {
    return true;
  }

  if (/premium|پریمیوم|پرمیوم/i.test(blob)) {
    return true;
  }

  if (/خدمات تلگرام/i.test(cat) && (isStarsCatalog(product.name) || /premium|پریمیوم/i.test(product.name))) {
    return true;
  }

  return product.deliveryType === DeliveryType.MANUAL &&
    /premium|پریمیوم|استارز|stars/i.test(blob);
}

export function withOutOfStockPrefix(label: string, outOfStock: boolean): string {
  const trimmed = label.trim();
  if (!outOfStock) return trimmed;
  if (trimmed.startsWith("❌")) return trimmed;
  return `❌ ${trimmed}`;
}

export async function isProductOutOfStock(product: Product): Promise<boolean> {
  if (!product.isActive) return true;

  if (product.deliveryType === DeliveryType.READY) {
    const available = await inventoryService.countAvailable(product.id);
    return available <= 0;
  }

  return false;
}

export async function isProductOutOfStockById(productId: number): Promise<boolean> {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) return true;
  return isProductOutOfStock(product);
}

export async function categoryFullyOutOfStock(categoryId: number): Promise<boolean> {
  const products = await prisma.product.findMany({
    where: { categoryId },
    select: { id: true, isActive: true, deliveryType: true },
  });
  if (products.length === 0) return false;

  for (const p of products) {
    const oos = await isProductOutOfStock(p as Product);
    if (!oos) return false;
  }
  return true;
}

export async function subCategoryFullyOutOfStock(subCategoryId: number): Promise<boolean> {
  const products = await prisma.product.findMany({
    where: { subCategoryId },
    select: { id: true, isActive: true, deliveryType: true },
  });
  if (products.length === 0) return false;

  for (const p of products) {
    const oos = await isProductOutOfStock(p as Product);
    if (!oos) return false;
  }
  return true;
}
