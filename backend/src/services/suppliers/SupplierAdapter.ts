import { SupplierApiKey, SupplierProductMapping, SupplierOrder } from "@prisma/client";

export class SupplierError extends Error {
  constructor(public code: string, message: string, public retryable: boolean = false) {
    super(message);
    this.name = "SupplierError";
  }
}

export class SupplierAuthenticationError extends SupplierError {
  constructor(message: string = "Supplier authentication failed") {
    super("AUTH_ERROR", message, false);
  }
}

export class SupplierInsufficientBalanceError extends SupplierError {
  constructor(message: string = "Insufficient balance") {
    super("INSUFFICIENT_BALANCE", message, false);
  }
}

export class SupplierOutOfStockError extends SupplierError {
  constructor(message: string = "Out of stock") {
    super("OUT_OF_STOCK", message, false);
  }
}

export class SupplierProductNotFoundError extends SupplierError {
  constructor(message: string = "Product or variant not found") {
    super("PRODUCT_NOT_FOUND", message, false);
  }
}

export class SupplierRateLimitError extends SupplierError {
  constructor(message: string = "Rate limit exceeded") {
    super("RATE_LIMIT", message, true);
  }
}

export class SupplierTimeoutError extends SupplierError {
  constructor(message: string = "Request timed out") {
    super("TIMEOUT", message, false);
  }
}

export class SupplierNetworkError extends SupplierError {
  constructor(message: string = "Network error") {
    super("NETWORK_ERROR", message, true);
  }
}

export class SupplierInvalidResponseError extends SupplierError {
  constructor(message: string = "Invalid response from supplier") {
    super("INVALID_RESPONSE", message, false);
  }
}

export class SupplierPurchaseUncertainError extends SupplierError {
  constructor(message: string = "Purchase status uncertain due to connection drop/timeout") {
    super("PURCHASE_UNCERTAIN", message, false);
  }
}

export class SupplierUnknownError extends SupplierError {
  constructor(message: string = "Unknown supplier error") {
    super("UNKNOWN_ERROR", message, false);
  }
}

export class SupplierPriceExceededError extends SupplierError {
  constructor(message: string = "Supplier price exceeded maximum allowed limit") {
    super("PRICE_EXCEEDED", message, false);
  }
}

export interface ValidationResult {
  isValid: boolean;
  balance?: number;
  credit?: number;
  errorMessage?: string;
}

export interface SupplierProduct {
  productKey: string;
  name: string;
  deliveryFields?: any[]; // The generic representation of delivery fields
  variants: {
    variantKey: string;
    name: string;
    price: number;
    stock?: number;
  }[];
}

export interface PurchaseResult {
  supplierOrderId: string;
  costAmount: number;
  deliveryPayload: string; // JSON string containing the delivery fields (e.g., credentials)
}

/**
 * Base interface for all external suppliers.
 */
export interface SupplierAdapter {
  /**
   * Identifies the supplier (must match Supplier.name in DB)
   */
  readonly name: string;

  /**
   * Validate an API key and optionally return its current balance.
   */
  validateKey(apiKey: string): Promise<ValidationResult>;

  /**
   * List all products available from this supplier using a specific API key.
   */
  listProducts(apiKey: string): Promise<SupplierProduct[]>;

  /**
   * Get details for a specific product.
   */
  getProductDetails(apiKey: string, productKey: string): Promise<SupplierProduct | null>;

  /**
   * Execute a purchase.
   * If a timeout or network drop occurs during POST, this MUST throw SupplierPurchaseUncertainError.
   * Do NOT automatically retry POST purchases inside the adapter.
   */
  purchase(apiKey: string, mapping: SupplierProductMapping, expectedPrice?: number): Promise<PurchaseResult>;

  /**
   * If a purchase timed out and its state is UNCERTAIN, try to determine if it went through.
   * @param apiKey The API key used for the purchase
   * @param mapping The product mapping
   * @param internalInvoiceId Our internal invoice ID, used as idempotency key if supported, or for manual reconciliation.
   */
  reconcile?(apiKey: string, mapping: SupplierProductMapping, internalInvoiceId: number): Promise<PurchaseResult | null>;
}
