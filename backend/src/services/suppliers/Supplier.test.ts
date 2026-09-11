import test, { mock } from "node:test";
import assert from "node:assert";
import { QuantumVaultAdapter } from "./quantumvault/QuantumVaultAdapter";
import { SupplierPurchaseUncertainError, SupplierPriceExceededError } from "./SupplierAdapter";
import { supplierManager } from "./index";
import { prisma } from "../../lib/prisma";

test("QuantumVaultAdapter - handles timeout as UNCERTAIN during purchase", async (t) => {
  const adapter = new QuantumVaultAdapter();

  let purchaseCallCount = 0;

  // Mock global.fetch to simulate a timeout / AbortError
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    // If it's the purchase endpoint, throw an AbortError to simulate timeout
    if (url.toString().includes("/purchase")) {
      purchaseCallCount++;
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      throw err;
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };

  try {
    // Should throw SupplierPurchaseUncertainError, NOT SupplierNetworkError
    await adapter.purchase("test-key", {
      id: 1,
      productId: 1,
      supplierId: 1,
      supplierProductKey: "test-product",
      supplierVariantKey: "test-variant",
      maxPriceLimit: null,
      isAutoPurchase: true,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    assert.fail("Should have thrown an error");
  } catch (error: any) {
    assert.ok(error instanceof SupplierPurchaseUncertainError, "Must be SupplierPurchaseUncertainError");
  } finally {
    global.fetch = originalFetch; // restore
    assert.strictEqual(purchaseCallCount, 1, "purchaseCallCount === 1 must be strictly 1, meaning no automatic retries.");
  }
});

test("SupplierManager - registers adapter correctly", (t) => {
  assert.ok(supplierManager.getAdapter("QuantumVault"));
});

test("SupplierManager - price protection blocks purchase if price exceeds limit", async (t) => {
  const originalFindUnique = prisma.supplierProductMapping.findUnique;
  prisma.supplierProductMapping.findUnique = mock.fn(async () => ({
    productId: 1,
    supplierId: 1,
    supplierProductKey: "test",
    supplierVariantKey: "variant",
    maxPriceLimit: 5,
    isAutoPurchase: true,
    supplier: { id: 1, name: "QuantumVault", isActive: true }
  })) as any;

  const originalFindFirst = prisma.supplierApiKey.findFirst;
  prisma.supplierApiKey.findFirst = mock.fn(async () => ({
    id: 1, encryptedKey: "key"
  })) as any;

  const adapter = supplierManager.getAdapter("QuantumVault");
  mock.method(adapter, "getProductDetails", async () => ({
    productKey: "test",
    name: "test",
    variants: [{ variantKey: "variant", name: "v", price: 10 }] // Price 10 > limit 5
  }));

  let purchaseCalled = false;
  mock.method(adapter, "purchase", async () => {
    purchaseCalled = true;
    return { supplierOrderId: "1", costAmount: 10, deliveryPayload: "" };
  });

  const originalCreate = prisma.supplierOrder.create;
  const originalUpdate = prisma.supplierOrder.update;
  prisma.supplierOrder.create = mock.fn(async () => ({ id: 1 })) as any;
  prisma.supplierOrder.update = mock.fn(async () => ({})) as any;

  try {
    await supplierManager.processAutoPurchase(1, 1);
    assert.fail("Should have thrown error");
  } catch (err: any) {
    assert.ok(err instanceof SupplierPriceExceededError, "Error must be SupplierPriceExceededError");
  }

  assert.strictEqual(purchaseCalled, false, "Purchase MUST NOT be called if price exceeded");
  
  mock.restoreAll();
  prisma.supplierProductMapping.findUnique = originalFindUnique;
  prisma.supplierApiKey.findFirst = originalFindFirst;
  prisma.supplierOrder.create = originalCreate;
  prisma.supplierOrder.update = originalUpdate;
});
