import {
  extractSupplierCostUsdFromRow,
  type CanbosoCatalogProduct,
} from "./adapters/CanbosoAdapter";

export function supplierCostUsdFromRemote(
  remote: CanbosoCatalogProduct,
  usdRate: number,
): number {
  const row =
    remote.raw && typeof remote.raw === "object"
      ? (remote.raw as Record<string, unknown>)
      : {};
  const { costUsd, priceKey } = extractSupplierCostUsdFromRow(row, usdRate);
  if (costUsd > 0) {
    return costUsd;
  }
  if (remote.supplierCostUsd > 0) {
    return remote.supplierCostUsd;
  }
  console.warn(
    `[CanbosoSync] Missing cost for product ${remote.productId} - ${remote.name}`,
    { priceKey, raw: row },
  );
  return 1;
}
