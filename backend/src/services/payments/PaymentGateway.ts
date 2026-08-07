/**
 * Payment gateway contract.
 *
 * Core bot / invoice logic depends only on this interface.
 * New fiat or crypto providers: implement PaymentGateway and register
 * in `createPaymentGateway()` — zero changes to purchase handlers.
 */

export type PaymentCurrency = "IRR" | "USD" | "USDT" | "BTC" | "ETH";

export interface CreatePaymentRequest {
  invoiceId: number;
  userId: number;
  telegramId: bigint;
  amount: number;
  currency: PaymentCurrency;
  description: string;
  /** Absolute or deep-link return URL when applicable */
  returnUrl?: string;
}

export interface CreatePaymentResult {
  /** External provider reference (order id, tx hash placeholder, etc.) */
  externalId: string;
  /** Human-readable payment instructions for Telegram */
  instructions: string;
  /** Optional pay URL / deep link */
  payUrl?: string;
}

export interface PaymentStatusResult {
  externalId: string;
  paid: boolean;
  rawStatus: string;
}

export interface PaymentGateway {
  readonly id: string;
  readonly displayName: string;

  createPayment(request: CreatePaymentRequest): Promise<CreatePaymentResult>;

  /**
   * Poll or verify payment status for an existing invoice.
   * Webhook-driven gateways may no-op and rely on callbacks instead.
   */
  getPaymentStatus(externalId: string): Promise<PaymentStatusResult>;

  /** Optional: cancel a pending provider-side payment */
  cancelPayment?(externalId: string): Promise<void>;
}
