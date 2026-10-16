import type { Product } from "@prisma/client";
import { DeliveryType } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { inventoryService } from "../inventory/InventoryService";
import { isStarsCatalog } from "./starsPricingService";

export const OUT_OF_STOCK_ALERT =
  "⚠️ این محصول در حال حاضر ناموجود است. با زدن دکمه «بروزرسانی» می‌توانید آخرین وضعیت را بررسی کنید.";

/** Category/subcategory for Telegram Premium & Stars (manual Eshtrakino fulfillment). */
export function isTelegramServicesCategory(
  category?: { name: string } | null,
  subCategory?: { name: string } | null,
): boolean {
  const cat = category?.name ?? "";
  const sub = subCategory?.name ?? "";
  return (
    /(?:تلگرام|telegram)/i.test(cat) ||
    /(?:تلگرام|telegram)/i.test(sub) ||
    /خدمات\s*تلگرام/i.test(cat)
  );
}

function isTelegramPremiumProductName(name: string): boolean {
  return /premium|پریمیوم|پرمیوم|پریموم/i.test(name);
}

/**
 * Products fulfilled internally by اشتراکینو — Telegram Premium & Stars in the Telegram services category only.
 * Supplier-mapped products outside that category always use Canboso.
 */
export function isInternalEshtrakinoFulfillment(product: {
  name: string;
  deliveryType: DeliveryType;
  category?: { name: string } | null;
  subCategory?: { name: string } | null;
  supplierProductMapping?: { id: number } | null;
}): boolean {
  const inTelegramServices = isTelegramServicesCategory(product.category, product.subCategory);

  if (product.supplierProductMapping && !inTelegramServices) {
    return false;
  }

  if (!inTelegramServices) {
    return false;
  }

  if (isStarsCatalog(product.name)) {
    return true;
  }

  return isTelegramPremiumProductName(product.name);
}

export function withOutOfStockPrefix(label: string, outOfStock: boolean): string {
  const trimmed = label.trim();
  if (!outOfStock) return trimmed;
  if (trimmed.startsWith("❌")) return trimmed;
  return `❌ ${trimmed}`;
}

export async function isProductOutOfStock(product: Product): Promise<boolean> {
  if (!product.isActive) return true;

  if (
    product.deliveryType === DeliveryType.READY ||
    product.deliveryType === DeliveryType.USER_CHOICE
  ) {
    const available = await inventoryService.countAvailable(product.id);
    return available <= 0;
  }

  if (product.deliveryType === DeliveryType.SUPPLIER_AUTO) {
    return false;
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
