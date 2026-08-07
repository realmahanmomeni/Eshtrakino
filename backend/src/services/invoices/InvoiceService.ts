import {
  InvoiceStatus,
  type Invoice,
  type Product,
  type User,
  DeliveryType,
} from "@prisma/client";
import { Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "../../lib/prisma";
import { INVOICE_TTL_MS } from "../../config/env";
import { formatToman } from "../../lib/money";

export const OPEN_INVOICE_STATUSES: InvoiceStatus[] = [
  InvoiceStatus.PENDING,
  InvoiceStatus.AWAITING_RECEIPT,
  InvoiceStatus.AWAITING_APPROVAL,
];

export class PendingInvoiceExistsError extends Error {
  constructor(public readonly pending: Invoice) {
    super(`User already has open invoice #${pending.id}`);
    this.name = "PendingInvoiceExistsError";
  }
}

export class InvoiceNotFoundError extends Error {
  constructor(invoiceId: number) {
    super(`Invoice #${invoiceId} not found`);
    this.name = "InvoiceNotFoundError";
  }
}

export class InvoiceInvalidStateError extends Error {
  constructor(
    public readonly invoice: Invoice,
    expected: string,
  ) {
    super(`Invoice #${invoice.id} is ${invoice.status}, expected ${expected}`);
    this.name = "InvoiceInvalidStateError";
  }
}

/** @deprecated use InvoiceInvalidStateError */
export class InvoiceNotPendingError extends InvoiceInvalidStateError {
  constructor(invoice: Invoice) {
    super(invoice, "PENDING-like open status");
    this.name = "InvoiceNotPendingError";
  }
}

export type InvoiceWithProduct = Invoice & { product: Product | null };
export type InvoiceWithUserProduct = Invoice & {
  product: Product | null;
  user: User;
};

/**
 * Invoice state machine:
 * PENDING → AWAITING_RECEIPT → AWAITING_APPROVAL → PAID
 * Any open status → CANCELLED | EXPIRED
 * At most ONE open invoice per user.
 */
export class InvoiceService {
  async ensureUser(telegramId: bigint): Promise<User> {
    return prisma.user.upsert({
      where: { telegramId },
      create: { telegramId },
      update: {},
    });
  }

  async ensureUserWithStatus(
    telegramId: bigint,
  ): Promise<{ user: User; created: boolean }> {
    const existing = await prisma.user.findUnique({ where: { telegramId } });
    if (existing) {
      return { user: existing, created: false };
    }

    const user = await prisma.user.create({ data: { telegramId } });
    return { user, created: true };
  }

  async getUserByTelegramId(telegramId: bigint): Promise<User | null> {
    return prisma.user.findUnique({ where: { telegramId } });
  }

  async getOpenInvoice(userId: number): Promise<InvoiceWithProduct | null> {
    return prisma.invoice.findFirst({
      where: { userId, status: { in: OPEN_INVOICE_STATUSES } },
      include: { product: true },
      orderBy: { createdAt: "desc" },
    });
  }

  /** Alias kept for older call sites. */
  async getPendingInvoice(userId: number): Promise<InvoiceWithProduct | null> {
    return this.getOpenInvoice(userId);
  }

  async getById(invoiceId: number): Promise<InvoiceWithUserProduct | null> {
    return prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { product: true, user: true },
    });
  }

  /**
   * Create a PENDING invoice from a product id (loads price from DB).
   * Prefer productId over a Product object so grammY conversations never
   * need to pass Prisma Decimal instances through structuredClone.
   */
  async createPendingInvoice(
    userId: number,
    productOrId: Product | number,
    userInputData?: Record<string, string>,
    deliveryPreference?: "READY" | "CREDENTIALS_REQUIRED",
  ): Promise<Invoice> {
    const existing = await this.getOpenInvoice(userId);
    if (existing) {
      throw new PendingInvoiceExistsError(existing);
    }

    const productId = typeof productOrId === "number" ? productOrId : productOrId.id;
    const product =
      typeof productOrId === "number"
        ? await prisma.product.findFirst({
            where: { id: productId, isActive: true, category: { isActive: true } },
          })
        : productOrId;

    if (!product) {
      throw new Error(`Product #${productId} not found or inactive`);
    }

    const expiresAt = new Date(Date.now() + INVOICE_TTL_MS);
    const amount =
      typeof product.price === "object" && product.price !== null
        ? product.price
        : new Decimal(String(product.price));

    return prisma.invoice.create({
      data: {
        userId,
        productId: product.id,
        amount,
        status: InvoiceStatus.PENDING,
        expiresAt,
        deliveryPreference,
        userInputData: userInputData
          ? (userInputData as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
    });
  }

  async createWalletTopUpInvoice(userId: number, topUpAmount: Decimal | number | string): Promise<Invoice> {
    const existing = await this.getOpenInvoice(userId);
    if (existing) {
      throw new PendingInvoiceExistsError(existing);
    }

    const amount = new Decimal(String(topUpAmount));
    const expiresAt = new Date(Date.now() + INVOICE_TTL_MS);

    return prisma.invoice.create({
      data: {
        userId,
        amount,
        topUpAmount: amount,
        isWalletTopUp: true,
        status: InvoiceStatus.PENDING,
        expiresAt,
      },
    });
  }

  invoiceLabel(invoice: {
    isWalletTopUp: boolean;
    product?: { name: string } | null;
  }): string {
    if (invoice.isWalletTopUp) return "شارژ کیف پول";
    return invoice.product?.name ?? "—";
  }

  async setUserInputData(
    invoiceId: number,
    userInputData: Record<string, string>,
  ): Promise<Invoice> {
    return prisma.invoice.update({
      where: { id: invoiceId },
      data: { userInputData: userInputData as Prisma.InputJsonValue },
    });
  }

  async markAwaitingReceipt(invoiceId: number): Promise<Invoice> {
    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new InvoiceNotFoundError(invoiceId);
    if (invoice.status !== InvoiceStatus.PENDING) {
      throw new InvoiceInvalidStateError(invoice, "PENDING");
    }
    return prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: InvoiceStatus.AWAITING_RECEIPT },
    });
  }

  async submitReceipt(invoiceId: number, receiptFileId: string): Promise<Invoice> {
    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new InvoiceNotFoundError(invoiceId);
    if (
      invoice.status !== InvoiceStatus.AWAITING_RECEIPT &&
      invoice.status !== InvoiceStatus.PENDING
    ) {
      throw new InvoiceInvalidStateError(invoice, "AWAITING_RECEIPT|PENDING");
    }
    return prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        receiptFileId,
        status: InvoiceStatus.AWAITING_APPROVAL,
      },
    });
  }

  async approve(invoiceId: number): Promise<InvoiceWithUserProduct> {
    const invoice = await this.getById(invoiceId);
    if (!invoice) throw new InvoiceNotFoundError(invoiceId);
    if (invoice.status !== InvoiceStatus.AWAITING_APPROVAL) {
      throw new InvoiceInvalidStateError(invoice, "AWAITING_APPROVAL");
    }
    return prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: InvoiceStatus.PAID },
      include: { product: true, user: true },
    });
  }

  async getPaidInvoiceForCredentials(
    invoiceId: number,
    telegramId: bigint,
  ): Promise<InvoiceWithUserProduct | null> {
    return prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        status: InvoiceStatus.PAID,
        user: { telegramId },
        OR: [
          { product: { deliveryType: DeliveryType.CREDENTIALS_REQUIRED } },
          {
            product: { deliveryType: DeliveryType.USER_CHOICE },
            deliveryPreference: "CREDENTIALS_REQUIRED",
          },
        ],
      },
      include: { product: true, user: true },
    });
  }

  async saveBuyerCredentials(
    invoiceId: number,
    email: string,
    password: string,
  ): Promise<Invoice> {
    return prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        userInputData: {
          credentialsSubmitted: "true",
          email,
          password,
        },
      },
    });
  }

  async reject(invoiceId: number, reason: string): Promise<InvoiceWithUserProduct> {
    const invoice = await this.getById(invoiceId);
    if (!invoice) throw new InvoiceNotFoundError(invoiceId);
    if (invoice.status !== InvoiceStatus.AWAITING_APPROVAL) {
      throw new InvoiceInvalidStateError(invoice, "AWAITING_APPROVAL");
    }
    return prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status: InvoiceStatus.CANCELLED,
        rejectReason: reason.trim(),
      },
      include: { product: true, user: true },
    });
  }

  async cancelInvoice(userId: number, invoiceId?: number): Promise<Invoice> {
    const open = invoiceId
      ? await prisma.invoice.findFirst({
          where: {
            id: invoiceId,
            userId,
            status: { in: OPEN_INVOICE_STATUSES },
          },
        })
      : await this.getOpenInvoice(userId);

    if (!open) {
      throw new InvoiceNotFoundError(invoiceId ?? 0);
    }

    return prisma.invoice.update({
      where: { id: open.id },
      data: { status: InvoiceStatus.CANCELLED },
    });
  }

  async markPaid(invoiceId: number): Promise<Invoice> {
    return this.approve(invoiceId);
  }

  /**
   * Expire PENDING / AWAITING_RECEIPT past expiresAt.
   * Does not touch AWAITING_APPROVAL (admin review in progress).
   */
  async expireOverdue(): Promise<number> {
    const result = await prisma.invoice.updateMany({
      where: {
        status: {
          in: [InvoiceStatus.PENDING, InvoiceStatus.AWAITING_RECEIPT],
        },
        expiresAt: { lte: new Date() },
      },
      data: { status: InvoiceStatus.EXPIRED },
    });
    return result.count;
  }

  formatAmount(amount: Decimal | string | number): string {
    return formatToman(amount);
  }

  async countByStatus(status: InvoiceStatus): Promise<number> {
    return prisma.invoice.count({ where: { status } });
  }

  async getReceiptHubCounts(): Promise<{
    pending: number;
    approved: number;
    rejected: number;
  }> {
    const [pending, approved, rejected] = await Promise.all([
      this.countByStatus(InvoiceStatus.AWAITING_APPROVAL),
      this.countByStatus(InvoiceStatus.PAID),
      this.countByStatus(InvoiceStatus.CANCELLED),
    ]);
    return { pending, approved, rejected };
  }

  async listByStatusRecent(
    status: InvoiceStatus,
    take = 15,
  ): Promise<InvoiceWithUserProduct[]> {
    return prisma.invoice.findMany({
      where: { status },
      include: { product: true, user: true },
      orderBy: { id: "desc" },
      take,
    });
  }
}

export const invoiceService = new InvoiceService();
