import type { BotContext } from "../context";
import { hasAnyAdminAccess } from "../admin/rbac";

/** Default: hide unavailable products (same for customers and admins until toggled). */
export async function resolveShopShowOutOfStock(ctx: BotContext): Promise<boolean> {
  if (!ctx.from) return false;
  if (!(await hasAnyAdminAccess(ctx.from.id))) {
    ctx.session.shopShowOutOfStock = false;
    return false;
  }
  return ctx.session.shopShowOutOfStock === true;
}

export async function toggleShopShowOutOfStock(ctx: BotContext): Promise<boolean> {
  if (!ctx.from || !(await hasAnyAdminAccess(ctx.from.id))) {
    return false;
  }
  ctx.session.shopShowOutOfStock = !ctx.session.shopShowOutOfStock;
  return ctx.session.shopShowOutOfStock;
}

export type ShopListKeyboardExtras = {
  adminOutOfStockToggle?: { showing: boolean };
  categoryId?: number;
  subCategoryId?: number;
};
