import { DeliveryType } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { settingsService } from "../settings/SettingsService";
import { isStarsCatalog } from "./starsPricingService";
import { canbosoAdapter } from "../suppliers/adapters/CanbosoAdapter";
import { env } from "../../config/env";
import {
  SHOP_CATEGORY_SPECS,
  assignProductToShopHierarchy,
  applyBrandTaxonomyMigration,
  ensureShopCategoriesExist,
  normalizeSupplierProductName,
  repairAllProductSubCategories,
  type ShopCategorySpec,
} from "./brandCatalog";

export const WHITE_LABEL_CATALOG_V1_KEY = "WHITE_LABEL_CATALOG_V1_DONE";

export type { ShopCategorySpec };
export { SHOP_CATEGORY_SPECS };

const SHOP_CATEGORY_ORDER = SHOP_CATEGORY_SPECS.map((c) => c.name);

async function fixTelegramInternalProducts(telegramCategoryId: number): Promise<void> {
  const products = await prisma.product.findMany({
    where: { categoryId: telegramCategoryId },
  });

  for (const product of products) {
    const stars = isStarsCatalog(product.name);
    const premium = /premium|پریمیوم|پرمیوم/i.test(product.name);

    if (stars) {
      await prisma.product.update({
        where: { id: product.id },
        data: {
          deliveryType: DeliveryType.MANUAL,
          description: "خرید استارز تلگرام با نرخ روز اشتراکینو",
          isActive: true,
        },
      });
      await prisma.supplierProductMapping.deleteMany({ where: { productId: product.id } });
      await assignProductToShopHierarchy(product.id, product.name);
      continue;
    }

    if (premium) {
      await prisma.product.update({
        where: { id: product.id },
        data: {
          deliveryType: DeliveryType.MANUAL,
          description: "تحویل تلگرام پریمیوم توسط تیم اشتراکینو",
          isActive: true,
        },
      });
      await prisma.supplierProductMapping.deleteMany({ where: { productId: product.id } });
      await assignProductToShopHierarchy(product.id, product.name);
    }
  }
}

async function ensureGeminiChatGptSupplierRouting(): Promise<void> {
  if (!env.CANBOSO_API_KEY?.trim()) return;

  const targets = await prisma.product.findMany({
    where: {
      OR: [
        { name: { contains: "gemini", mode: "insensitive" } },
        { name: { contains: "جمنای" } },
        { name: { contains: "chatgpt", mode: "insensitive" } },
        { name: { contains: "ChatGPT" } },
        { name: { contains: "google one", mode: "insensitive" } },
        { name: { contains: "گوگل وان" } },
      ],
    },
  });

  const supplier = await prisma.supplier.findFirst({
    where: {
      OR: [
        { name: "Canboso" },
        { name: { contains: "canboso", mode: "insensitive" } },
      ],
    },
  });
  if (!supplier) return;

  let remoteProducts: Awaited<ReturnType<typeof canbosoAdapter.getProducts>> = [];
  try {
    remoteProducts = await canbosoAdapter.getProducts();
  } catch {
    return;
  }

  const byName = new Map(
    remoteProducts.map((p) => [normalizeSupplierProductName(p.name), p]),
  );

  for (const product of targets) {
    await prisma.product.update({
      where: { id: product.id },
      data: {
        deliveryType: DeliveryType.SUPPLIER_AUTO,
        description: product.description?.includes("اشتراکینو")
          ? product.description
          : "تحویل دیجیتال از طریق اشتراکینو",
      },
    });

    const remote =
      byName.get(normalizeSupplierProductName(product.name)) ??
      remoteProducts.find(
        (r) =>
          normalizeSupplierProductName(r.name).includes(
            normalizeSupplierProductName(product.name).slice(0, 12),
          ) ||
          normalizeSupplierProductName(product.name).includes(
            normalizeSupplierProductName(r.name).slice(0, 12),
          ),
      );

    if (!remote) continue;

    const mapping = await prisma.supplierProductMapping.findUnique({
      where: { productId: product.id },
    });

    if (mapping) {
      if (mapping.supplierProductKey !== remote.productId) {
        await prisma.supplierProductMapping.update({
          where: { productId: product.id },
          data: { supplierProductKey: remote.productId },
        });
      }
    } else {
      await prisma.supplierProductMapping.create({
        data: {
          productId: product.id,
          supplierId: supplier.id,
          supplierProductKey: remote.productId,
          isAutoPurchase: true,
        },
      });
    }
  }
}

/**
 * Idempotent: shop categories, brand subcategories, internal Telegram fulfillment, supplier sync.
 */
export async function ensureWhiteLabelCatalog(): Promise<void> {
  const done = await settingsService.getBoolSetting(WHITE_LABEL_CATALOG_V1_KEY, false);

  const taxonomyResult = await applyBrandTaxonomyMigration();
  console.log(
    `[BrandCatalog] Taxonomy migration: purged=${taxonomyResult.purged}, reassigned=${taxonomyResult.reassigned}, emptySubs=${taxonomyResult.deletedEmptySubs}`,
  );

  const telegramCat = await prisma.category.findFirst({
    where: {
      OR: [
        { name: "🚀 خدمات تلگرام" },
        { name: "🚀 خدمات تلگرام | Telegram" },
      ],
    },
  });

  if (telegramCat) {
    const legacyStars = await prisma.category.findMany({
      where: {
        OR: [
          { name: { contains: "استارز" } },
          { name: { contains: "Stars", mode: "insensitive" } },
        ],
        NOT: { id: telegramCat.id },
      },
    });
    const legacyPremium = await prisma.category.findMany({
      where: {
        OR: [
          { name: { contains: "پریمیوم" } },
          { name: { contains: "Premium", mode: "insensitive" } },
        ],
        NOT: { id: telegramCat.id },
      },
    });

    for (const old of [...legacyStars, ...legacyPremium]) {
      await prisma.product.updateMany({
        where: { categoryId: old.id },
        data: { categoryId: telegramCat.id },
      });
      await prisma.category.update({
        where: { id: old.id },
        data: { isActive: false },
      });
    }

    await fixTelegramInternalProducts(telegramCat.id);
  }

  await ensureGeminiChatGptSupplierRouting();
  await repairAllProductSubCategories();

  const { canbosoSyncService } = await import("../suppliers/CanbosoSyncService.js");
  await canbosoSyncService.syncProducts();

  if (!done) {
    await settingsService.setBoolSetting(WHITE_LABEL_CATALOG_V1_KEY, true);
    console.log("[WhiteLabelCatalog] Shop taxonomy v1 applied.");
  }
}

export function sortShopCategories<T extends { name: string }>(categories: T[]): T[] {
  const order = new Map(SHOP_CATEGORY_ORDER.map((name, idx) => [name, idx]));
  return [...categories].sort((a, b) => {
    const ai = order.get(a.name) ?? 999;
    const bi = order.get(b.name) ?? 999;
    if (ai !== bi) return ai - bi;
    return a.name.localeCompare(b.name);
  });
}
