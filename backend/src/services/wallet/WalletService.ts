import { InvoiceStatus, type Invoice, type Product, type User } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "../../lib/prisma";
import type { InvoiceWithUserProduct } from "../invoices/InvoiceService";
import { InvoiceInvalidStateError, InvoiceNotFoundError } from "../invoices/InvoiceService";

export class InsufficientBalanceError extends Error {
  constructor() {
    super("Insufficient wallet balance");
    this.name = "InsufficientBalanceError";
  }
}

export class WalletService {
  async getBalance(userId: number): Promise<Decimal> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { balance: true },
    });
    if (!user) throw new Error(`User #${userId} not found`);
    return user.balance;
  }

  async creditTopUp(
    userId: number,
    amount: Decimal | number | string,
    description?: string,
  ): Promise<void> {
    const value = new Decimal(String(amount));
    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { balance: { increment: value } },
      }),
      prisma.walletTransaction.create({
        data: {
          userId,
          amount: value,
          type: "TOPUP",
          description,
        },
      }),
    ]);
  }

  /**
   * Admin balance adjustment: positive credits, negative deducts.
   * Rejects if resulting balance would go below zero.
   */
  async adjustBalanceByAdmin(
    userId: number,
    delta: Decimal | number | string,
    description?: string,
  ): Promise<{ balance: Decimal }> {
    const value = new Decimal(String(delta));
    if (value.isZero()) {
      throw new Error("Adjustment amount must be non-zero");
    }

    return prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { balance: true },
      });
      if (!user) throw new Error(`User #${userId} not found`);

      const next = new Decimal(user.balance.toString()).plus(value);
      if (next.isNegative()) {
        throw new InsufficientBalanceError();
      }

      const updated = await tx.user.update({
        where: { id: userId },
        data: { balance: next },
        select: { balance: true },
      });

      await tx.walletTransaction.create({
        data: {
          userId,
          amount: value.abs(),
          type: value.isPositive() ? "ADMIN_CREDIT" : "ADMIN_DEBIT",
          description: description ?? "تعدیل موجودی توسط ادمین",
        },
      });

      return { balance: updated.balance };
    });
  }

  async debitPurchase(
    userId: number,
    amount: Decimal | number | string,
    description?: string,
  ): Promise<void> {
    const value = new Decimal(String(amount));

    await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { balance: true },
      });
      if (!user) throw new Error(`User #${userId} not found`);

      const balance = new Decimal(user.balance.toString());
      if (balance.lessThan(value)) {
        throw new InsufficientBalanceError();
      }

      await tx.user.update({
        where: { id: userId },
        data: { balance: { decrement: value } },
      });

      await tx.walletTransaction.create({
        data: {
          userId,
          amount: value,
          type: "PURCHASE",
          description,
        },
      });
    });
  }

  async processTopUpApproval(invoiceId: number): Promise<InvoiceWithUserProduct> {
    return prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id: invoiceId },
        include: { user: true, product: true },
      });
      if (!invoice) throw new InvoiceNotFoundError(invoiceId);
      if (!invoice.isWalletTopUp) {
        throw new InvoiceInvalidStateError(invoice, "wallet top-up");
      }
      if (invoice.status !== InvoiceStatus.AWAITING_APPROVAL) {
        throw new InvoiceInvalidStateError(invoice, "AWAITING_APPROVAL");
      }
      if (!invoice.topUpAmount) {
        throw new InvoiceInvalidStateError(invoice, "topUpAmount");
      }

      await tx.user.update({
        where: { id: invoice.userId },
        data: { balance: { increment: invoice.topUpAmount } },
      });

      await tx.walletTransaction.create({
        data: {
          userId: invoice.userId,
          amount: invoice.topUpAmount,
          type: "TOPUP",
          description: `شارژ کیف پول — فاکتور #${invoice.id}`,
        },
      });

      return tx.invoice.update({
        where: { id: invoiceId },
        data: { status: InvoiceStatus.PAID },
        include: { product: true, user: true },
      });
    });
  }

  async processWalletPurchase(invoiceId: number, userId: number): Promise<InvoiceWithUserProduct> {
    return prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id: invoiceId },
        include: { user: true, product: true },
      });
      if (!invoice) throw new InvoiceNotFoundError(invoiceId);
      if (invoice.userId !== userId) throw new InvoiceNotFoundError(invoiceId);
      if (invoice.isWalletTopUp || !invoice.productId || !invoice.product) {
        throw new InvoiceInvalidStateError(invoice, "product purchase");
      }
      if (invoice.status !== InvoiceStatus.PENDING) {
        throw new InvoiceInvalidStateError(invoice, "PENDING");
      }

      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { balance: true },
      });
      if (!user) throw new Error(`User #${userId} not found`);

      const balance = new Decimal(user.balance.toString());
      const price = new Decimal(invoice.amount.toString());
      if (balance.lessThan(price)) {
        throw new InsufficientBalanceError();
      }

      await tx.user.update({
        where: { id: userId },
        data: { balance: { decrement: price } },
      });

      await tx.walletTransaction.create({
        data: {
          userId,
          amount: price,
          type: "PURCHASE",
          description: `خرید محصول — فاکتور #${invoice.id}`,
        },
      });

      return tx.invoice.update({
        where: { id: invoiceId },
        data: { status: InvoiceStatus.PAID },
        include: { product: true, user: true },
      });
    });
  }
}

export const walletService = new WalletService();
