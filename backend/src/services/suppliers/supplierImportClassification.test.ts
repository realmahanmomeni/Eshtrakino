import test from "node:test";
import assert from "node:assert/strict";
import type { CanbosoCatalogProduct } from "./adapters/CanbosoAdapter";
import {
  isChargeOrVariantOfMappedParent,
  requiresAdminApprovalBeforeImport,
} from "./supplierImportClassification";

function remote(partial: Partial<CanbosoCatalogProduct> & { productId: string }): CanbosoCatalogProduct {
  return {
    name: partial.name ?? "Test",
    stock: 1,
    isAvailable: true,
    supplierPriceToman: 1000,
    supplierCostUsd: 1,
    requiredFields: [],
    raw: {},
    brandName: partial.brandName,
    parentProductId: partial.parentProductId,
    variantId: partial.variantId,
    productId: partial.productId,
  };
}

test("requires approval for standalone new SKU", () => {
  const mapped = new Set<string>();
  const r = remote({ productId: "new-99", name: "Brand New Service" });
  assert.equal(requiresAdminApprovalBeforeImport(r, mapped), true);
});

test("skips approval when parent already mapped (variant/charge path)", () => {
  const mapped = new Set<string>(["parent-1"]);
  const r = remote({
    productId: "v-1",
    parentProductId: "parent-1",
    variantId: "v-1",
    name: "Parent — Recharge 10 USD",
  });
  assert.equal(isChargeOrVariantOfMappedParent(r, mapped), true);
  assert.equal(requiresAdminApprovalBeforeImport(r, mapped), false);
});
