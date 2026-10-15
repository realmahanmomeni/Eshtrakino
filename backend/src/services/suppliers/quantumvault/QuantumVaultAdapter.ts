import {
  SupplierAdapter,
  SupplierProduct,
  ValidationResult,
  PurchaseResult,
  SupplierAuthenticationError,
  SupplierInsufficientBalanceError,
  SupplierOutOfStockError,
  SupplierProductNotFoundError,
  SupplierRateLimitError,
  SupplierNetworkError,
  SupplierInvalidResponseError,
  SupplierPurchaseUncertainError,
  SupplierUnknownError
} from "../SupplierAdapter";
import { SupplierProductMapping } from "@prisma/client";

export class QuantumVaultAdapter implements SupplierAdapter {
  readonly name = "QuantumVault";
  private readonly baseUrl = "https://www.quantumvault.me/api/v1";

  private async fetchApi(endpoint: string, apiKey: string, options: RequestInit = {}): Promise<Response> {
    const headers = new Headers(options.headers || {});
    headers.set("X-API-Key", apiKey);
    headers.set("Content-Type", "application/json");

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers,
      });

      // Handle common supplier HTTP errors here
      if (response.status === 401 || response.status === 403) {
        throw new SupplierAuthenticationError("Invalid or revoked API key.");
      }
      if (response.status === 429) {
        const reset = response.headers.get("X-RateLimit-Reset");
        const remaining = response.headers.get("X-RateLimit-Remaining");
        throw new SupplierRateLimitError(`Rate limit exceeded. Remaining: ${remaining}, Reset: ${reset}`);
      }
      if (response.status >= 500) {
        throw new SupplierNetworkError(`QuantumVault Server Error: ${response.status}`);
      }

      return response;
    } catch (error: any) {
      if (error instanceof SupplierAuthenticationError ||
          error instanceof SupplierRateLimitError ||
          error instanceof SupplierNetworkError) {
        throw error; // Re-throw already mapped errors
      }

      if (error.name === "AbortError") {
        // If this is a POST /purchase, we should NOT catch it here as a simple network error
        // The caller (purchase method) provides AbortSignal and must handle it to throw UncertainError
        throw error;
      }

      throw new SupplierNetworkError(`Network/Transport error: ${error.message}`);
    }
  }

  async validateKey(apiKey: string): Promise<ValidationResult> {
    try {
      const response = await this.fetchApi("/balance", apiKey);
      if (!response.ok) {
        return { isValid: false, errorMessage: `HTTP ${response.status}` };
      }
      const data: any = await response.json();
      const balance = typeof data.balance === 'number' ? data.balance : undefined;
      const credit = typeof data.credit === 'number' ? data.credit : undefined;
      return { isValid: true, balance, credit };
    } catch (error: any) {
      return { isValid: false, errorMessage: error.message };
    }
  }

  async listProducts(apiKey: string): Promise<SupplierProduct[]> {
    const response = await this.fetchApi("/products", apiKey);
    if (!response.ok) {
      throw new SupplierInvalidResponseError(`Failed to list products: HTTP ${response.status}`);
    }
    const data: any = await response.json();
    const products = data.products;
    if (!Array.isArray(products)) {
      throw new SupplierInvalidResponseError("Expected products array in response.");
    }

    return products.map((p: any) => ({
      productKey: p.productKey || p.id,
      name: p.name || "Unknown Product",
      deliveryFields: p.deliverFields || [],
      variants: Array.isArray(p.variants) ? p.variants.map((v: any) => ({
        variantKey: v.variantKey || v.key || v.id,
        name: v.name || "Default",
        price: v.price || 0,
        stock: v.stock,
      })) : [],
    }));
  }

  async getProductDetails(apiKey: string, productKey: string): Promise<SupplierProduct | null> {
    const response = await this.fetchApi(`/products/${productKey}`, apiKey);
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new SupplierInvalidResponseError(`Failed to get product details: HTTP ${response.status}`);
    }
    const responseData: any = await response.json();
    const data = responseData.product;
    if (!data) {
      throw new SupplierInvalidResponseError("Expected product object in response.");
    }

    return {
      productKey: data.productKey || data.id,
      name: data.name || "Unknown Product",
      deliveryFields: data.deliverFields || [],
      variants: Array.isArray(data.variants) ? data.variants.map((v: any) => ({
        variantKey: v.variantKey || v.key || v.id,
        name: v.name || "Default",
        price: v.price || 0,
        stock: v.stock,
      })) : [],
    };
  }

  async purchase(
    apiKey: string,
    mapping: SupplierProductMapping,
    expectedPrice?: number,
    _context?: import("../SupplierAdapter").SupplierPurchaseContext,
  ): Promise<PurchaseResult> {
    const signal = AbortSignal.timeout(15000); // 15s timeout for purchase

    let response: Response;
    try {
      const payload: any = {
        productKey: mapping.supplierProductKey,
        quantity: 1, // Eshtrakino currently assumes qty 1 for digital products per invoice
      };
      if (mapping.supplierVariantKey) {
        payload.variantKey = mapping.supplierVariantKey;
      }

      response = await this.fetchApi("/purchase", apiKey, {
        method: "POST",
        body: JSON.stringify(payload),
        signal,
      });
    } catch (error: any) {
      if (error.name === "AbortError" || error instanceof SupplierNetworkError) {
        // We LOST connection or TIMED OUT during a POST request.
        // We do NOT know if QuantumVault received the request and processed the purchase.
        // MUST throw UncertainError to enter reconciliation.
        throw new SupplierPurchaseUncertainError(
          `Connection lost or timed out during POST /purchase. Order state is uncertain. Original error: ${error.message}`
        );
      }
      throw error;
    }

    // Process HTTP errors from the purchase endpoint
    if (!response.ok) {
      const errorText = await response.text();
      let errorData: any = {};
      try { errorData = JSON.parse(errorText); } catch (e) {}

      // 409 = Out of stock (documented QuantumVault status code)
      if (response.status === 409) {
        throw new SupplierOutOfStockError(errorData.message || "Product is out of stock.");
      }
      if (response.status === 400 && (errorText.toLowerCase().includes("stock") || errorData.code === "OUT_OF_STOCK")) {
        throw new SupplierOutOfStockError(errorData.message || "Product is out of stock.");
      }
      if (response.status === 400 && errorText.toLowerCase().includes("balance")) {
        throw new SupplierInsufficientBalanceError(errorData.message || "Insufficient wallet balance.");
      }
      if (response.status === 404) {
        throw new SupplierProductNotFoundError(errorData.message || "Product or variant not found.");
      }

      // Other 4xx or 5xx not caught by fetchApi
      throw new SupplierUnknownError(`Purchase failed with HTTP ${response.status}: ${errorText.slice(0, 200)}`);
    }

    // -----------------------------------------------------------------------
    // SUCCESS RESPONSE PARSING
    //
    // Actual POST /purchase schema (verified vs. live QuantumVault API docs, 2026-09-23):
    //
    //   {
    //     "success": true,
    //     "order": {
    //       "requested": 1,
    //       "fulfilled": 1,
    //       "unitPrice": 0.25,
    //       "totalCharged": 0.25,
    //       "currency": "USD",
    //       "items": [
    //         {
    //           "orderId":    "QV-8F3A21C9",
    //           "purchaseId": "665f1c2e8a3b4d5e6f7a8b9c",
    //           "product":    "Outlook Mail",
    //           "productKey": "outlook_mail",
    //           "variantKey": null,
    //           "price":      0.25,
    //           "currency":   "USD",
    //           "deliveredAt":"2026-07-15T09:24:11.482Z",
    //           "fields":     [ { "name": "email", "label": "Email", "value": "..." } ],
    //           "data":       { "email": "..." }
    //         }
    //       ]
    //     }
    //   }
    //
    // ROOT CAUSE OF INVOICE #8 BUG:
    //   The old parser read `data.order.orderId` which is ALWAYS undefined.
    //   The correct location is `data.order.items[0].orderId`.
    // -----------------------------------------------------------------------

    let data: any;
    try {
      data = await response.json();
    } catch (e) {
      throw new SupplierInvalidResponseError(
        "QuantumVault purchase response is not valid JSON."
      );
    }

    if (!data || typeof data !== "object") {
      throw new SupplierInvalidResponseError(
        "QuantumVault purchase response is empty or not an object."
      );
    }

    // Business-level success check — HTTP 200 does not guarantee a completed purchase
    if (data.success === false) {
      const msg = (data.message || data.error || "Supplier reported business-level failure.") as string;
      throw new SupplierUnknownError(`QuantumVault purchase rejected (success=false): ${msg}`);
    }

    const order = data.order;
    if (!order || typeof order !== "object") {
      throw new SupplierInvalidResponseError(
        `QuantumVault purchase response missing 'order' object. ` +
        `Top-level keys: [${Object.keys(data).join(", ")}]`
      );
    }

    const items: any[] = order.items;
    if (!Array.isArray(items) || items.length === 0) {
      throw new SupplierInvalidResponseError(
        `QuantumVault purchase response 'order.items' is missing or empty. ` +
        `order keys: [${Object.keys(order).join(", ")}]`
      );
    }

    // We purchase qty=1, so items[0] is our single delivered unit.
    const item = items[0]!;

    // orderId is the per-unit supplier reference — critical for recovery via GET /orders/:orderId
    const rawOrderId = item.orderId;
    if (rawOrderId === undefined || rawOrderId === null || rawOrderId === "") {
      throw new SupplierInvalidResponseError(
        `QuantumVault purchase response item missing 'orderId'. ` +
        `item keys: [${Object.keys(item).join(", ")}]`
      );
    }
    const supplierOrderId = String(rawOrderId);

    // Post-purchase price check — can't undo, but alert for admin review
    const totalCharged = Number(order.totalCharged) || 0;
    if (mapping.maxPriceLimit && totalCharged > Number(mapping.maxPriceLimit)) {
      console.error(
        `[QuantumVault] PRICE ALERT: productKey=${mapping.supplierProductKey} ` +
        `charged=${totalCharged} exceeds maxPriceLimit=${mapping.maxPriceLimit} orderId=${supplierOrderId}`
      );
    }

    // Partial delivery warning (order.fulfilled < order.requested)
    const fulfilled = Number(order.fulfilled) || 0;
    const requested = Number(order.requested) || 1;
    if (fulfilled > 0 && fulfilled < requested) {
      console.warn(
        `[QuantumVault] Partial delivery: productKey=${mapping.supplierProductKey} ` +
        `requested=${requested} fulfilled=${fulfilled} orderId=${supplierOrderId}`
      );
    }

    const deliveryPayload = extractDeliveryPayload(item);

    console.log(
      `[QuantumVault] Purchase OK: productKey=${mapping.supplierProductKey} ` +
      `orderId=${supplierOrderId} totalCharged=${totalCharged} ` +
      `fieldsCount=${Array.isArray(item.fields) ? item.fields.length : 0}`
    );

    return {
      supplierOrderId,
      costAmount: totalCharged,
      deliveryPayload,
    };
  }

  async reconcile(
    apiKey: string,
    mapping: SupplierProductMapping,
    internalInvoiceId: number
  ): Promise<PurchaseResult | null> {
    // Recovery path for PURCHASE_UNCERTAIN state (timeout/network drop during POST).
    //
    // QuantumVault API docs state:
    //   "A timeout does not mean the purchase failed — it may have succeeded.
    //    Call GET /orders to find the order, then GET /orders/:orderId to fetch
    //    the delivered fields you already paid for."
    //
    // Strategy:
    //   1. GET /orders to list recent orders.
    //   2. Filter by productKey + variantKey within a 5-minute lookback window.
    //   3. Exactly ONE match  → GET /orders/:orderId → return PurchaseResult.
    //   4. Zero or ambiguous  → return null (manual admin review required).
    //
    // We return null (not throw) on any intermediate error so the caller preserves
    // UNCERTAIN status rather than incorrectly marking the order FAILED.

    const RECONCILE_LOOKBACK_MS = 5 * 60 * 1000; // 5 minutes

    console.log(
      `[QuantumVault] Reconciling uncertain purchase: internalInvoiceId=${internalInvoiceId} ` +
      `productKey=${mapping.supplierProductKey}`
    );

    let ordersResponse: Response;
    try {
      ordersResponse = await this.fetchApi("/orders", apiKey);
    } catch (error: any) {
      console.error(`[QuantumVault] reconcile: GET /orders failed: ${error.message}`);
      return null;
    }

    if (!ordersResponse.ok) {
      console.error(`[QuantumVault] reconcile: GET /orders returned HTTP ${ordersResponse.status}`);
      return null;
    }

    let ordersData: any;
    try {
      ordersData = await ordersResponse.json();
    } catch (e) {
      console.error("[QuantumVault] reconcile: GET /orders returned non-JSON body");
      return null;
    }

    const orderList: any[] = Array.isArray(ordersData?.orders) ? ordersData.orders : [];
    if (orderList.length === 0) {
      console.log("[QuantumVault] reconcile: GET /orders returned empty list — cannot auto-reconcile.");
      return null;
    }

    const now = Date.now();
    const cutoff = now - RECONCILE_LOOKBACK_MS;

    const candidates = orderList.filter((o: any) => {
      if (o.productKey !== mapping.supplierProductKey) return false;
      if (mapping.supplierVariantKey && o.variantKey !== mapping.supplierVariantKey) return false;
      const dateMs = o.date ? new Date(o.date).getTime() : NaN;
      // Exclude orders clearly outside the lookback window; include if date is absent/unparseable
      if (!isNaN(dateMs) && dateMs < cutoff) return false;
      return true;
    });

    if (candidates.length === 0) {
      console.log(
        `[QuantumVault] reconcile: no matching recent orders for productKey=${mapping.supplierProductKey}. ` +
        `Manual admin review required.`
      );
      return null;
    }

    if (candidates.length > 1) {
      // Ambiguous — cannot safely determine which order belongs to this invoice
      console.warn(
        `[QuantumVault] reconcile: ${candidates.length} candidate orders found for ` +
        `productKey=${mapping.supplierProductKey} — ambiguous, manual admin review required.`
      );
      return null;
    }

    // Exactly one match — fetch its full delivery details
    const candidate = candidates[0]!;
    const candidateOrderId = String(candidate.orderId);

    console.log(
      `[QuantumVault] reconcile: fetching delivery for orderId=${candidateOrderId} ` +
      `(internalInvoiceId=${internalInvoiceId})`
    );

    let detailResponse: Response;
    try {
      detailResponse = await this.fetchApi(`/orders/${encodeURIComponent(candidateOrderId)}`, apiKey);
    } catch (error: any) {
      console.error(`[QuantumVault] reconcile: GET /orders/${candidateOrderId} failed: ${error.message}`);
      return null;
    }

    if (!detailResponse.ok) {
      console.error(
        `[QuantumVault] reconcile: GET /orders/${candidateOrderId} returned HTTP ${detailResponse.status}`
      );
      return null;
    }

    let detailData: any;
    try {
      detailData = await detailResponse.json();
    } catch (e) {
      console.error(`[QuantumVault] reconcile: GET /orders/${candidateOrderId} returned non-JSON body`);
      return null;
    }

    // GET /orders/:orderId → { order: { orderId, purchaseId, fields, data, price, ... } }
    const detailOrder = detailData?.order;
    if (!detailOrder || typeof detailOrder !== "object") {
      console.error(
        `[QuantumVault] reconcile: GET /orders/${candidateOrderId} response missing 'order' object.`
      );
      return null;
    }

    const resolvedOrderId = String(detailOrder.orderId || candidateOrderId);
    const deliveryPayload = extractDeliveryPayload(detailOrder);
    const costAmount = Number(detailOrder.price) || Number(candidate.price) || 0;

    console.log(
      `[QuantumVault] reconcile: success — resolved orderId=${resolvedOrderId} for ` +
      `internalInvoiceId=${internalInvoiceId}`
    );

    return {
      supplierOrderId: resolvedOrderId,
      costAmount,
      deliveryPayload,
    };
  }
}

/**
 * Extracts a JSON delivery payload from a QuantumVault delivered item object.
 *
 * Works for:
 *   - Items inside POST /purchase response   (order.items[])
 *   - Single-order from GET /orders/:orderId (the 'order' object itself)
 *
 * Schema of the delivered item:
 *   fields:     [{ name, label, value }]  — delivery details in display order
 *   data:       { fieldName: value }       — same values, keyed by field name
 *   purchaseId: string                     — internal purchase reference
 *
 * We store fields[] as the canonical payload (preserves labels/order for display).
 * purchaseId is included for potential re-delivery or audit.
 */
function extractDeliveryPayload(item: any): string {
  if (!item || typeof item !== "object") {
    return JSON.stringify({});
  }

  const fields = Array.isArray(item.fields) ? item.fields : [];
  const purchaseId: string | null = item.purchaseId ?? null;

  return JSON.stringify({
    fields,
    purchaseId,
    ...(item.data && typeof item.data === "object" ? { data: item.data } : {}),
  });
}

// Register adapter to the singleton manager (done in the central index/bootstrap)
// supplierManager.registerAdapter(new QuantumVaultAdapter());
