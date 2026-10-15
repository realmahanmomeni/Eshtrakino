import type { Category, Product, SubCategory } from "@prisma/client";

export type ProductHierarchyContext = Product & {
  category?: Category | null;
  subCategory?: SubCategory | null;
};

/** True when automatic taxonomy migration must not move or rename this product. */
export function isAutomaticHierarchyBlocked(product: ProductHierarchyContext): boolean {
  if (product.hierarchyLocked) return true;
  if (product.subCategory?.isAdminManaged) return true;
  if (product.category?.isAdminManaged) return true;
  return false;
}
