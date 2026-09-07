import type { Category, Product } from "@prisma/client";
import type { EshtrakinoConversation, SessionContext } from "../context";
import { catalogService, type SubCategoryRecord } from "../../services/catalog/CatalogService";
import { InlineKeyboard } from "grammy";
import { formatToman, parsePrice } from "../../lib/money";
import { toPlain } from "../../lib/plain";
import {
  ensurePanel,
  panelFromCtx,
  type PanelRef,
  waitTextOnPanel,
  waitCallbackOnPanel,
} from "../conversations/wait";
import { exchangeRateService, convertUsdToToman } from "../../services/exchangeRateService";
import { presentCmsPage } from "./presentPage";
import {
  cmsCategoryListKeyboard,
  cmsCategoryViewKeyboard,
  cmsSubCategoryListKeyboard,
  cmsSubCategoryViewKeyboard,
  cmsProductCategoryPickKeyboard,
  cmsProductListKeyboard,
  cmsProductViewKeyboard,
} from "./shopKeyboards";

function escapeMd(value: string): string {
  return value.replace(/([_*`\[\]])/g, "\\$1");
}

export function formatCmsCategoryListMessage(categories: Category[], banner?: string): string {
  const body = [
    "📁 *مدیریت بنر و متن دسته‌ها*",
    "",
    categories.length === 0
      ? "هنوز دسته‌ای ثبت نشده است."
      : `تعداد دسته‌های فعال: *${categories.length}*`,
    "",
    "یک دسته را برای مشاهده و ویرایش بنر و توضیحات انتخاب کنید:",
  ].join("\n");
  return banner ? `${banner}\n\n${body}` : body;
}

export function formatCmsCategoryViewMessage(category: Category, banner?: string): string {
  const hasBanner = Boolean((category as any).bannerUrl?.trim());
  const desc = (category as any).description?.trim() || "تنظیم نشده (پیش‌فرض)";
  const body = [
    "📁 *جزئیات و بنر دسته*",
    "",
    `نام دسته: *${escapeMd(category.name)}*`,
    `شناسه: \`${category.id}\``,
    `وضعیت بنر: ${hasBanner ? "✅ *اختصاصی*" : "❌ *پیش‌فرض ربات*"}`,
    "",
    "📝 *متن توضیحات:*",
    escapeMd(desc),
  ].join("\n");
  return banner ? `${banner}\n\n${body}` : body;
}

export function formatCmsSubCategoryListMessage(
  subCategories: (SubCategoryRecord & { category?: Category | null })[],
  banner?: string,
): string {
  const body = [
    "📁 *مدیریت بنر و متن زیردسته‌ها (سرویس‌ها)*",
    "",
    subCategories.length === 0
      ? "هنوز زیردسته‌ای ثبت نشده است."
      : `تعداد زیردسته‌های فعال: *${subCategories.length}*`,
    "",
    "یک زیردسته را برای مشاهده و ویرایش بنر و توضیحات انتخاب کنید:",
  ].join("\n");
  return banner ? `${banner}\n\n${body}` : body;
}

export function formatCmsSubCategoryViewMessage(
  subCategory: SubCategoryRecord & { category?: Category | null },
  banner?: string,
): string {
  const hasBanner = Boolean(subCategory.bannerUrl?.trim() || subCategory.coverImageUrl?.trim());
  const desc = subCategory.description?.trim() || "تنظیم نشده (پیش‌فرض)";
  const parentCat = subCategory.category?.name ? `\nدسته والد: *${escapeMd(subCategory.category.name)}*` : "";
  const body = [
    "📁 *جزئیات و بنر زیردسته (سرویس)*",
    "",
    `نام: *${escapeMd(subCategory.name)}*${parentCat}`,
    `شناسه: \`${subCategory.id}\``,
    `وضعیت بنر: ${hasBanner ? "✅ *اختصاصی*" : "❌ *ارث‌بری از دسته یا پیش‌فرض*"}`,
    "",
    "📝 *متن توضیحات:*",
    escapeMd(desc),
  ].join("\n");
  return banner ? `${banner}\n\n${body}` : body;
}

export function formatCmsProductPickMessage(categories: Category[], banner?: string): string {
  const body = [
    "🛍 *مدیریت محصولات*",
    "",
    categories.length === 0
      ? "ابتدا یک دسته بسازید."
      : "دسته‌ای که می‌خواهید محصولاتش را مدیریت کنید انتخاب کنید:",
  ].join("\n");
  return banner ? `${banner}\n\n${body}` : body;
}

export function formatCmsProductListMessage(
  category: Category,
  products: Product[],
  banner?: string,
): string {
  const body = [
    "🛍 *لیست محصولات*",
    "",
    `دسته: *${escapeMd(category.name)}*`,
    `تعداد: *${products.length}*`,
    "",
    "یک محصول را انتخاب کنید یا محصول جدید بسازید:",
  ].join("\n");
  return banner ? `${banner}\n\n${body}` : body;
}

export function formatCmsProductViewMessage(
  product: Product & { category?: Category | null },
  banner?: string,
): string {
  const desc = product.description?.trim() || "—";
  const prod = product as Product & { currency?: string; usdPrice?: number | null };
  const priceDisplay =
    prod.currency === "USD" && prod.usdPrice != null
      ? `${formatToman(product.price)} ($${prod.usdPrice})`
      : formatToman(product.price);
  const body = [
    "🛍 *جزئیات محصول*",
    "",
    `نام: *${escapeMd(product.name)}*`,
    `دسته: *${escapeMd(product.category?.name ?? "—")}*`,
    `قیمت: *${priceDisplay}*`,
    "",
    "توضیحات:",
    escapeMd(desc),
  ].join("\n");
  return banner ? `${banner}\n\n${body}` : body;
}

export async function presentCmsCategoryList(
  ctx: SessionContext,
  panel?: PanelRef | null,
  banner?: string,
): Promise<PanelRef> {
  const categories = await catalogService.listActiveCategories();
  return ensurePanel(
    ctx,
    formatCmsCategoryListMessage(categories, banner),
    cmsCategoryListKeyboard(categories),
    panel ?? panelFromCtx(ctx),
  );
}

export async function presentCmsCategoryView(
  ctx: SessionContext,
  categoryId: number,
  panel?: PanelRef | null,
  banner?: string,
): Promise<PanelRef | null> {
  const category = await catalogService.getCategory(categoryId, false);
  if (!category || !category.isActive) {
    await presentCmsCategoryList(ctx, panel, "⚠️ دسته یافت نشد.");
    return null;
  }
  return ensurePanel(
    ctx,
    formatCmsCategoryViewMessage(category, banner),
    cmsCategoryViewKeyboard(category.id),
    panel ?? panelFromCtx(ctx),
  );
}

export async function presentCmsSubCategoryList(
  ctx: SessionContext,
  panel?: PanelRef | null,
  banner?: string,
): Promise<PanelRef> {
  const subCategories = await catalogService.listAllSubCategories(true);
  return ensurePanel(
    ctx,
    formatCmsSubCategoryListMessage(subCategories, banner),
    cmsSubCategoryListKeyboard(subCategories),
    panel ?? panelFromCtx(ctx),
  );
}

export async function presentCmsSubCategoryView(
  ctx: SessionContext,
  subCategoryId: number,
  panel?: PanelRef | null,
  banner?: string,
): Promise<PanelRef | null> {
  const subCategory = await catalogService.getSubCategoryById(subCategoryId);
  if (!subCategory || !subCategory.isActive) {
    await presentCmsSubCategoryList(ctx, panel, "⚠️ زیردسته یافت نشد.");
    return null;
  }
  return ensurePanel(
    ctx,
    formatCmsSubCategoryViewMessage(subCategory, banner),
    cmsSubCategoryViewKeyboard(subCategory.id),
    panel ?? panelFromCtx(ctx),
  );
}

export async function presentCmsProductCategoryPick(
  ctx: SessionContext,
  panel?: PanelRef | null,
  banner?: string,
): Promise<PanelRef> {
  const categories = await catalogService.listActiveCategories();
  return ensurePanel(
    ctx,
    formatCmsProductPickMessage(categories, banner),
    cmsProductCategoryPickKeyboard(categories),
    panel ?? panelFromCtx(ctx),
  );
}

export async function presentCmsProductList(
  ctx: SessionContext,
  categoryId: number,
  panel?: PanelRef | null,
  banner?: string,
): Promise<PanelRef | null> {
  const category = await catalogService.getCategory(categoryId, true);
  if (!category) {
    await presentCmsProductCategoryPick(ctx, panel, "⚠️ دسته یافت نشد.");
    return null;
  }
  const products = await catalogService.listActiveProductsByCategory(categoryId);
  return ensurePanel(
    ctx,
    formatCmsProductListMessage(category, products, banner),
    cmsProductListKeyboard(categoryId, products),
    panel ?? panelFromCtx(ctx),
  );
}

export async function presentCmsProductView(
  ctx: SessionContext,
  productId: number,
  panel?: PanelRef | null,
  banner?: string,
): Promise<PanelRef | null> {
  const product = await catalogService.getProduct(productId, false);
  if (!product || !product.isActive) {
    await presentCmsProductCategoryPick(ctx, panel, "⚠️ محصول یافت نشد.");
    return null;
  }
  return ensurePanel(
    ctx,
    formatCmsProductViewMessage(product, banner),
    cmsProductViewKeyboard(product.id, product.categoryId),
    panel ?? panelFromCtx(ctx),
  );
}

/** Fluid: add category */
export async function cmsAddCategoryConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  try {
    let panel = panelFromCtx(ctx);
    const prompt = [
      "➕ *افزودن دسته جدید*",
      "",
      "نام دسته را بفرستید:",
      "",
      "(برای انصراف /cancel را بفرستید)",
    ].join("\n");

    if (!panel) {
      panel = await ensurePanel(ctx, prompt, cmsCategoryListKeyboard([]), null);
    }

    const waited = await waitTextOnPanel(conversation, ctx, prompt, panel);
    panel = waited.panel;

    if (!waited.text) {
      const categories = await conversation.external(async () =>
        toPlain(await catalogService.listActiveCategories()),
      );
      await ensurePanel(
        ctx,
        formatCmsCategoryListMessage(categories, "❌ افزودن دسته لغو شد."),
        cmsCategoryListKeyboard(categories),
        panel,
      );
      return;
    }

    const name = waited.text.trim();
    if (name.length < 2 || name.length > 80) {
      const categories = await conversation.external(async () =>
        toPlain(await catalogService.listActiveCategories()),
      );
      await ensurePanel(
        ctx,
        formatCmsCategoryListMessage(categories, "⚠️ نام دسته نامعتبر است (۲ تا ۸۰ کاراکتر)."),
        cmsCategoryListKeyboard(categories),
        panel,
      );
      return;
    }

    const created = await conversation.external(async () =>
      toPlain(await catalogService.createCategory(name)),
    );
    const categories = await conversation.external(async () =>
      toPlain(await catalogService.listActiveCategories()),
    );
    await ensurePanel(
      ctx,
      formatCmsCategoryListMessage(categories, `✅ دسته «${created.name}» اضافه شد.`),
      cmsCategoryListKeyboard(categories),
      panel,
    );
  } catch (err) {
    console.error("cmsAddCategoryConversation error:", err);
    await presentCmsCategoryList(ctx, panelFromCtx(ctx), "⚠️ خطا در افزودن دسته.");
  }
}

/** Fluid: rename category */
export async function cmsRenameCategoryConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  try {
    const categoryId = await conversation.external((c) => c.session.adminCmsCategoryId ?? null);
    if (!categoryId) {
      await presentCmsCategoryList(ctx, panelFromCtx(ctx), "⚠️ دسته هدف مشخص نیست.");
      return;
    }

    let panel = panelFromCtx(ctx);
    const current = await conversation.external(async () => {
      const row = await catalogService.getCategory(categoryId, false);
      return row ? toPlain(row) : null;
    });
    if (!current || !current.isActive) {
      await conversation.external((c) => {
        c.session.adminCmsCategoryId = undefined;
      });
      await presentCmsCategoryList(ctx, panel, "⚠️ دسته یافت نشد.");
      return;
    }

    const prompt = [
      "📝 *ویرایش نام دسته*",
      "",
      `نام فعلی: *${escapeMd(current.name)}*`,
      "",
      "نام جدید را بفرستید:",
      "",
      "(برای انصراف /cancel را بفرستید)",
    ].join("\n");

    if (!panel) {
      panel = await ensurePanel(ctx, prompt, cmsCategoryViewKeyboard(categoryId), null);
    }

    const waited = await waitTextOnPanel(conversation, ctx, prompt, panel);
    panel = waited.panel;

    if (!waited.text) {
      await conversation.external((c) => {
        c.session.adminCmsCategoryId = undefined;
      });
      await presentCmsCategoryView(ctx, categoryId, panel, "❌ ویرایش لغو شد.");
      return;
    }

    const name = waited.text.trim();
    if (name.length < 2 || name.length > 80) {
      await conversation.external((c) => {
        c.session.adminCmsCategoryId = undefined;
      });
      await presentCmsCategoryView(ctx, categoryId, panel, "⚠️ نام نامعتبر است.");
      return;
    }

    const updated = await conversation.external(async () =>
      toPlain(await catalogService.updateCategoryName(categoryId, name)),
    );
    await conversation.external((c) => {
      c.session.adminCmsCategoryId = undefined;
    });
    await presentCmsCategoryView(ctx, categoryId, panel, `✅ نام به «${updated.name}» تغییر کرد.`);
  } catch (err) {
    console.error("cmsRenameCategoryConversation error:", err);
    await conversation.external((c) => {
      c.session.adminCmsCategoryId = undefined;
    }).catch(() => undefined);
    await presentCmsCategoryList(ctx, panelFromCtx(ctx), "⚠️ خطا در ویرایش نام دسته.");
  }
}

/** Fluid: add product (name → description → price) */
export async function cmsAddProductConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  try {
    const categoryId = await conversation.external((c) => c.session.adminCmsCategoryId ?? null);
    if (!categoryId) {
      await presentCmsProductCategoryPick(ctx, panelFromCtx(ctx), "⚠️ دسته هدف مشخص نیست.");
      return;
    }

    let panel = panelFromCtx(ctx);
    const category = await conversation.external(async () => {
      const row = await catalogService.getCategory(categoryId, true);
      return row ? toPlain(row) : null;
    });
    if (!category) {
      await conversation.external((c) => {
        c.session.adminCmsCategoryId = undefined;
      });
      await presentCmsProductCategoryPick(ctx, panel, "⚠️ دسته یافت نشد.");
      return;
    }

    const namePrompt = [
      "➕ *افزودن محصول*",
      "",
      `دسته: *${escapeMd(category.name)}*`,
      "",
      "۱/۳ — نام محصول را بفرستید:",
      "",
      "(برای انصراف /cancel را بفرستید)",
    ].join("\n");

    if (!panel) {
      panel = await ensurePanel(ctx, namePrompt, cmsProductListKeyboard(categoryId, []), null);
    }

    const nameWait = await waitTextOnPanel(conversation, ctx, namePrompt, panel);
    panel = nameWait.panel;
    if (!nameWait.text) {
      await conversation.external((c) => {
        c.session.adminCmsCategoryId = undefined;
      });
      await presentCmsProductList(ctx, categoryId, panel, "❌ افزودن محصول لغو شد.");
      return;
    }
    const name = nameWait.text.trim();
    if (name.length < 2 || name.length > 120) {
      await conversation.external((c) => {
        c.session.adminCmsCategoryId = undefined;
      });
      await presentCmsProductList(ctx, categoryId, panel, "⚠️ نام محصول نامعتبر است.");
      return;
    }

    const descPrompt = [
      "➕ *افزودن محصول*",
      "",
      `نام: *${escapeMd(name)}*`,
      "",
      "۲/۳ — توضیحات محصول را بفرستید:",
      "",
      "(برای انصراف /cancel را بفرستید)",
    ].join("\n");
    const descWait = await waitTextOnPanel(conversation, ctx, descPrompt, panel);
    panel = descWait.panel;
    if (!descWait.text) {
      await conversation.external((c) => {
        c.session.adminCmsCategoryId = undefined;
      });
      await presentCmsProductList(ctx, categoryId, panel, "❌ افزودن محصول لغو شد.");
      return;
    }
    const description = descWait.text.trim();

    const currPrompt = [
      "➕ *افزودن محصول*",
      "",
      `نام: *${escapeMd(name)}*`,
      "",
      "۳/۴ — واحد پول قیمت گذاری را انتخاب کنید:",
    ].join("\n");
    const currWait = await waitCallbackOnPanel(
      conversation,
      ctx,
      currPrompt,
      new InlineKeyboard()
        .text("💵 قیمت دلاری (USD)", "cms:prod_curr:USD")
        .text("🇮🇷 قیمت تومانی (TOMAN)", "cms:prod_curr:TOMAN")
        .row(),
      panel,
    );
    panel = currWait.panel;
    if (!currWait.data) {
      await conversation.external((c) => {
        c.session.adminCmsCategoryId = undefined;
      });
      await presentCmsProductList(ctx, categoryId, panel, "❌ افزودن محصول لغو شد.");
      return;
    }

    let currency = "TOMAN";
    let price: number | null = null;
    let usdPrice: number | null = null;

    if (currWait.data === "cms:prod_curr:USD") {
      currency = "USD";
      const usdPrompt = [
        "➕ *افزودن محصول*",
        "",
        `نام: *${escapeMd(name)}*`,
        "",
        "۴/۴ — قیمت به دلار (USD) را بفرستید (مثلاً 5 یا 9.99):",
        "",
        "(برای انصراف /cancel را بفرستید)",
      ].join("\n");
      const usdWait = await waitTextOnPanel(conversation, ctx, usdPrompt, panel);
      panel = usdWait.panel;
      if (!usdWait.text) {
        await conversation.external((c) => {
          c.session.adminCmsCategoryId = undefined;
        });
        await presentCmsProductList(ctx, categoryId, panel, "❌ افزودن محصول لغو شد.");
        return;
      }
      const parsedUsd = parseFloat(usdWait.text.trim().replace(/,/g, "."));
      if (!Number.isFinite(parsedUsd) || parsedUsd <= 0) {
        await conversation.external((c) => {
          c.session.adminCmsCategoryId = undefined;
        });
        await presentCmsProductList(ctx, categoryId, panel, "⚠️ قیمت دلاری نامعتبر است.");
        return;
      }
      usdPrice = Math.round(parsedUsd * 100) / 100;
      price = await conversation.external(async () => {
        const rate = await exchangeRateService.getUsdRate();
        return convertUsdToToman(usdPrice!, rate);
      });
    } else {
      currency = "TOMAN";
      usdPrice = null;
      const pricePrompt = [
        "➕ *افزودن محصول*",
        "",
        `نام: *${escapeMd(name)}*`,
        "",
        "۴/۴ — قیمت به تومان را بفرستید (فقط عدد):",
        "",
        "(برای انصراف /cancel را بفرستید)",
      ].join("\n");
      const priceWait = await waitTextOnPanel(conversation, ctx, pricePrompt, panel);
      panel = priceWait.panel;
      if (!priceWait.text) {
        await conversation.external((c) => {
          c.session.adminCmsCategoryId = undefined;
        });
        await presentCmsProductList(ctx, categoryId, panel, "❌ افزودن محصول لغو شد.");
        return;
      }

      price = parsePrice(priceWait.text);
      if (price == null || price <= 0) {
        await conversation.external((c) => {
          c.session.adminCmsCategoryId = undefined;
        });
        await presentCmsProductList(ctx, categoryId, panel, "⚠️ قیمت نامعتبر است.");
        return;
      }
    }

    const created = await conversation.external(async () =>
      toPlain(
        await catalogService.createProduct({
          name,
          description,
          price: price!,
          currency,
          usdPrice,
          categoryId,
          deliveryType: "MANUAL",
        }),
      ),
    );
    await conversation.external((c) => {
      c.session.adminCmsCategoryId = undefined;
    });

    const products = await conversation.external(async () =>
      toPlain(await catalogService.listActiveProductsByCategory(categoryId)),
    );
    const successMsg =
      currency === "USD" && usdPrice != null
        ? `✅ محصول «${created.name}» با قیمت $${usdPrice} (${formatToman(created.price)}) اضافه شد.`
        : `✅ محصول «${created.name}» با قیمت ${formatToman(created.price)} اضافه شد.`;
    await ensurePanel(
      ctx,
      formatCmsProductListMessage(category, products, successMsg),
      cmsProductListKeyboard(categoryId, products),
      panel,
    );
  } catch (err) {
    console.error("cmsAddProductConversation error:", err);
    await conversation.external((c) => {
      c.session.adminCmsCategoryId = undefined;
    }).catch(() => undefined);
    await presentCmsProductCategoryPick(ctx, panelFromCtx(ctx), "⚠️ خطا در افزودن محصول.");
  }
}

/** Fluid: rename product */
export async function cmsRenameProductConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  try {
    const productId = await conversation.external((c) => c.session.adminCmsProductId ?? null);
    if (!productId) {
      await presentCmsProductCategoryPick(ctx, panelFromCtx(ctx), "⚠️ محصول هدف مشخص نیست.");
      return;
    }

    let panel = panelFromCtx(ctx);
    const product = await conversation.external(async () => {
      const row = await catalogService.getProduct(productId, false);
      return row ? toPlain(row) : null;
    });
    if (!product || !product.isActive) {
      await conversation.external((c) => {
        c.session.adminCmsProductId = undefined;
      });
      await presentCmsProductCategoryPick(ctx, panel, "⚠️ محصول یافت نشد.");
      return;
    }

    const prompt = [
      "📝 *ویرایش نام محصول*",
      "",
      `نام فعلی: *${escapeMd(product.name)}*`,
      "",
      "نام جدید را بفرستید:",
      "",
      "(برای انصراف /cancel را بفرستید)",
    ].join("\n");

    if (!panel) {
      panel = await ensurePanel(
        ctx,
        prompt,
        cmsProductViewKeyboard(productId, product.categoryId),
        null,
      );
    }

    const waited = await waitTextOnPanel(conversation, ctx, prompt, panel);
    panel = waited.panel;
    if (!waited.text) {
      await conversation.external((c) => {
        c.session.adminCmsProductId = undefined;
      });
      await presentCmsProductView(ctx, productId, panel, "❌ ویرایش لغو شد.");
      return;
    }

    const name = waited.text.trim();
    if (name.length < 2 || name.length > 120) {
      await conversation.external((c) => {
        c.session.adminCmsProductId = undefined;
      });
      await presentCmsProductView(ctx, productId, panel, "⚠️ نام نامعتبر است.");
      return;
    }

    await conversation.external(async () => {
      await catalogService.updateProductName(productId, name);
    });
    await conversation.external((c) => {
      c.session.adminCmsProductId = undefined;
    });
    await presentCmsProductView(ctx, productId, panel, `✅ نام به «${name}» تغییر کرد.`);
  } catch (err) {
    console.error("cmsRenameProductConversation error:", err);
    await conversation.external((c) => {
      c.session.adminCmsProductId = undefined;
    }).catch(() => undefined);
    await presentCmsProductCategoryPick(ctx, panelFromCtx(ctx), "⚠️ خطا در ویرایش نام محصول.");
  }
}

/** Fluid: edit product price */
export async function cmsEditProductPriceConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  try {
    const productId = await conversation.external((c) => c.session.adminCmsProductId ?? null);
    if (!productId) {
      await presentCmsProductCategoryPick(ctx, panelFromCtx(ctx), "⚠️ محصول هدف مشخص نیست.");
      return;
    }

    let panel = panelFromCtx(ctx);
    const product = await conversation.external(async () => {
      const row = await catalogService.getProduct(productId, false);
      return row ? toPlain(row) : null;
    });
    if (!product || !product.isActive) {
      await conversation.external((c) => {
        c.session.adminCmsProductId = undefined;
      });
      await presentCmsProductCategoryPick(ctx, panel, "⚠️ محصول یافت نشد.");
      return;
    }

    const prod = product as typeof product & { currency?: string; usdPrice?: number | null };
    const currentPriceDisplay =
      prod.currency === "USD" && prod.usdPrice != null
        ? `$${prod.usdPrice} (${formatToman(product.price)})`
        : formatToman(product.price);

    const currPrompt = [
      "💰 *ویرایش قیمت محصول*",
      "",
      `محصول: *${escapeMd(product.name)}*`,
      `قیمت فعلی: *${currentPriceDisplay}*`,
      "",
      "واحد پول قیمت گذاری را انتخاب کنید:",
    ].join("\n");

    if (!panel) {
      panel = await ensurePanel(
        ctx,
        currPrompt,
        cmsProductViewKeyboard(productId, product.categoryId),
        null,
      );
    }

    const currWait = await waitCallbackOnPanel(
      conversation,
      ctx,
      currPrompt,
      new InlineKeyboard()
        .text("💵 قیمت دلاری (USD)", "cms:prod_edit_curr:USD")
        .text("🇮🇷 قیمت تومانی (TOMAN)", "cms:prod_edit_curr:TOMAN")
        .row(),
      panel,
    );
    panel = currWait.panel;
    if (!currWait.data) {
      await conversation.external((c) => {
        c.session.adminCmsProductId = undefined;
      });
      await presentCmsProductView(ctx, productId, panel, "❌ ویرایش قیمت لغو شد.");
      return;
    }

    if (currWait.data === "cms:prod_edit_curr:USD") {
      const usdPrompt = [
        "💰 *ویرایش قیمت محصول (دلاری)*",
        "",
        `محصول: *${escapeMd(product.name)}*`,
        "",
        "قیمت جدید به دلار (USD) را بفرستید (مثلاً 5 یا 9.99):",
        "",
        "(برای انصراف /cancel را بفرستید)",
      ].join("\n");
      const usdWait = await waitTextOnPanel(conversation, ctx, usdPrompt, panel);
      panel = usdWait.panel;
      if (!usdWait.text) {
        await conversation.external((c) => {
          c.session.adminCmsProductId = undefined;
        });
        await presentCmsProductView(ctx, productId, panel, "❌ ویرایش قیمت لغو شد.");
        return;
      }
      const parsedUsd = parseFloat(usdWait.text.trim().replace(/,/g, "."));
      if (!Number.isFinite(parsedUsd) || parsedUsd <= 0) {
        await conversation.external((c) => {
          c.session.adminCmsProductId = undefined;
        });
        await presentCmsProductView(ctx, productId, panel, "⚠️ قیمت دلاری نامعتبر است.");
        return;
      }
      const usdPrice = Math.round(parsedUsd * 100) / 100;
      const price = await conversation.external(async () => {
        const rate = await exchangeRateService.getUsdRate();
        return convertUsdToToman(usdPrice, rate);
      });

      await conversation.external(async () => {
        await catalogService.updateProductPrice(productId, price, "USD", usdPrice);
      });
      await conversation.external((c) => {
        c.session.adminCmsProductId = undefined;
      });
      await presentCmsProductView(
        ctx,
        productId,
        panel,
        `✅ قیمت به *$${usdPrice}* (معادل فعلی: *${formatToman(price)}*) تغییر کرد.`,
      );
    } else {
      const pricePrompt = [
        "💰 *ویرایش قیمت محصول (تومانی)*",
        "",
        `محصول: *${escapeMd(product.name)}*`,
        "",
        "قیمت جدید به تومان را بفرستید (فقط عدد):",
        "",
        "(برای انصراف /cancel را بفرستید)",
      ].join("\n");
      const priceWait = await waitTextOnPanel(conversation, ctx, pricePrompt, panel);
      panel = priceWait.panel;
      if (!priceWait.text) {
        await conversation.external((c) => {
          c.session.adminCmsProductId = undefined;
        });
        await presentCmsProductView(ctx, productId, panel, "❌ ویرایش قیمت لغو شد.");
        return;
      }

      const price = parsePrice(priceWait.text);
      if (price == null || price <= 0) {
        await conversation.external((c) => {
          c.session.adminCmsProductId = undefined;
        });
        await presentCmsProductView(ctx, productId, panel, "⚠️ قیمت نامعتبر است.");
        return;
      }

      await conversation.external(async () => {
        await catalogService.updateProductPrice(productId, price, "TOMAN", null);
      });
      await conversation.external((c) => {
        c.session.adminCmsProductId = undefined;
      });
      await presentCmsProductView(
        ctx,
        productId,
        panel,
        `✅ قیمت به *${formatToman(price)}* تغییر کرد.`,
      );
    }
  } catch (err) {
    console.error("cmsEditProductPriceConversation error:", err);
    await conversation.external((c) => {
      c.session.adminCmsProductId = undefined;
    }).catch(() => undefined);
    await presentCmsProductCategoryPick(ctx, panelFromCtx(ctx), "⚠️ خطا در ویرایش قیمت.");
  }
}

/** Used when cancel returns all the way to shop from a dead state. */
export async function returnToShop(ctx: SessionContext): Promise<void> {
  await presentCmsPage(ctx, "shop", "edit");
}
