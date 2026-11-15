import test from "node:test";
import assert from "node:assert/strict";
import { parseUsdAmount, formatUsdAmount } from "./quantumMoney";
import { mapQuantumStock } from "./quantumStock";
import { expandQuantumCatalog, quantumMappingIdentity } from "./quantumCatalog";

test("stock mapping: unlimited, unknown, and numeric counts", () => {
  assert.deepEqual(mapQuantumStock({ unlimited: true, stock: null }), { kind: "unlimited" });
  assert.deepEqual(mapQuantumStock({ unlimited: false, stock: null }), { kind: "unknown" });
  assert.deepEqual(mapQuantumStock({ stock: null }), { kind: "unknown" });
  assert.deepEqual(mapQuantumStock({ unlimited: false, stock: 12 }), { kind: "count", stock: 12 });
  assert.deepEqual(mapQuantumStock({ unlimited: true, stock: 4 }), { kind: "count", stock: 4 });
  assert.deepEqual(mapQuantumStock({ stock: 0 }), { kind: "count", stock: 0 });
});

test("USD amounts stay on 4 decimal places", () => {
  assert.equal(parseUsdAmount("1.25"), 1.25);
  assert.equal(parseUsdAmount(0.1 + 0.2), 0.3);
  assert.equal(formatUsdAmount(1.2), "1.2000");
  assert.equal(parseUsdAmount(null), null);
});

test("variant products map productKey plus variantKey", () => {
  const units = expandQuantumCatalog({
    products: [
      {
        productKey: "premium_link",
        name: "Premium Link",
        price: null,
        folder: { key: "chatgpt", name: "ChatGPT Plus" },
        offerGroup: "premium-link",
        inStock: true,
        variants: [
          { key: "1_month", name: "1 Month", price: 3.75, stock: 20, inStock: true, unlimited: false },
          { key: "7_days", name: "7 Days", price: "1.20", stock: null, unlimited: true, inStock: true },
        ],
      },
      {
        productKey: "outlook_mail",
        name: "Outlook Mail",
        description: "Fresh accounts",
        price: 0.25,
        stock: null,
        unlimited: false,
        inStock: true,
        folder: null,
        variants: [],
      },
    ],
  });

  assert.equal(units.length, 3);
  assert.deepEqual(quantumMappingIdentity(units[0]!), {
    supplierProductKey: "premium_link",
    supplierVariantKey: "1_month",
  });
  assert.deepEqual(quantumMappingIdentity(units[1]!), {
    supplierProductKey: "premium_link",
    supplierVariantKey: "7_days",
  });
  assert.deepEqual(quantumMappingIdentity(units[2]!), {
    supplierProductKey: "outlook_mail",
    supplierVariantKey: "",
  });
  assert.equal(units[0]!.folder, "ChatGPT Plus");
  assert.equal(units[0]!.stockState.kind, "count");
  assert.equal(units[1]!.stockState.kind, "unlimited");
  assert.equal(units[1]!.priceUsd, 1.2);
  assert.equal(units[2]!.stockState.kind, "unknown");
  assert.equal(units[2]!.folder, null);
  assert.equal(units[2]!.offerGroup, null);
});

test("a string folder from the live catalog is kept", () => {
  const units = expandQuantumCatalog({
    products: [
      {
        productKey: "capcut_pro",
        name: "Capcut",
        price: 2,
        stock: 3,
        inStock: true,
        unlimited: false,
        folder: "Capcut",
        variants: [],
      },
    ],
  });
  assert.equal(units[0]!.folder, "Capcut");
  assert.equal(units[0]!.priceUsd, 2);
});
