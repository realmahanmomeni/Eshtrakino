import test from "node:test";
import assert from "node:assert/strict";
import { QuantumRequestGate } from "./quantumLimiter";
import { QuantumVaultHttpClient } from "./quantumVaultHttp";
import { QuantumVaultAdapter } from "./QuantumVaultAdapter";

const SECRET = "qv_live_SECRETVALUE";

test("GET retries 503 and POST /purchase is not retried", async () => {
  let gets = 0;
  const getClient = new QuantumVaultHttpClient({
    gate: new QuantumRequestGate({ maxPerMinute: 60, maxConcurrent: 2 }),
    fetchImpl: async () => {
      gets += 1;
      if (gets < 3) {
        return new Response(JSON.stringify({ message: "temporary" }), {
          status: 503,
          headers: { "Retry-After": "0" },
        });
      }
      return new Response(JSON.stringify({ balance: 1.5, credit: 0, currency: "USD" }), {
        status: 200,
      });
    },
  });

  const balance = await getClient.request("/balance", SECRET, { retry: true });
  assert.equal(balance.ok, true);
  assert.equal(gets, 3);

  let posts = 0;
  const postClient = new QuantumVaultHttpClient({
    gate: new QuantumRequestGate({ maxPerMinute: 60, maxConcurrent: 2 }),
    fetchImpl: async () => {
      posts += 1;
      const error = new Error("socket hang up");
      error.name = "AbortError";
      throw error;
    },
  });

  await assert.rejects(
    () => postClient.request("/purchase", SECRET, { method: "POST", body: { productKey: "outlook_mail" }, retry: false }),
    (error: Error) => {
      assert.equal(posts, 1);
      assert.doesNotMatch(error.message, /SECRETVALUE/);
      return true;
    },
  );
});

test("error text redacts the API key and purchase timeout stays uncertain", async () => {
  const client = new QuantumVaultHttpClient({
    gate: new QuantumRequestGate(),
    fetchImpl: async () =>
      new Response(JSON.stringify({ message: `bad key ${SECRET}` }), { status: 401 }),
  });
  const result = await client.request("/me", SECRET, { retry: true });
  assert.equal(result.status, 401);
  assert.match(result.message, /\[redacted\]/);
  assert.doesNotMatch(result.message, /SECRETVALUE/);

  const adapter = new QuantumVaultAdapter(
    new QuantumVaultHttpClient({
      gate: new QuantumRequestGate(),
      fetchImpl: async () => {
        const error = new Error("The operation was aborted");
        error.name = "TimeoutError";
        throw error;
      },
    }),
  );

  await assert.rejects(
    () =>
      adapter.purchase(
        SECRET,
        {
          id: 1,
          productId: 1,
          supplierId: 1,
          supplierProductKey: "outlook_mail",
          supplierVariantKey: null,
          supplierOfferGroup: null,
          maxPriceLimit: null,
          isAutoPurchase: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        undefined,
        { internalInvoiceId: 42 },
      ),
    (error: Error) => {
      assert.match(error.message, /not retried/i);
      assert.doesNotMatch(error.message, /SECRETVALUE/);
      assert.equal(error.name, "SupplierError");
      return true;
    },
  );
});
