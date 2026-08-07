import type { PaymentGateway } from "./PaymentGateway";
import { BalancePaymentGateway } from "./BalancePaymentGateway";
import { StubPaymentGateway } from "./StubPaymentGateway";
import { env } from "../../config/env";

const registry: Record<string, () => PaymentGateway> = {
  balance: () => new BalancePaymentGateway(),
  stub: () => new StubPaymentGateway(),
};

/**
 * Factory — register new gateways here only.
 * Bot handlers call `createPaymentGateway()` and never import concrete classes.
 */
export function createPaymentGateway(gatewayId: string = env.PAYMENT_GATEWAY): PaymentGateway {
  const factory = registry[gatewayId];
  if (!factory) {
    throw new Error(
      `Unknown payment gateway "${gatewayId}". Registered: ${Object.keys(registry).join(", ")}`,
    );
  }
  return factory();
}

export function listRegisteredGateways(): string[] {
  return Object.keys(registry);
}

export type { PaymentGateway } from "./PaymentGateway";
