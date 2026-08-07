import type {
  CreatePaymentRequest,
  CreatePaymentResult,
  PaymentGateway,
  PaymentStatusResult,
} from "./PaymentGateway";
import { prisma } from "../../lib/prisma";
import { Decimal } from "@prisma/client/runtime/library";
import { formatToman } from "../../lib/money";

/**
 * Pays from the user's internal wallet balance.
 * Useful for MVP testing and future top-up flows.
 */
export class BalancePaymentGateway implements PaymentGateway {
  readonly id = "balance";
  readonly displayName = "Wallet Balance";

  async createPayment(request: CreatePaymentRequest): Promise<CreatePaymentResult> {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: request.userId },
    });

    const balance = new Decimal(user.balance);
    const amount = new Decimal(request.amount);

    if (balance.lessThan(amount)) {
      return {
        externalId: `balance:insufficient:${request.invoiceId}`,
        instructions:
          `موجودی کیف پول کافی نیست.\n` +
          `مبلغ فاکتور: ${formatToman(amount)}\n` +
          `موجودی فعلی: ${formatToman(balance)}\n` +
          `لطفاً موجودی را افزایش دهید یا فاکتور را لغو کنید.`,
      };
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: request.userId },
        data: { balance: { decrement: amount } },
      });
      await tx.invoice.update({
        where: { id: request.invoiceId },
        data: { status: "PAID" },
      });
    });

    return {
      externalId: `balance:paid:${request.invoiceId}`,
      instructions:
        `✅ پرداخت از موجودی کیف پول با موفقیت انجام شد.\n` +
        `مبلغ: ${formatToman(amount)}\n` +
        `فاکتور #${request.invoiceId}`,
    };
  }

  async getPaymentStatus(externalId: string): Promise<PaymentStatusResult> {
    const paid = externalId.startsWith("balance:paid:");
    return {
      externalId,
      paid,
      rawStatus: paid ? "PAID" : "PENDING",
    };
  }
}
