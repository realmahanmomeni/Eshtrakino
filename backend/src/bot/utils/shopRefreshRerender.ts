export type ShopRefreshRerenderTarget =
  | { kind: "category"; categoryId: number }
  | { kind: "root" };

/**
 * Which shop screen to redraw after refresh.
 * - `shop:refresh` → root (CMS shop page, same as main-menu shop entry).
 * - `cat:refresh:<id>` → that category only (from callback data, not session).
 */
export function pickShopRefreshRerenderTarget(
  explicitCategoryId?: number,
): ShopRefreshRerenderTarget {
  if (explicitCategoryId != null) {
    return { kind: "category", categoryId: explicitCategoryId };
  }
  return { kind: "root" };
}
