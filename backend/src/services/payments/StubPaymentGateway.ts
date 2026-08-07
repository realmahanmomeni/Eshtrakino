import type {
  CreatePaymentRequest,
  CreatePaymentResult,
  PaymentGateway,
  PaymentStatusResult,
} from "./PaymentGateway";

/**
 * Placeholder gateway for future fiat/crypto providers.
 * Demonstrates the plug-in shape without touching bot core.
 */
export class StubPaymentGateway implements PaymentGateway {
  readonly id = "stub";
  readonly displayName = "Stub (dev)";

  async createPayment(request: CreatePaymentRequest): Promise<CreatePaymentResult> {
    const externalId = `stub:${request.invoiceId}:${Date.now()}`;
    return {
      externalId,
      instructions:
        `[STUB GATEWAY] Payment created for invoice #${request.invoiceId}.\n` +
        `Amount: ${request.amount} ${request.currency}\n` +
        `Replace this gateway with a real provider (Zarinpal, NOWPayments, etc.).`,
      payUrl: `https://example.com/pay/${externalId}`,
    };
  }

  async getPaymentStatus(externalId: string): Promise<PaymentStatusResult> {
    return {
      externalId,
      paid: false,
      rawStatus: "PENDING",
    };
  }

  async cancelPayment(externalId: string): Promise<void> {
    // no-op for stub
    void externalId;
  }
}
