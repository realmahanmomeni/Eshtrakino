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
import {
  effectiveStarsUnitToman,
  isStarsCatalog,
  starsPricingService,
} from "../../services/catalog/starsPricingService";
import { exchangeRateService } from "../../services/exchangeRateService";
import {
  categoryFullyOutOfStock,
  subCategoryFullyOutOfStock,
} from "../../services/catalog/catalogAvailability";
import {
  categoryHasShopAvailableProduct,
  ensureShopCatalogFresh,
  filterAvailabilityRowsForShop,
  mapProductsAvailability,
  subCategoryHasShopAvailableProduct,
} from "../../services/catalog/shopAvailability";
import { emojiForLabel } from "../keyboards/grid";
import { hasAnyAdminAccess } from "../admin/rbac";
import { resolveShopShowOutOfStock } from "./shopBrowse";

export function sanitizeCustomerCatalogText(text: string): string {
  return text
    .replace(/canboso/gi, "اشتراکینو")
    .replace(/کنبوسo/g, "اشتراکینو")
    .replace(/کنبوسو/g, "اشتراکینو");
}

export async function buildShopCategoryOutOfStockMap(
  categories: Array<{ id: number }>,
  options?: { hideFullyUnavailable?: boolean },
): Promise<Map<number, boolean>> {
  const map = new Map<number, boolean>();
  await Promise.all(
    categories.map(async (c) => {
      if (options?.hideFullyUnavailable) {
        const hasAny = await categoryHasShopAvailableProduct(c.id);
        map.set(c.id, !hasAny);
      } else {
        map.set(c.id, await categoryFullyOutOfStock(c.id));
      }
    }),
  );
  return map;
}

export async function presentShopCategories(
  ctx: BotContext,
  layoutColumns: 1 | 2 = 2,
): Promise<void> {
  await ensureShopCatalogFresh();
  const showOos = await resolveShopShowOutOfStock(ctx);
  let categories = await catalogService.listShopCategories();

  if (!showOos) {
    const visible = [];
    for (const c of categories) {
      if (await categoryHasShopAvailableProduct(c.id)) visible.push(c);
    }
    categories = visible;
  }

  const oosMap = await buildShopCategoryOutOfStockMap(categories, {
    hideFullyUnavailable: !showOos,
  });
  const kb = shopRootMenuKeyboard(categories, layoutColumns, { outOfStockByCategoryId: oosMap });

  const emptyHint =
    categories.length === 0
      ? "\n\nفعلاً محصول قابل خریدی در فروشگاه موجود نیست. کمی بعد دوباره سر بزنید یا «بروزرسانی» را بزنید."
      : "";

  await safeEditMedia(
    ctx,
    BannerAssets.shop,
    `🛍 *فروشگاه اشتراکینو*\n\nدسته مورد نظر را انتخاب کنید:${emptyHint}`,
    kb,
    "photo",
    { parse_mode: "Markdown" },
  );
}

export async function presentCategoryView(ctx: BotContext, categoryId: number): Promise<void> {
  await ensureShopCatalogFresh();
  const showOos = await resolveShopShowOutOfStock(ctx);
  const isAdmin = ctx.from ? await hasAnyAdminAccess(ctx.from.id) : false;

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

  if (!showOos && !(await categoryHasShopAvailableProduct(categoryId))) {
    await safeEditMedia(
      ctx,
      BannerAssets.category,
      [
        `${emojiForLabel(category.name)} *${sanitizeCustomerCatalogText(category.name)}*`,
        "",
        "فعلاً محصول قابل خریدی در این دسته موجود نیست.",
      ].join("\n"),
      categoriesKeyboard(await catalogService.listShopCategories(), 2),
    );
    return;
  }

  const subCategories = await catalogService.listDisplaySubCategoriesByCategory(categoryId);
  const allProducts = await catalogService.listDisplayProductsByCategory(categoryId);
  const standaloneProducts = allProducts.filter((p) => p.subCategoryId == null);

  const user = await invoiceService.ensureUser(BigInt(ctx.from!.id));
  const pending = await invoiceService.getOpenInvoice(user.id);

  const subCategoriesUi: Array<{ id: number; name: string; outOfStock: boolean }> = [];
  for (const s of subCategories) {
    const fullyOos = await subCategoryFullyOutOfStock(s.id);
    const hasAvailable = await subCategoryHasShopAvailableProduct(s.id);
    if (!showOos && !hasAvailable) continue;
    subCategoriesUi.push({
      id: s.id,
      name: s.name,
      outOfStock: fullyOos,
    });
  }

  const standaloneUi = filterAvailabilityRowsForShop(
    await mapProductsAvailability(standaloneProducts),
    showOos,
  );

  const catBanner = category.bannerUrl?.trim() || BannerAssets.category;
  const desc = category.description?.trim();
  const isStars = isStarsCatalog(category.name);
  let starsRateLine = "";
  if (isStars) {
    const unitUsdPrice = await starsPricingService.getStarsUnitUsdPrice();
    const usdRate = await exchangeRateService.getUsdToTomanRate();
    const oneStarToman = effectiveStarsUnitToman(unitUsdPrice, usdRate);
    starsRateLine = `⭐️ قیمت هر ۱ عدد استارز امروز: <b>${oneStarToman.toLocaleString("en-US")} تومان</b>`;
  }

  const title = isStars
    ? `✨ <b>${sanitizeCustomerCatalogText(category.name)}</b>`
    : `${emojiForLabel(category.name)} *${sanitizeCustomerCatalogText(category.name)}*`;
  const parse_mode = isStars ? "HTML" : "Markdown";

  const shopPage = await pageContentService.getPage("shop");
  const layoutColumns = shopPage.layoutColumns === 1 ? 1 : 2;

  const hasListItems = subCategoriesUi.length > 0 || standaloneUi.length > 0;

  const caption = [
    title,
    ...(desc ? ["", `📝 ${sanitizeCustomerCatalogText(desc)}`] : []),
    ...(starsRateLine ? ["", starsRateLine] : []),
    "",
    hasListItems
      ? subCategoriesUi.length > 0
        ? "سرویس یا محصول مورد نظر را انتخاب کنید:"
        : "📦 محصول مورد نظر را انتخاب کنید:"
      : "فعلاً محصول قابل خریدی در این دسته موجود نیست.",
  ].join("\n");

  await safeEditMedia(
    ctx,
    catBanner,
    caption,
    categoryContentsKeyboard(subCategoriesUi, standaloneUi, {
      hasPendingInvoice: Boolean(pending),
      layoutColumns,
      categoryId,
      adminOutOfStockToggle:
        isAdmin ? { showing: showOos } : undefined,
    }),
    "photo",
    { parse_mode },
  );
}
