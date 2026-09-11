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
      deliveryFields: p.deliverFields || [], // Mapping deliverFields to standard deliveryFields
      variants: Array.isArray(p.variants) ? p.variants.map((v: any) => ({
        variantKey: v.variantKey || v.id,
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
        variantKey: v.variantKey || v.id,
        name: v.name || "Default",
        price: v.price || 0,
        stock: v.stock,
      })) : [],
    };
  }

  async purchase(apiKey: string, mapping: SupplierProductMapping, expectedPrice?: number): Promise<PurchaseResult> {
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

      if (response.status === 400 && (errorText.toLowerCase().includes("stock") || errorData.code === "OUT_OF_STOCK")) {
        throw new SupplierOutOfStockError(errorData.message || "Product is out of stock.");
      }
      if (response.status === 400 && errorText.toLowerCase().includes("balance")) {
        throw new SupplierInsufficientBalanceError(errorData.message || "Insufficient wallet balance.");
      }
      if (response.status === 404) {
        throw new SupplierProductNotFoundError(errorData.message || "Product or variant not found.");
      }

      // If the API returns some other 4xx or 5xx that wasn't caught by fetchApi
      throw new SupplierUnknownError(`Purchase failed with HTTP ${response.status}: ${errorText}`);
    }

    // Success response parsing
    const data: any = await response.json();
    /* Documented response contains:
      order.orderId
      order.status
      order.productKey
      order.variantKey
      order.quantity
      order.totalCharged
      order.items[].fields
      order.createdAt
    */
    const order = data.order || data;
    if (!order || !order.orderId) {
      throw new SupplierInvalidResponseError("Order ID not found in purchase response.");
    }

    // Price protection check after the fact (if they charged more than we configured)
    if (mapping.maxPriceLimit && order.totalCharged > Number(mapping.maxPriceLimit)) {
      // Note: we can't un-purchase it, but we can flag it by throwing a specific error or logging.
      // Ideally, price protection happens via a pre-check, but this verifies post-charge.
      console.error(`PRICE ALERT: Charged ${order.totalCharged} which exceeds max limit ${mapping.maxPriceLimit}`);
    }

    // Extract delivery fields from items[0].deliverFields or fields
    let deliveryPayload = "";
    if (order.items && Array.isArray(order.items) && order.items.length > 0) {
      deliveryPayload = JSON.stringify(order.items[0].deliverFields || order.items[0].fields || {});
    }

    return {
      supplierOrderId: String(order.orderId),
      costAmount: Number(order.totalCharged) || 0,
      deliveryPayload,
    };
  }

  async reconcile(apiKey: string, mapping: SupplierProductMapping, internalInvoiceId: number): Promise<PurchaseResult | null> {
    // QuantumVault docs mention GET /orders/:orderId, but we might not have the orderId if it timed out!
    // Since we don't have a known idempotency key or clientRef mechanism documented,
    // safe reconciliation might be impossible without manual intervention or querying a hypothetical /orders list.
    // For MVP: return null, requiring manual admin review.
    return null;
  }
}

// Register adapter to the singleton manager (can be done in a central index/bootstrap)
// supplierManager.registerAdapter(new QuantumVaultAdapter());
