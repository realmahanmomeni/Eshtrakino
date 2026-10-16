import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRemoteIndexes,
  getCanbosoBulkCatalog,
  resetCanbosoBulkCatalogForTests,
  seedCanbosoBulkCatalogForTests,
} from "./canbosoBulkCatalog";
import type { CanbosoCatalogProduct } from "../adapters/CanbosoAdapter";

function sampleProduct(id: string): CanbosoCatalogProduct {
  return {
    productId: id,
    name: `Product ${id}`,
    stock: 5,
    isAvailable: true,
    supplierPriceToman: 1000,
    supplierCostUsd: 1,
    requiredFields: [],
    raw: {},
  };
}

test("bulk catalog reuses seeded snapshot within maxAge without network", async () => {
  resetCanbosoBulkCatalogForTests();
  seedCanbosoBulkCatalogForTests([sampleProduct("a")], Date.now());
  const snap = await getCanbosoBulkCatalog({ maxAgeMs: 20_000, reason: "test" });
  assert.equal(snap.fromCache, true);
  assert.equal(snap.remoteProducts[0]?.productId, "a");
});

test("buildRemoteIndexes resolves by supplier key", () => {
  const indexes = buildRemoteIndexes([sampleProduct("sku-1")]);
  assert.ok(indexes.byId.get("sku-1"));
});
