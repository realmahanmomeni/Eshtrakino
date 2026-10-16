import { prisma } from "../../lib/prisma";
import {
  settingsService,
  STARS_UNIT_USD_PRICE_KEY,
  DEFAULT_STARS_UNIT_USD_PRICE,
} from "../settings/SettingsService";
import { exchangeRateService, convertUsdToToman } from "../exchangeRateService";

export { STARS_UNIT_USD_PRICE_KEY, DEFAULT_STARS_UNIT_USD_PRICE };

export interface StarsRecalculateItem {
  id: number;
  name: string;
  starCount: number;
  usdPrice: number;
  tomanPrice: number;
}

export interface StarsRecalculateResult {
  unitUsdPrice: number;
  usdToTomanRate: number;
  count: number;
  items: StarsRecalculateItem[];
}

/**
 * Normalizes Persian and Arabic-Indic numerals to standard ASCII digits (0-9).
 */
export function normalizeNumerals(str: string): string {
  return str
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
}

/**
 * Extracts the star quantity from a product name or label.
 * Examples:
 *   "50 استارز" -> 50
 *   "۵۰ استارز" -> 50
 *   "100 Stars" -> 100
 *   "استارز تلگرام (250 عدد)" -> 250
 *   "بسته 500 تایی استارز" -> 500
 */
export function extractStarCount(productName: string): number | null {
  if (!productName || typeof productName !== "string") return null;

  const normalized = normalizeNumerals(productName.trim());

  // Pattern 1: Number immediately preceding "استارز" / "استار" / "stars"
  const m1 = /(?:^|\D)(\d+)\s*(?:استارز|استار|stars?)/i.exec(normalized);
  if (m1) {
    const val = Number(m1[1]);
    if (Number.isFinite(val) && val > 0) return val;
  }

  // Pattern 2: "استارز" / "stars" followed by quantity (e.g. "استارز 50" or "استارز (50 عدد)")
  const m2 = /(?:استارز|استار|stars?)\s*\(?\s*(\d+)/i.exec(normalized);
  if (m2) {
    const val = Number(m2[1]);
    if (Number.isFinite(val) && val > 0) return val;
  }

  // Pattern 3: Number followed by "تایی" or "عدد" (pack size)
  const m3 = /(?:^|\D)(\d+)\s*(?:تایی|عدد)/i.exec(normalized);
  if (m3) {
    const val = Number(m3[1]);
    if (Number.isFinite(val) && val > 0) return val;
  }

  // Pattern 4: Fallback for any standalone positive integer in the string
  const m4 = /(?:^|\D)(\d+)(?:\D|$)/.exec(normalized);
  if (m4) {
    const val = Number(m4[1]);
    if (Number.isFinite(val) && val > 0) return val;
  }

  return null;
}

/**
 * Checks if a name indicates a Telegram Stars category, subcategory, or product.
 */
export function isStarsCatalog(name?: string | null): boolean {
  if (!name || typeof name !== "string") return false;
  return /(?:استارز|استار|stars?)/i.test(name.trim());
}

/**
 * Per-star Toman shown in Stars list header — matches pack pricing (nearest-1 000 Toman rounding on packs).
 * Uses the same formula as recalculateStarsProducts: convertUsdToToman(starCount × unitUsd, rate) / starCount.
 */
export function effectiveStarsUnitToman(
  unitUsdPrice: number,
  usdToTomanRate: number,
  referenceStarCount = 1000,
): number {
  if (!Number.isFinite(unitUsdPrice) || unitUsdPrice <= 0) return 0;
  if (!Number.isFinite(usdToTomanRate) || usdToTomanRate <= 0) return 0;
  const packUsd = unitUsdPrice * referenceStarCount;
  const packToman = convertUsdToToman(packUsd, usdToTomanRate);
  return Math.round(packToman / referenceStarCount);
}

export type StarsPackPriceRow = {
  name: string;
  price: number;
  usdPrice?: number | null;
};

/** Per-star Toman derived from stored pack rows (matches button prices after sync). */
export function starsPerStarTomanFromPackPrices(
  packs: StarsPackPriceRow[],
  usdToTomanRate: number,
): number {
  let best: { starCount: number; perStar: number } | null = null;
  for (const pack of packs) {
    const starCount = extractStarCount(pack.name);
    if (!starCount || starCount <= 0) continue;
    const packToman =
      Number(pack.price) > 0
        ? Math.round(Number(pack.price))
        : pack.usdPrice != null && pack.usdPrice > 0
          ? convertUsdToToman(Number(pack.usdPrice), usdToTomanRate)
          : 0;
    if (packToman <= 0) continue;
    const perStar = Math.round(packToman / starCount);
    if (!best || starCount >= best.starCount) {
      best = { starCount, perStar };
    }
  }
  return best?.perStar ?? 0;
}

/**
 * Recompute Toman `price` from stored `usdPrice` for Telegram Stars packs (no Canboso).
 */
export async function syncStarsPackTomanPrices(): Promise<number> {
  const usdRate = await exchangeRateService.getUsdToTomanRate();
  const products = await prisma.product.findMany({
    where: {
      usdPrice: { gt: 0 },
      OR: [
        { name: { contains: "استارز" } },
        { name: { contains: "استار" } },
        { subCategory: { name: { contains: "استارز" } } },
        { subCategory: { name: { contains: "Stars" } } },
        { category: { name: { contains: "استارز" } } },
        { category: { name: { contains: "Stars" } } },
      ],
    },
    select: { id: true, name: true, usdPrice: true, price: true },
  });

  let updated = 0;
  for (const p of products) {
    const starCount = extractStarCount(p.name);
    if (!starCount) continue;
    const usd = Number(p.usdPrice);
    if (!Number.isFinite(usd) || usd <= 0) continue;
    const newToman = convertUsdToToman(usd, usdRate);
    if (Math.round(Number(p.price)) !== newToman) {
      await prisma.product.update({
        where: { id: p.id },
        data: { price: newToman },
      });
      updated += 1;
    }
  }
  return updated;
}

export class StarsPricingService {
  /**
   * Retrieves the current base USD rate per 1 Star from SystemSetting.
   */
  async getStarsUnitUsdPrice(): Promise<number> {
    const rate = await settingsService.getNumberSetting(
      STARS_UNIT_USD_PRICE_KEY,
      DEFAULT_STARS_UNIT_USD_PRICE,
    );
    return rate > 0 ? rate : DEFAULT_STARS_UNIT_USD_PRICE;
  }

  /**
   * Persists the base USD rate per 1 Star in SystemSetting.
   */
  async setStarsUnitUsdPrice(price: number): Promise<void> {
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`Invalid Stars unit USD price: ${price}`);
    }
    await settingsService.setSetting(STARS_UNIT_USD_PRICE_KEY, String(price));
  }

  /**
   * Recalculates both `usdPrice` and `price` (Toman) for all active Telegram Stars products.
   *
   * @param unitUsdPrice Optional new rate to save and apply. If not supplied, uses saved rate.
   */
  async recalculateStarsProducts(unitUsdPrice?: number): Promise<StarsRecalculateResult> {
    let effectiveUnitUsdPrice: number;

    if (unitUsdPrice != null && Number.isFinite(unitUsdPrice) && unitUsdPrice > 0) {
      await this.setStarsUnitUsdPrice(unitUsdPrice);
      effectiveUnitUsdPrice = unitUsdPrice;
    } else {
      effectiveUnitUsdPrice = await this.getStarsUnitUsdPrice();
    }

    // Get live exchange rate (Tomans per USD)
    const usdRate = await exchangeRateService.getUsdToTomanRate();

    // Fetch all active products with their category and subcategory
    const activeProducts = await prisma.product.findMany({
      where: {
        isActive: true,
        category: { isActive: true },
      },
      include: {
        category: true,
        subCategory: true,
      },
      orderBy: { id: "asc" },
    });

    // Filter products that belong to Stars (via product name, subcategory name, or category name)
    const starsProducts = activeProducts.filter((p) => {
      const matchName = isStarsCatalog(p.name);
      const matchSub = isStarsCatalog(p.subCategory?.name);
      const matchCat = isStarsCatalog(p.category?.name);
      return matchName || matchSub || matchCat;
    });

    const updatedItems: StarsRecalculateItem[] = [];

    for (const product of starsProducts) {
      const starCount = extractStarCount(product.name);
      if (starCount == null || starCount <= 0) {
        continue;
      }

      // Compute new USD price: starCount * unitUsdPrice (rounded cleanly to 4 decimal places)
      const newUsdPrice = Number((starCount * effectiveUnitUsdPrice).toFixed(4));

      // Compute new Toman price via exchangeRateService (rounded to nearest 1,000 Tomans)
      const newTomanPrice = convertUsdToToman(newUsdPrice, usdRate);

      await prisma.product.update({
        where: { id: product.id },
        data: {
          usdPrice: newUsdPrice,
          price: newTomanPrice,
        },
      });

      updatedItems.push({
        id: product.id,
        name: product.name,
        starCount,
        usdPrice: newUsdPrice,
        tomanPrice: newTomanPrice,
      });
    }

    // Sort items by Star count ascending for clean display
    updatedItems.sort((a, b) => a.starCount - b.starCount);

    return {
      unitUsdPrice: effectiveUnitUsdPrice,
      usdToTomanRate: usdRate,
      count: updatedItems.length,
      items: updatedItems,
    };
  }
}

export const starsPricingService = new StarsPricingService();

/**
 * Convenience export for recalculating Stars products.
 */
export async function recalculateStarsProducts(
  unitUsdPrice?: number,
): Promise<StarsRecalculateResult> {
  return starsPricingService.recalculateStarsProducts(unitUsdPrice);
}
