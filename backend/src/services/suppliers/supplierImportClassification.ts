import type { CanbosoCatalogProduct } from "./adapters/CanbosoAdapter";

const CHARGE_NAME_RE =
  /\b(charge|recharge|top[- ]?up|topup|renewal|renew)\b|شارژ|تمدید|افزایش\s*اعتبار|خرید\s*مجدد/i;

/**
 * True when this remote SKU is a charge/top-up style variant of a product we already map
 * (same supplier parent key). These keep the legacy auto-link/sync behavior.
 */
export function isChargeOrVariantOfMappedParent(
  remote: CanbosoCatalogProduct,
  mappedParentKeys: ReadonlySet<string>,
): boolean {
  const parentKey = remote.parentProductId ?? remote.productId;
  if (!mappedParentKeys.has(parentKey)) {
    return false;
  }

  const isNestedVariant =
    remote.variantId != null &&
    remote.variantId !== "" &&
    remote.parentProductId != null &&
    remote.parentProductId !== remote.productId;

  if (isNestedVariant) {
    return true;
  }

  const label = `${remote.brandName ?? ""} ${remote.name}`;
  return CHARGE_NAME_RE.test(label);
}

/**
 * Brand-new supplier SKU that must not enter the shop until an admin approves placement.
 */
export function requiresAdminApprovalBeforeImport(
  remote: CanbosoCatalogProduct,
  mappedParentKeys: ReadonlySet<string>,
): boolean {
  if (isChargeOrVariantOfMappedParent(remote, mappedParentKeys)) {
    return false;
  }

  const parentKey = remote.parentProductId ?? remote.productId;
  if (mappedParentKeys.has(parentKey)) {
    return false;
  }

  if (mappedParentKeys.has(remote.productId)) {
    return false;
  }

  if (remote.variantId && mappedParentKeys.has(remote.variantId)) {
    return false;
  }

  return true;
}

export function normalizeSupplierVariantKey(variantId?: string | null): string {
  if (!variantId || variantId.trim() === "") return "";
  return variantId.trim();
}

export function supplierKeysFromRemote(remote: CanbosoCatalogProduct): {
  supplierProductKey: string;
  supplierVariantKey: string;
} {
  const supplierProductKey = remote.parentProductId ?? remote.productId;
  const rawVariant =
    remote.variantId && remote.variantId !== supplierProductKey ? remote.variantId : null;
  return {
    supplierProductKey,
    supplierVariantKey: normalizeSupplierVariantKey(rawVariant),
  };
}
