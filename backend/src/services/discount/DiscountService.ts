import { prisma } from "../../lib/prisma";
import type { Invoice } from "@prisma/client";

export type DiscountCodeRecord = {
  id: number;
  code: string;
  percentage: number;
  maxUses: number | null;
  usedCount: number;
  isActive: boolean;
  appliesToAll: boolean;
  productIds: number[];
  createdAt: Date;
};

export type DiscountValidationResult =
  | {
      valid: true;
      discount: DiscountCodeRecord;
      percentage: number;
      discountAmount: number;
      finalAmount: number;
    }
  | {
      valid: false;
      error: string;
    };

export class DiscountService {
  /**
   * Create a new discount code record.
   */
  async createDiscountCode(data: {
    code: string;
    percentage: number;
    maxUses?: number | null;
    appliesToAll?: boolean;
    productIds?: number[];
  }): Promise<DiscountCodeRecord> {
    const code = data.code.trim().toUpperCase();
    const percentage = Math.min(100, Math.max(1, Math.round(data.percentage)));
    const maxUses =
      data.maxUses != null && data.maxUses > 0
        ? Math.round(data.maxUses)
        : null;
    const appliesToAll = data.appliesToAll ?? true;
    const productIds = Array.isArray(data.productIds) ? data.productIds : [];

    return (prisma as any).discountCode.create({
      data: {
        code,
        percentage,
        maxUses,
        appliesToAll,
        productIds,
        isActive: true,
      },
    });
  }

  /**
   * Find discount code by code string.
   */
  async getByCode(codeStr: string): Promise<DiscountCodeRecord | null> {
    const code = codeStr.trim().toUpperCase();
    return (prisma as any).discountCode.findUnique({
      where: { code },
    });
  }

  /**
   * Validate discount code eligibility and calculate discounted amount.
   */
  async validateAndCalculateDiscount(
    codeStr: string,
    productId: number | null | undefined,
    currentAmount: number,
  ): Promise<DiscountValidationResult> {
    const code = codeStr.trim().toUpperCase();
    const discount: DiscountCodeRecord | null = await this.getByCode(code);

    if (!discount || !discount.isActive) {
      return {
        valid: false,
        error: "کد تخفیف وارد شده معتبر نیست یا غیرفعال شده است.",
      };
    }

    if (discount.maxUses !== null && discount.usedCount >= discount.maxUses) {
      return {
        valid: false,
        error: "ظرفیت استفاده از این کد تخفیف به پایان رسیده است.",
      };
    }

    if (
      !discount.appliesToAll &&
      (!productId || !discount.productIds.includes(Number(productId)))
    ) {
      return {
        valid: false,
        error: "این کد تخفیف برای این محصول قابل استفاده نیست.",
      };
    }

    const discountAmount = Math.round((currentAmount * discount.percentage) / 100);
    const finalAmount = Math.max(0, currentAmount - discountAmount);

    return {
      valid: true,
      discount,
      percentage: discount.percentage,
      discountAmount,
      finalAmount,
    };
  }

  /**
   * Apply discount code to a pending invoice.
   */
  async applyDiscountToInvoice(
    invoiceId: number,
    codeStr: string,
    productId?: number | null,
  ): Promise<{
    invoice: Invoice;
    calc: Extract<DiscountValidationResult, { valid: true }>;
  }> {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
    });

    if (!invoice) {
      throw new Error("فاکتور مورد نظر یافت نشد.");
    }

    if (invoice.status !== "PENDING") {
      throw new Error("این فاکتور دیگر در وضعیت در انتظار پرداخت نیست.");
    }

    const baseAmount = invoice.originalAmount
      ? Number(invoice.originalAmount)
      : Number(invoice.amount);
    const targetProductId = productId ?? invoice.productId;

    const calc = await this.validateAndCalculateDiscount(
      codeStr,
      targetProductId,
      baseAmount,
    );

    if (!calc.valid) {
      throw new Error(calc.error);
    }

    const updated = await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        originalAmount: invoice.originalAmount ?? invoice.amount,
        amount: calc.finalAmount,
        discountCode: calc.discount.code,
        discountPercent: calc.percentage,
        discountAmount: calc.discountAmount,
      } as any,
      include: { product: true, user: true },
    });

    return { invoice: updated, calc };
  }

  /**
   * Atomically increment usedCount by 1 upon successful payment completion.
   */
  async consumeDiscountCode(codeStr: string): Promise<void> {
    if (!codeStr) return;
    const code = codeStr.trim().toUpperCase();
    try {
      await (prisma as any).discountCode.updateMany({
        where: { code },
        data: {
          usedCount: { increment: 1 },
        },
      });
    } catch (err) {
      console.error(`[DiscountService] failed to consume code ${code}:`, err);
    }
  }

  /**
   * List all discount codes ordered by createdAt desc.
   */
  async listAllDiscountCodes(): Promise<DiscountCodeRecord[]> {
    return (prisma as any).discountCode.findMany({
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Delete multiple discount codes by their IDs.
   */
  async deleteDiscountCodes(ids: number[]): Promise<number> {
    if (!ids || ids.length === 0) return 0;
    const res = await (prisma as any).discountCode.deleteMany({
      where: {
        id: { in: ids },
      },
    });
    return res.count ?? 0;
  }
}

export const discountService = new DiscountService();
