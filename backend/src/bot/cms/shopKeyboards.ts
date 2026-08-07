import { InlineKeyboard } from "grammy";
import type { Category, Product } from "@prisma/client";
import { Callbacks } from "../keyboards/callbacks";
import { appendFullWidthCta, appendOneColumn, emojiForLabel } from "../keyboards/grid";
import { formatToman } from "../../lib/money";

function clip(label: string, max = 64): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

export function cmsCategoryListKeyboard(categories: Category[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  // Strict 1-column list
  appendOneColumn(
    kb,
    categories.map((c) => ({
      text: clip(`${emojiForLabel(c.name)} ${c.name}`),
      data: Callbacks.cmsCatView(c.id),
    })),
  );
  appendFullWidthCta(kb, "➕ افزودن دسته جدید", Callbacks.cmsCatAdd);
  appendFullWidthCta(kb, "بازگشت به فروشگاه", Callbacks.shop);
  return kb;
}

export function cmsCategoryViewKeyboard(categoryId: number): InlineKeyboard {
  const kb = new InlineKeyboard();
  appendFullWidthCta(kb, "📝 ویرایش نام", Callbacks.cmsCatRename(categoryId));
  appendFullWidthCta(kb, "🗑 حذف دسته", Callbacks.cmsCatDelete(categoryId));
  appendFullWidthCta(kb, "بازگشت", Callbacks.cmsCats);
  return kb;
}

export function cmsProductCategoryPickKeyboard(categories: Category[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  appendOneColumn(
    kb,
    categories.map((c) => ({
      text: clip(`${emojiForLabel(c.name)} ${c.name}`),
      data: Callbacks.cmsProdList(c.id),
    })),
  );
  appendFullWidthCta(kb, "بازگشت به فروشگاه", Callbacks.shop);
  return kb;
}

export function cmsProductListKeyboard(
  categoryId: number,
  products: Product[],
): InlineKeyboard {
  const kb = new InlineKeyboard();
  // Strict 1-column — full-width product rows (name + price)
  appendOneColumn(
    kb,
    products.map((p) => {
      const price = formatToman(p.price);
      const name = p.name.length > 36 ? `${p.name.slice(0, 35)}…` : p.name;
      return {
        text: clip(`📦 ${name} · ${price}`),
        data: Callbacks.cmsProdView(p.id),
      };
    }),
  );
  appendFullWidthCta(kb, "➕ افزودن محصول", Callbacks.cmsProdAdd(categoryId));
  appendFullWidthCta(kb, "بازگشت", Callbacks.cmsProds);
  return kb;
}

export function cmsProductViewKeyboard(productId: number, categoryId: number): InlineKeyboard {
  const kb = new InlineKeyboard();
  appendFullWidthCta(kb, "📝 ویرایش نام", Callbacks.cmsProdRename(productId));
  appendFullWidthCta(kb, "💰 ویرایش قیمت", Callbacks.cmsProdPrice(productId));
  appendFullWidthCta(kb, "🗑 حذف محصول", Callbacks.cmsProdDelete(productId));
  appendFullWidthCta(kb, "بازگشت", Callbacks.cmsProdList(categoryId));
  return kb;
}
