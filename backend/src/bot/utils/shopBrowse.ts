import type { BotContext } from "../context";
import { hasAnyAdminAccess } from "../admin/rbac";
import { readShopShowOutOfStock } from "./shopSession";

/** Default: hide unavailable products (same for customers and admins until toggled). */
export async function resolveShopShowOutOfStock(ctx: BotContext): Promise<boolean> {
  if (!ctx.from) return false;
  if (!(await hasAnyAdminAccess(ctx.from.id))) {
    if (ctx.session) ctx.session.shopShowOutOfStock = false;
    return false;
  }
  return readShopShowOutOfStock(ctx.session);
}

export async function toggleShopShowOutOfStock(ctx: BotContext): Promise<boolean> {
  if (!ctx.from || !(await hasAnyAdminAccess(ctx.from.id))) {
    return false;
  }
  if (!ctx.session) return false;
  ctx.session.shopShowOutOfStock = !readShopShowOutOfStock(ctx.session);
  return ctx.session.shopShowOutOfStock;
}

export type ShopListKeyboardExtras = {
  adminOutOfStockToggle?: { showing: boolean };
  categoryId?: number;
  subCategoryId?: number;
};
