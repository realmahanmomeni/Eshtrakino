import type { Product } from "@prisma/client";
import { exchangeRateService } from "../exchangeRateService";
import {
  starsPerStarTomanFromPackPrices,
  syncStarsPackTomanPrices,
  type StarsPackPriceRow,
} from "./starsPricingService";

/** Refresh Stars Toman prices from stored USD, then derive header per-star from pack rows. */
export async function resolveStarsHeaderUnitToman(
  products: Array<Pick<Product, "name" | "price" | "usdPrice">>,
): Promise<number> {
  await syncStarsPackTomanPrices();
  const rate = await exchangeRateService.getUsdToTomanRate();
  const rows: StarsPackPriceRow[] = products.map((p) => ({
    name: p.name,
    price: Math.round(Number(p.price)),
    usdPrice: p.usdPrice != null ? Number(p.usdPrice) : null,
  }));
  const fromPacks = starsPerStarTomanFromPackPrices(rows, rate);
  return fromPacks;
}
