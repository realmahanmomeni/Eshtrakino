import test, { mock } from "node:test";
import assert from "node:assert";
import { QuantumVaultAdapter } from "./quantumvault/QuantumVaultAdapter";
import {
  SupplierPurchaseUncertainError,
  SupplierPriceExceededError,
  SupplierInvalidResponseError,
  SupplierUnknownError,
  SupplierOutOfStockError,
} from "./SupplierAdapter";
import { supplierManager } from "./index";
import { prisma } from "../../lib/prisma";

// ---------------------------------------------------------------------------
// Shared test fixture factories
// ---------------------------------------------------------------------------

/** Minimal SupplierProductMapping used across tests */
function makeMapping(overrides: Partial<{
  supplierProductKey: string;
  supplierVariantKey: string | null;
  maxPriceLimit: number | null;
}> = {}) {
  return {
    id: 1,
    productId: 1,
    supplierId: 1,
    supplierProductKey: overrides.supplierProductKey ?? "gemini_18_month_link",
    supplierVariantKey: overrides.supplierVariantKey ?? null,
    maxPriceLimit: overrides.maxPriceLimit !== undefined ? overrides.maxPriceLimit : null,
    isAutoPurchase: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Build a well-formed POST /purchase success response matching the real
 * QuantumVault API schema (verified 2026-09-23).
 *
 * Root cause of invoice #8: the old parser read data.order.orderId which
 * is ALWAYS undefined. The correct field is data.order.items[0].orderId.
 */
function makePurchaseResponse(overrides: {
  orderId?: any;
  purchaseId?: string;
  totalCharged?: number;
  fulfilled?: number;
  requested?: number;
  fields?: any[];
  data?: object;
  success?: boolean;
  omitItems?: boolean;
  omitOrder?: boolean;
  extraTopLevelKeys?: object;
} = {}) {
  const orderId = overrides.orderId !== undefined ? overrides.orderId : "QV-8F3A21C9";
  const item = {
    orderId,
    purchaseId: overrides.purchaseId ?? "665f1c2e8a3b4d5e6f7a8b9c",
    product: "Gemini Pro 18 Month",
    productKey: "gemini_18_month_link",
    variantKey: null,
    price: overrides.totalCharged ?? 0.25,
    currency: "USD",
    deliveredAt: "2026-07-15T09:24:11.482Z",
    fields: overrides.fields ?? [
      { name: "activation_url", label: "Activation Link", value: "https://gemini.google.com/activate/abc123" }
    ],
    data: overrides.data ?? { activation_url: "https://gemini.google.com/activate/abc123" },
  };

  const order: any = {
    requested: overrides.requested ?? 1,
    fulfilled: overrides.fulfilled ?? 1,
    unitPrice: overrides.totalCharged ?? 0.25,
    totalCharged: overrides.totalCharged ?? 0.25,
    currency: "USD",
  };
  if (!overrides.omitItems) {
    order.items = [item];
  }

  const body: any = {
    ...overrides.extraTopLevelKeys,
  };
  if (overrides.success !== undefined) {
    body.success = overrides.success;
  } else {
    body.success = true;
  }
  if (!overrides.omitOrder) {
    body.order = order;
  }

  return body;
}

/** Create a mock fetch that returns a given body for /purchase */
function mockFetchForPurchase(body: object, status = 200) {
  const original = global.fetch;
  global.fetch = async (url: any, _options: any) => {
    if (String(url).includes("/purchase")) {
      return new Response(JSON.stringify(body), { status });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };
  return () => { global.fetch = original; };
}

// ---------------------------------------------------------------------------
// ORIGINAL TESTS (must still pass)
// ---------------------------------------------------------------------------

test("QuantumVaultAdapter - handles timeout as UNCERTAIN during purchase", async () => {
  const adapter = new QuantumVaultAdapter();
  let purchaseCallCount = 0;
  const originalFetch = global.fetch;
  global.fetch = async (url: any, _options: any) => {
    if (String(url).includes("/purchase")) {
      purchaseCallCount++;
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      throw err;
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };

  try {
    await adapter.purchase("test-key", makeMapping());
    assert.fail("Should have thrown an error");
  } catch (error: any) {
    assert.ok(error instanceof SupplierPurchaseUncertainError, "Must be SupplierPurchaseUncertainError");
  } finally {
    global.fetch = originalFetch;
    assert.strictEqual(purchaseCallCount, 1, "purchaseCallCount must be strictly 1 (no automatic retries)");
  }
});

test("SupplierManager - registers adapter correctly", () => {
  assert.ok(supplierManager.getAdapter("QuantumVault"));
});

test("SupplierManager - price protection blocks purchase if price exceeds limit", async () => {
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

// ---------------------------------------------------------------------------
// REGRESSION TESTS — Response parsing
// ---------------------------------------------------------------------------

test("QuantumVaultAdapter - [REGRESSION] correctly reads orderId from order.items[0].orderId", async () => {
  const adapter = new QuantumVaultAdapter();
  const body = makePurchaseResponse({ orderId: "QV-8F3A21C9" });
  const restore = mockFetchForPurchase(body);

  try {
    const result = await adapter.purchase("key", makeMapping());
    assert.strictEqual(result.supplierOrderId, "QV-8F3A21C9",
      "supplierOrderId must come from order.items[0].orderId, NOT order.orderId");
  } finally {
    restore();
  }
});

test("QuantumVaultAdapter - [REGRESSION] reproduces the invoice #8 failure with old field path", () => {
  // Evidence: the old code did: const order = data.order || data; if (!order.orderId) throw
  // data.order IS truthy (it's an object), so || data never fires.
  // data.order.orderId IS undefined (orderId lives at data.order.items[0].orderId).
  // So the old code always threw "Order ID not found in purchase response."
  const realResponse = makePurchaseResponse({ orderId: "QV-GEMINI-0008" });
  const oldStyleCheck = (data: any) => {
    const order = data.order || data;
    return !order || !order.orderId; // This was the old broken guard
  };
  assert.strictEqual(
    oldStyleCheck(realResponse),
    true,
    "Old code would always throw for the real API response because order.orderId is undefined"
  );

  // New code reads items[0].orderId — must succeed
  const newStyleCheck = (data: any) => {
    const items = data?.order?.items;
    if (!Array.isArray(items) || items.length === 0) return false;
    const orderId = items[0]?.orderId;
    return orderId !== undefined && orderId !== null && orderId !== "";
  };
  assert.strictEqual(
    newStyleCheck(realResponse),
    true,
    "New code correctly finds orderId in order.items[0].orderId"
  );
});

test("QuantumVaultAdapter - orderId returned as string is preserved", async () => {
  const adapter = new QuantumVaultAdapter();
  const restore = mockFetchForPurchase(makePurchaseResponse({ orderId: "QV-STRING-ID" }));
  try {
    const result = await adapter.purchase("key", makeMapping());
    assert.strictEqual(typeof result.supplierOrderId, "string");
    assert.strictEqual(result.supplierOrderId, "QV-STRING-ID");
  } finally { restore(); }
});

test("QuantumVaultAdapter - orderId returned as integer is coerced to string", async () => {
  const adapter = new QuantumVaultAdapter();
  const restore = mockFetchForPurchase(makePurchaseResponse({ orderId: 12345 }));
  try {
    const result = await adapter.purchase("key", makeMapping());
    assert.strictEqual(typeof result.supplierOrderId, "string");
    assert.strictEqual(result.supplierOrderId, "12345");
  } finally { restore(); }
});

test("QuantumVaultAdapter - delivery payload extracted from items[0].fields array", async () => {
  const adapter = new QuantumVaultAdapter();
  const fields = [
    { name: "activation_url", label: "Activation Link", value: "https://example.com/activate/abc" },
    { name: "email", label: "Email", value: "user@example.com" },
  ];
  const restore = mockFetchForPurchase(makePurchaseResponse({ fields }));
  try {
    const result = await adapter.purchase("key", makeMapping());
    const payload = JSON.parse(result.deliveryPayload);
    assert.ok(Array.isArray(payload.fields), "fields must be an array");
    assert.strictEqual(payload.fields.length, 2);
    assert.strictEqual(payload.fields[0].name, "activation_url");
    assert.strictEqual(payload.fields[0].value, "https://example.com/activate/abc");
    assert.strictEqual(payload.fields[1].name, "email");
  } finally { restore(); }
});

test("QuantumVaultAdapter - delivery payload includes purchaseId", async () => {
  const adapter = new QuantumVaultAdapter();
  const restore = mockFetchForPurchase(makePurchaseResponse({ purchaseId: "abc123pid" }));
  try {
    const result = await adapter.purchase("key", makeMapping());
    const payload = JSON.parse(result.deliveryPayload);
    assert.strictEqual(payload.purchaseId, "abc123pid");
  } finally { restore(); }
});

test("QuantumVaultAdapter - totalCharged mapped to costAmount", async () => {
  const adapter = new QuantumVaultAdapter();
  const restore = mockFetchForPurchase(makePurchaseResponse({ totalCharged: 3.75 }));
  try {
    const result = await adapter.purchase("key", makeMapping());
    assert.strictEqual(result.costAmount, 3.75);
  } finally { restore(); }
});

// ---------------------------------------------------------------------------
// REGRESSION TESTS — Missing / malformed response
// ---------------------------------------------------------------------------

test("QuantumVaultAdapter - throws SupplierInvalidResponseError when order.items is missing", async () => {
  const adapter = new QuantumVaultAdapter();
  const body = makePurchaseResponse({ omitItems: true });
  const restore = mockFetchForPurchase(body);
  try {
    await adapter.purchase("key", makeMapping());
    assert.fail("Should have thrown");
  } catch (err: any) {
    assert.ok(err instanceof SupplierInvalidResponseError, "Expected SupplierInvalidResponseError");
    assert.ok(err.message.includes("order.items"), `Expected 'order.items' in message, got: ${err.message}`);
  } finally { restore(); }
});

test("QuantumVaultAdapter - throws SupplierInvalidResponseError when order.items is empty", async () => {
  const adapter = new QuantumVaultAdapter();
  const body = makePurchaseResponse();
  body.order.items = []; // Force empty
  const restore = mockFetchForPurchase(body);
  try {
    await adapter.purchase("key", makeMapping());
    assert.fail("Should have thrown");
  } catch (err: any) {
    assert.ok(err instanceof SupplierInvalidResponseError);
    assert.ok(err.message.includes("order.items"));
  } finally { restore(); }
});

test("QuantumVaultAdapter - throws SupplierInvalidResponseError when 'order' object is missing", async () => {
  const adapter = new QuantumVaultAdapter();
  const body = makePurchaseResponse({ omitOrder: true });
  const restore = mockFetchForPurchase(body);
  try {
    await adapter.purchase("key", makeMapping());
    assert.fail("Should have thrown");
  } catch (err: any) {
    assert.ok(err instanceof SupplierInvalidResponseError);
    assert.ok(err.message.includes("'order'") || err.message.includes("order"), `Got: ${err.message}`);
  } finally { restore(); }
});

test("QuantumVaultAdapter - throws SupplierInvalidResponseError when orderId is missing from item", async () => {
  const adapter = new QuantumVaultAdapter();
  const body = makePurchaseResponse({ orderId: undefined });
  // Remove orderId from item
  delete body.order.items[0].orderId;
  const restore = mockFetchForPurchase(body);
  try {
    await adapter.purchase("key", makeMapping());
    assert.fail("Should have thrown");
  } catch (err: any) {
    assert.ok(err instanceof SupplierInvalidResponseError);
    assert.ok(err.message.includes("orderId"), `Got: ${err.message}`);
  } finally { restore(); }
});

test("QuantumVaultAdapter - throws SupplierInvalidResponseError for empty body", async () => {
  const adapter = new QuantumVaultAdapter();
  const original = global.fetch;
  global.fetch = async (url: any, _options: any) => {
    if (String(url).includes("/purchase")) {
      return new Response("", { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };
  try {
    await adapter.purchase("key", makeMapping());
    assert.fail("Should have thrown");
  } catch (err: any) {
    assert.ok(err instanceof SupplierInvalidResponseError);
  } finally { global.fetch = original; }
});

test("QuantumVaultAdapter - throws SupplierInvalidResponseError for non-JSON body", async () => {
  const adapter = new QuantumVaultAdapter();
  const original = global.fetch;
  global.fetch = async (url: any, _options: any) => {
    if (String(url).includes("/purchase")) {
      return new Response("not-json", { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };
  try {
    await adapter.purchase("key", makeMapping());
    assert.fail("Should have thrown");
  } catch (err: any) {
    assert.ok(err instanceof SupplierInvalidResponseError, `Expected SupplierInvalidResponseError, got: ${err.constructor.name}`);
    assert.ok(err.message.includes("not valid JSON") || err.message.includes("JSON"), `Got: ${err.message}`);
  } finally { global.fetch = original; }
});

// ---------------------------------------------------------------------------
// REGRESSION TESTS — Business-level failures and HTTP errors
// ---------------------------------------------------------------------------

test("QuantumVaultAdapter - throws SupplierUnknownError when success=false despite HTTP 200", async () => {
  const adapter = new QuantumVaultAdapter();
  const body = { success: false, message: "Account blocked by admin." };
  const restore = mockFetchForPurchase(body, 200);
  try {
    await adapter.purchase("key", makeMapping());
    assert.fail("Should have thrown");
  } catch (err: any) {
    assert.ok(err instanceof SupplierUnknownError, `Expected SupplierUnknownError, got: ${err.constructor.name}`);
    assert.ok(err.message.includes("success=false"), `Got: ${err.message}`);
  } finally { restore(); }
});

test("QuantumVaultAdapter - throws SupplierOutOfStockError for HTTP 409", async () => {
  const adapter = new QuantumVaultAdapter();
  const original = global.fetch;
  global.fetch = async (url: any, _options: any) => {
    if (String(url).includes("/purchase")) {
      return new Response(JSON.stringify({ message: "Out of stock" }), { status: 409 });
    }
    return new Response("{}", { status: 200 });
  };
  try {
    await adapter.purchase("key", makeMapping());
    assert.fail("Should have thrown");
  } catch (err: any) {
    assert.ok(err instanceof SupplierOutOfStockError, `Expected SupplierOutOfStockError, got: ${err.constructor.name}`);
  } finally { global.fetch = original; }
});

// ---------------------------------------------------------------------------
// REGRESSION TESTS — Partial delivery (fulfilled < requested)
// ---------------------------------------------------------------------------

test("QuantumVaultAdapter - partial delivery (fulfilled=1, requested=2) succeeds but warns", async () => {
  const adapter = new QuantumVaultAdapter();
  const body = makePurchaseResponse({ fulfilled: 1, requested: 2, orderId: "QV-PARTIAL-001" });
  const restore = mockFetchForPurchase(body);

  const warnMessages: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: any[]) => warnMessages.push(args.join(" "));

  try {
    const result = await adapter.purchase("key", makeMapping());
    // Should still return a valid result for the 1 item that was delivered
    assert.strictEqual(result.supplierOrderId, "QV-PARTIAL-001");
    // Must have warned about partial delivery
    const hasPartialWarn = warnMessages.some(m => m.toLowerCase().includes("partial"));
    assert.ok(hasPartialWarn, `Expected partial delivery warning. Got warnings: ${warnMessages.join(" | ")}`);
  } finally {
    console.warn = originalWarn;
    restore();
  }
});

// ---------------------------------------------------------------------------
// REGRESSION TESTS — reconcile() implementation
// ---------------------------------------------------------------------------

test("QuantumVaultAdapter - reconcile: returns PurchaseResult when exactly one matching order found", async () => {
  const adapter = new QuantumVaultAdapter();
  const recentDate = new Date(Date.now() - 60000).toISOString(); // 1 min ago

  const ordersListBody = {
    orders: [
      {
        orderId: "QV-RECONCILED-001",
        purchaseId: "pid-reconciled",
        productKey: "gemini_18_month_link",
        variantKey: null,
        price: 0.25,
        currency: "USD",
        status: "completed",
        date: recentDate,
      }
    ],
    summary: { totalOrders: 1, totalSpent: 0.25, currency: "USD" }
  };

  const orderDetailBody = {
    order: {
      orderId: "QV-RECONCILED-001",
      purchaseId: "pid-reconciled",
      product: "Gemini Pro 18 Month",
      productKey: "gemini_18_month_link",
      variantKey: null,
      price: 0.25,
      currency: "USD",
      deliveredAt: recentDate,
      fields: [{ name: "activation_url", label: "Activation Link", value: "https://example.com/link" }],
      data: { activation_url: "https://example.com/link" },
    }
  };

  const original = global.fetch;
  global.fetch = async (url: any, _options: any) => {
    const urlStr = String(url);
    if (urlStr.includes("/orders/QV-RECONCILED-001")) {
      return new Response(JSON.stringify(orderDetailBody), { status: 200 });
    }
    if (urlStr.includes("/orders")) {
      return new Response(JSON.stringify(ordersListBody), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };

  try {
    const result = await adapter.reconcile("key", makeMapping(), 8);
    assert.ok(result !== null, "Should have returned a PurchaseResult");
    assert.strictEqual(result!.supplierOrderId, "QV-RECONCILED-001");
    assert.strictEqual(result!.costAmount, 0.25);
    const payload = JSON.parse(result!.deliveryPayload);
    assert.ok(Array.isArray(payload.fields));
    assert.strictEqual(payload.fields[0].name, "activation_url");
  } finally {
    global.fetch = original;
  }
});

test("QuantumVaultAdapter - reconcile: returns null when no matching orders found", async () => {
  const adapter = new QuantumVaultAdapter();
  const original = global.fetch;
  global.fetch = async (url: any, _options: any) => {
    if (String(url).includes("/orders")) {
      return new Response(JSON.stringify({ orders: [], summary: {} }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };
  try {
    const result = await adapter.reconcile("key", makeMapping(), 99);
    assert.strictEqual(result, null, "Should return null when no orders found");
  } finally { global.fetch = original; }
});

test("QuantumVaultAdapter - reconcile: returns null when multiple matching orders are ambiguous", async () => {
  const adapter = new QuantumVaultAdapter();
  const recentDate = new Date(Date.now() - 30000).toISOString();
  const ordersListBody = {
    orders: [
      { orderId: "QV-A", productKey: "gemini_18_month_link", variantKey: null, price: 0.25, date: recentDate, status: "completed" },
      { orderId: "QV-B", productKey: "gemini_18_month_link", variantKey: null, price: 0.25, date: recentDate, status: "completed" },
    ]
  };
  const original = global.fetch;
  global.fetch = async (url: any, _options: any) => {
    if (String(url).includes("/orders")) {
      return new Response(JSON.stringify(ordersListBody), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };
  try {
    const result = await adapter.reconcile("key", makeMapping(), 99);
    assert.strictEqual(result, null, "Should return null on ambiguous matches");
  } finally { global.fetch = original; }
});

test("QuantumVaultAdapter - reconcile: returns null when GET /orders fails", async () => {
  const adapter = new QuantumVaultAdapter();
  const original = global.fetch;
  global.fetch = async (url: any, _options: any) => {
    if (String(url).includes("/orders")) {
      return new Response("Server Error", { status: 500 });
    }
    return new Response("{}", { status: 200 });
  };

  // fetchApi throws SupplierNetworkError for 500, which reconcile catches and returns null
  try {
    const result = await adapter.reconcile("key", makeMapping(), 99);
    assert.strictEqual(result, null, "Should return null when GET /orders fails");
  } finally { global.fetch = original; }
});

// ---------------------------------------------------------------------------
// REGRESSION TESTS — SupplierManager.reconcileUncertain()
// ---------------------------------------------------------------------------

test("SupplierManager - reconcileUncertain: updates order to SUCCESS when adapter resolves", async () => {
  const originalFindUnique_order = prisma.supplierOrder.findUnique;
  const originalFindFirst_mapping = prisma.supplierProductMapping.findFirst;
  const originalUpdate_order = prisma.supplierOrder.update;

  const fakeSupplierOrder = {
    id: 99,
    internalInvoiceId: 8,
    supplierId: 1,
    apiKeyId: 1,
    status: "UNCERTAIN",
    supplierOrderId: null,
    reconciled: false,
    supplier: { id: 1, name: "QuantumVault", isActive: true },
    apiKey: { id: 1, encryptedKey: "test-key" },
  };
  const fakeMapping = {
    id: 1,
    productId: 1,
    supplierId: 1,
    supplierProductKey: "gemini_18_month_link",
    supplierVariantKey: null,
    maxPriceLimit: null,
    isAutoPurchase: true,
    supplier: { id: 1, name: "QuantumVault", isActive: true },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  prisma.supplierOrder.findUnique = mock.fn(async () => fakeSupplierOrder) as any;
  prisma.supplierProductMapping.findFirst = mock.fn(async () => fakeMapping) as any;

  let updatedData: any = null;
  prisma.supplierOrder.update = mock.fn(async ({ data }: any) => {
    updatedData = data;
    return {};
  }) as any;

  const adapter = supplierManager.getAdapter("QuantumVault");
  mock.method(adapter, "reconcile", async () => ({
    supplierOrderId: "QV-RECONCILED-001",
    costAmount: 0.25,
    deliveryPayload: JSON.stringify({ fields: [], purchaseId: "pid" }),
  }));

  try {
    const resolved = await supplierManager.reconcileUncertain(99);
    assert.strictEqual(resolved, true, "Should return true on successful reconciliation");
    assert.ok(updatedData, "update must have been called");
    assert.strictEqual(updatedData.status, "SUCCESS");
    assert.strictEqual(updatedData.supplierOrderId, "QV-RECONCILED-001");
    assert.strictEqual(updatedData.reconciled, true);
  } finally {
    mock.restoreAll();
    prisma.supplierOrder.findUnique = originalFindUnique_order;
    prisma.supplierProductMapping.findFirst = originalFindFirst_mapping;
    prisma.supplierOrder.update = originalUpdate_order;
  }
});

test("SupplierManager - reconcileUncertain: returns false and preserves UNCERTAIN when adapter returns null", async () => {
  const originalFindUnique_order = prisma.supplierOrder.findUnique;
  const originalFindFirst_mapping = prisma.supplierProductMapping.findFirst;
  const originalUpdate_order = prisma.supplierOrder.update;

  const fakeSupplierOrder = {
    id: 100,
    internalInvoiceId: 9,
    supplierId: 1,
    apiKeyId: 1,
    status: "UNCERTAIN",
    supplierOrderId: null,
    reconciled: false,
    supplier: { id: 1, name: "QuantumVault", isActive: true },
    apiKey: { id: 1, encryptedKey: "test-key" },
  };
  const fakeMapping = {
    id: 1,
    productId: 2,
    supplierId: 1,
    supplierProductKey: "gemini_advanced",
    supplierVariantKey: null,
    maxPriceLimit: null,
    isAutoPurchase: true,
    supplier: { id: 1, name: "QuantumVault", isActive: true },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  prisma.supplierOrder.findUnique = mock.fn(async () => fakeSupplierOrder) as any;
  prisma.supplierProductMapping.findFirst = mock.fn(async () => fakeMapping) as any;

  let updateCalled = false;
  prisma.supplierOrder.update = mock.fn(async () => { updateCalled = true; return {}; }) as any;

  const adapter = supplierManager.getAdapter("QuantumVault");
  mock.method(adapter, "reconcile", async () => null);

  try {
    const resolved = await supplierManager.reconcileUncertain(100);
    assert.strictEqual(resolved, false, "Should return false when adapter cannot reconcile");
    assert.strictEqual(updateCalled, false, "update must NOT be called when reconcile returns null");
  } finally {
    mock.restoreAll();
    prisma.supplierOrder.findUnique = originalFindUnique_order;
    prisma.supplierProductMapping.findFirst = originalFindFirst_mapping;
    prisma.supplierOrder.update = originalUpdate_order;
  }
});

test("SupplierManager - reconcileUncertain: returns false when order is not UNCERTAIN", async () => {
  const originalFindUnique = prisma.supplierOrder.findUnique;
  prisma.supplierOrder.findUnique = mock.fn(async () => ({
    id: 101,
    status: "SUCCESS",
    supplier: { name: "QuantumVault" },
    apiKey: { encryptedKey: "key" },
  })) as any;
  try {
    const result = await supplierManager.reconcileUncertain(101);
    assert.strictEqual(result, false, "Should return false for non-UNCERTAIN orders");
  } finally {
    mock.restoreAll();
    prisma.supplierOrder.findUnique = originalFindUnique;
  }
});

test("SupplierManager - reconcileUncertain: returns false when order record not found", async () => {
  const originalFindUnique = prisma.supplierOrder.findUnique;
  prisma.supplierOrder.findUnique = mock.fn(async () => null) as any;
  try {
    const result = await supplierManager.reconcileUncertain(99999);
    assert.strictEqual(result, false);
  } finally {
    mock.restoreAll();
    prisma.supplierOrder.findUnique = originalFindUnique;
  }
});
