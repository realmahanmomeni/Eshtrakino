import test from "node:test";
import assert from "node:assert/strict";
import type { Product } from "@prisma/client";
import {
  isSupplierLiveCostChanged,
  SUPPLIER_COST_USD_EPSILON,
} from "./prePaymentGuardService";
import { buildMarginPriceBreakdown } from "./profitMarginService";
import { supplierCostUsdFromRemote } from "../suppliers/canbosoCost";
import type { CanbosoCatalogProduct } from "../suppliers/adapters/CanbosoAdapter";

test("isSupplierLiveCostChanged treats 1.5 vs 1.5 as unchanged", () => {
  assert.equal(isSupplierLiveCostChanged(1.5, 1.5), false);
  assert.equal(
    isSupplierLiveCostChanged(1.5, 1.5 + SUPPLIER_COST_USD_EPSILON / 2),
    false,
  );
});

test("isSupplierLiveCostChanged detects real supplier cost moves", () => {
  assert.equal(isSupplierLiveCostChanged(1.5, 1.55), true);
  assert.equal(isSupplierLiveCostChanged(1.5, 2.0), true);
});

test("supplierCostUsdFromRemote uses price.amount USD not supplierPriceToman", () => {
  const remote: CanbosoCatalogProduct = {
    productId: "147",
    name: "Gemini Pro",
    stock: 56,
    isAvailable: true,
    supplierPriceToman: 2,
    supplierCostUsd: 1.5,
    requiredFields: [],
    raw: { price: { amount: 1.5, currency: "USD" } },
  };
  assert.equal(supplierCostUsdFromRemote(remote, 537_333), 1.5);
});

test("verifyBeforeCheckout scenario: unchanged 1.5 USD keeps 806000 Toman retail", async () => {
  const storedCostUsd = 1.5;
  const liveCostUsd = supplierCostUsdFromRemote(
    {
      productId: "147",
      name: "Gemini Pro",
      stock: 56,
      isAvailable: true,
      supplierPriceToman: 2,
      supplierCostUsd: 1.5,
      requiredFields: [],
      raw: { price: { amount: 1.5, currency: "USD" } },
    },
    537_333,
  );

  assert.equal(liveCostUsd, storedCostUsd);
  assert.equal(isSupplierLiveCostChanged(storedCostUsd, liveCostUsd), false);

  const product = {
    id: 147,
    name: "Gemini",
    supplierCostUsd: storedCostUsd,
    profitMarginPercent: 0,
    price: 806_000,
    usdPrice: 1.5,
    category: null,
    subCategory: null,
  } as Product;

  const breakdown = await buildMarginPriceBreakdown(product, {
    usdRate: 537_333,
    marginPercent: 0,
  });
  assert.ok(breakdown);
  assert.equal(breakdown!.sellingToman, 806_000);

  const wrongCostBreakdown = await buildMarginPriceBreakdown(
    { ...product, supplierCostUsd: 2 },
    { usdRate: 537_333, marginPercent: 0 },
  );
  assert.ok(wrongCostBreakdown);
  assert.equal(wrongCostBreakdown!.sellingToman, 1_075_000);
});
