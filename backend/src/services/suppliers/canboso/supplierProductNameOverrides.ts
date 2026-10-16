/**
 * Pinned local Product.name values for mapped Canboso SKUs.
 * Add entries here when the operator sets a display name that must not be
 * overwritten by automatic Canboso sync or supplier name-sync apply.
 *
 * Key: SupplierProductMapping.supplierProductKey (Canboso product id string)
 * Value: exact Product.name to keep in the shop
 */
export const SUPPLIER_PRODUCT_NAME_OVERRIDES: Readonly<Record<string, string>> = {
  /** Product #95 — owner title; remote title includes erroneous «1 میلیون». */
  "6ac4077a8931359f49e454fe": "Suno Pro 2.5k credit",
};

export function getSupplierProductNameOverride(
  supplierProductKey: string | null | undefined,
): string | null {
  if (!supplierProductKey) return null;
  const key = supplierProductKey.trim();
  if (!key) return null;
  return SUPPLIER_PRODUCT_NAME_OVERRIDES[key] ?? null;
}

export function hasSupplierProductNameOverride(
  supplierProductKey: string | null | undefined,
): boolean {
  return getSupplierProductNameOverride(supplierProductKey) != null;
}

/** Name written by automatic Canboso sync (override wins over polished remote title). */
export function resolveAutomaticLocalProductName(
  supplierProductKey: string | null | undefined,
  remoteBrandOrName: string,
  polish: (raw: string) => string,
): string {
  const override = getSupplierProductNameOverride(supplierProductKey);
  if (override) return override;
  return polish(remoteBrandOrName);
}
