export type ShopRefreshRerenderTarget =
  | { kind: "category"; categoryId: number }
  | { kind: "subcategory"; subCategoryId: number }
  | { kind: "root" };

/** Which shop screen to redraw after a price/stock refresh (session + optional explicit category). */
export function pickShopRefreshRerenderTarget(
  session: { lastCategoryId?: number; lastShopSubCategoryId?: number },
  explicitCategoryId?: number,
): ShopRefreshRerenderTarget {
  if (explicitCategoryId != null) {
    return { kind: "category", categoryId: explicitCategoryId };
  }
  const subId = session.lastShopSubCategoryId;
  if (subId != null) {
    return { kind: "subcategory", subCategoryId: subId };
  }
  const categoryId = session.lastCategoryId;
  if (categoryId != null) {
    return { kind: "category", categoryId };
  }
  return { kind: "root" };
}
