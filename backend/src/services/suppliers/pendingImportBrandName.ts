import type { SupplierPendingImport } from "@prisma/client";

/** Suggested dedicated subcategory label from supplier brand / product title. */
export function suggestPendingImportSubCategoryName(row: SupplierPendingImport): string | null {
  const brand = row.brandName?.trim();
  if (brand && brand.length >= 2) return brand;

  const display = row.displayName.trim();
  if (!display) return null;

  const beforeSep = display.split(/[—–\-|]/)[0]?.trim();
  if (beforeSep && beforeSep.length >= 2) return beforeSep;

  const latin = display.match(/[A-Za-z][A-Za-z0-9\s]{1,30}/)?.[0]?.trim();
  return latin && latin.length >= 2 ? latin : null;
}
