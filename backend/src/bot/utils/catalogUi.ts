import type { BotContext } from "../context";
import { catalogService } from "../../services/catalog/CatalogService";
import { pageContentService } from "../../services/cms/PageContentService";
import { invoiceService } from "../../services/invoices/InvoiceService";
import {
  categoriesKeyboard,
  categoryContentsKeyboard,
  shopRootMenuKeyboard,
} from "../keyboards/builders";
import { BannerAssets } from "../assets/banners";
import { safeEditMedia } from "./safeEdit";
import { isStarsCatalog, starsPricingService } from "../../services/catalog/starsPricingService";
import { exchangeRateService } from "../../services/exchangeRateService";
import {
  categoryFullyOutOfStock,
  isProductOutOfStock,
  subCategoryFullyOutOfStock,
} from "../../services/catalog/catalogAvailability";
import { emojiForLabel } from "../keyboards/grid";
import { lazyCacheService } from "../../services/catalog/LazyCacheService";

export function sanitizeCustomerCatalogText(text: string): string {
  return text
    .replace(/canboso/gi, "اشتراکینو")
    .replace(/کنبوسo/g, "اشتراکینو")
    .replace(/کنبوسو/g, "اشتراکینو");
}

export async function buildShopCategoryOutOfStockMap(
  categories: Array<{ id: number }>,
): Promise<Map<number, boolean>> {
  const map = new Map<number, boolean>();
  await Promise.all(
    categories.map(async (c) => {
      map.set(c.id, await categoryFullyOutOfStock(c.id));
    }),
  );
  return map;
}

export async function presentShopCategories(
  ctx: BotContext,
  layoutColumns: 1 | 2 = 2,
): Promise<void> {
  lazyCacheService.maybeRefreshOnBrowse();
  const categories = await catalogService.listShopCategories();
  const oosMap = await buildShopCategoryOutOfStockMap(categories);
  const kb = shopRootMenuKeyboard(categories, layoutColumns, { outOfStockByCategoryId: oosMap });

  await safeEditMedia(
    ctx,
    BannerAssets.shop,
    "🛍 *فروشگاه اشتراکینو*\n\nدسته مورد نظر را انتخاب کنید:",
    kb,
    "photo",
    { parse_mode: "Markdown" },
  );
}

export async function presentCategoryView(ctx: BotContext, categoryId: number): Promise<void> {
  lazyCacheService.maybeRefreshOnBrowse();
  const category = await catalogService.getCategory(categoryId);
  if (!category) {
    await safeEditMedia(
      ctx,
      BannerAssets.shop,
      "⚠️ *دسته بندی نامعتبر*",
      categoriesKeyboard(await catalogService.listShopCategories(), 2),
    );
    return;
  }

  const subCategories = await catalogService.listDisplaySubCategoriesByCategory(categoryId);
  const allProducts = await catalogService.listDisplayProductsByCategory(categoryId);
  const standaloneProducts = allProducts.filter((p) => p.subCategoryId == null);

  const user = await invoiceService.ensureUser(BigInt(ctx.from!.id));
  const pending = await invoiceService.getOpenInvoice(user.id);

  const subCategoriesUi = await Promise.all(
    subCategories.map(async (s) => ({
      id: s.id,
      name: s.name,
      outOfStock: await subCategoryFullyOutOfStock(s.id),
    })),
  );

  const standaloneUi = await Promise.all(
    standaloneProducts.map(async (p) => ({
      id: p.id,
      name: p.name,
      outOfStock: await isProductOutOfStock(p),
    })),
  );

  const catBanner = category.bannerUrl?.trim() || BannerAssets.category;
  const desc = category.description?.trim();
  const isStars = isStarsCatalog(category.name);
  let starsRateLine = "";
  if (isStars) {
    const unitUsdPrice = await starsPricingService.getStarsUnitUsdPrice();
    const usdRate = await exchangeRateService.getUsdToTomanRate();
    const oneStarToman = Math.round(unitUsdPrice * usdRate);
    starsRateLine = `⭐️ قیمت هر ۱ عدد استارز امروز: <b>${oneStarToman.toLocaleString("en-US")} تومان</b>`;
  }

  const title = isStars
    ? `✨ <b>${sanitizeCustomerCatalogText(category.name)}</b>`
    : `${emojiForLabel(category.name)} *${sanitizeCustomerCatalogText(category.name)}*`;
  const parse_mode = isStars ? "HTML" : "Markdown";

  const shopPage = await pageContentService.getPage("shop");
  const layoutColumns = shopPage.layoutColumns === 1 ? 1 : 2;

  const caption = [
    title,
    ...(desc ? ["", `📝 ${sanitizeCustomerCatalogText(desc)}`] : []),
    ...(starsRateLine ? ["", starsRateLine] : []),
    "",
    subCategoriesUi.length > 0
      ? "سرویس یا محصول مورد نظر را انتخاب کنید:"
      : "📦 محصول مورد نظر را انتخاب کنید:",
  ].join("\n");

  await safeEditMedia(
    ctx,
    catBanner,
    caption,
    categoryContentsKeyboard(subCategoriesUi, standaloneUi, {
      hasPendingInvoice: Boolean(pending),
      layoutColumns,
      categoryId,
    }),
    "photo",
    { parse_mode },
  );
}
