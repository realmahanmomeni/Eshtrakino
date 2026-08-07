/**
 * Banner assets for main menu surfaces.
 *
 * Swap placeholder URLs (or paste Telegram file_ids after first upload)
 * without touching handler logic.
 *
 * Prefer Telegram file_id strings once available — they load faster and
 * avoid re-fetching external URLs on every edit.
 */
export const BannerAssets = {
  /** /start + main menu */
  welcome:
    "https://placehold.co/800x400/252525/FFFFFF/png?text=Eshtrakino",
  /** فروشگاه / category list */
  shop:
    "https://placehold.co/800x400/1a3a5c/FFFFFF/png?text=Shop",
  /** products inside a category */
  category:
    "https://placehold.co/800x400/1e4d2b/FFFFFF/png?text=Products",
} as const;

export type BannerKey = keyof typeof BannerAssets;
