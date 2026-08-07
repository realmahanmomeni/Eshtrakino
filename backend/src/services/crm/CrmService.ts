import { InvoiceStatus, type Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "../../lib/prisma";
import { formatToman } from "../../lib/money";

export interface CrmStats {
  totalUsers: number;
  paidInvoices: number;
  pendingInvoices: number;
  awaitingApproval: number;
  cancelledInvoices: number;
  expiredInvoices: number;
  totalRevenue: Decimal;
}

export interface AdvancedCrmStats {
  totalUsers: number;
  /** PAID invoices that went through card-to-card (receipt uploaded). */
  cardRevenue: Decimal;
  /** PAID invoices without a receipt (gateway / wallet / other). */
  gatewayRevenue: Decimal;
  totalRevenue: Decimal;
  paidCount: number;
  /** Admin rejected (CANCELLED with rejectReason). */
  adminRejectedCount: number;
  /** Buyer cancelled (CANCELLED without rejectReason). */
  userCancelledCount: number;
  /** Abandoned checkout (EXPIRED). */
  expiredCount: number;
}

function createdAtFilter(startDate?: Date): { createdAt?: { gte: Date } } {
  return startDate ? { createdAt: { gte: startDate } } : {};
}

export class CrmService {
  async getStats(startDate?: Date): Promise<CrmStats> {
    const advanced = await this.getAdvancedStats(startDate);
    const time = createdAtFilter(startDate);
    const [pendingInvoices, awaitingApproval, cancelledInvoices] = await Promise.all([
      prisma.invoice.count({
        where: {
          ...time,
          status: {
            in: [InvoiceStatus.PENDING, InvoiceStatus.AWAITING_RECEIPT],
          },
        },
      }),
      prisma.invoice.count({
        where: { ...time, status: InvoiceStatus.AWAITING_APPROVAL },
      }),
      prisma.invoice.count({
        where: { ...time, status: InvoiceStatus.CANCELLED },
      }),
    ]);

    return {
      totalUsers: advanced.totalUsers,
      paidInvoices: advanced.paidCount,
      pendingInvoices,
      awaitingApproval,
      cancelledInvoices,
      expiredInvoices: advanced.expiredCount,
      totalRevenue: advanced.totalRevenue,
    };
  }

  /**
   * Detailed funnel + revenue breakdown.
   *
   * Invoice has no paymentMethodId FK yet, so CARD vs GATEWAY is inferred:
   * - CARD → PAID with receiptFileId (card-to-card receipt flow)
   * - GATEWAY → PAID without receiptFileId (online gateway / wallet)
   *
   * When `startDate` is set, all aggregations filter `createdAt >= startDate`
   * (users use `joinedAt`).
   */
  async getAdvancedStats(startDate?: Date): Promise<AdvancedCrmStats> {
    const invTime = createdAtFilter(startDate);
    const userWhere: Prisma.UserWhereInput = startDate
      ? { joinedAt: { gte: startDate } }
      : {};

    const [
      totalUsers,
      cardAgg,
      gatewayAgg,
      paidCount,
      adminRejectedCount,
      userCancelledCount,
      expiredCount,
    ] = await Promise.all([
      prisma.user.count({ where: userWhere }),

      prisma.invoice.aggregate({
        where: {
          ...invTime,
          status: InvoiceStatus.PAID,
          receiptFileId: { not: null },
        },
        _sum: { amount: true },
      }),

      prisma.invoice.aggregate({
        where: {
          ...invTime,
          status: InvoiceStatus.PAID,
          receiptFileId: null,
        },
        _sum: { amount: true },
      }),

      prisma.invoice.count({
        where: { ...invTime, status: InvoiceStatus.PAID },
      }),

      prisma.invoice.count({
        where: {
          ...invTime,
          status: InvoiceStatus.CANCELLED,
          rejectReason: { not: null },
        },
      }),

      prisma.invoice.count({
        where: {
          ...invTime,
          status: InvoiceStatus.CANCELLED,
          rejectReason: null,
        },
      }),

      prisma.invoice.count({
        where: { ...invTime, status: InvoiceStatus.EXPIRED },
      }),
    ]);

    const cardRevenue = new Decimal(cardAgg._sum.amount ?? 0);
    const gatewayRevenue = new Decimal(gatewayAgg._sum.amount ?? 0);

    return {
      totalUsers,
      cardRevenue,
      gatewayRevenue,
      totalRevenue: cardRevenue.add(gatewayRevenue),
      paidCount,
      adminRejectedCount,
      userCancelledCount,
      expiredCount,
    };
  }

  formatAdvancedStatsMessage(
    stats: AdvancedCrmStats,
    timeframeLabel?: string,
  ): string {
    const lines = [
      "📊 *داشبورد جامع مدیریت و CRM*",
      "",
    ];

    if (timeframeLabel) {
      lines.push(`📅 بازه زمانی: *${timeframeLabel}*`, "");
    }

    lines.push(
      `👥 کل کاربران: *${stats.totalUsers}* نفر`,
      "",
      "💰 *گزارش مالی و درآمد*",
      `💳 واریزی کارت به کارت: *${formatToman(stats.cardRevenue)}*`,
      `🌐 واریزی درگاه آنلاین: *${formatToman(stats.gatewayRevenue)}*`,
      `💵 مجموع درآمد: *${formatToman(stats.totalRevenue)}*`,
      "",
      "📦 *گزارش عملکرد سفارش ها*",
      `✅ موفق و تحویل شده: *${stats.paidCount}* عدد`,
      `❌ رد شده توسط ادمین: *${stats.adminRejectedCount}* عدد`,
      "",
      "🔻 *قیف فروش و ریزش مشتری*",
      `🗑 لغو شده توسط خریدار: *${stats.userCancelledCount}* عدد`,
      `⏳ رها شده در سبد خرید (منقضی): *${stats.expiredCount}* عدد`,
    );

    return lines.join("\n");
  }

  /** @deprecated prefer formatAdvancedStatsMessage */
  formatStatsMessage(stats: CrmStats): string {
    return [
      "📊 *آمار و CRM اشتراکینو*",
      "",
      `👥 کل کاربران: *${stats.totalUsers}*`,
      `✅ فاکتورهای پرداخت شده (*PAID*): *${stats.paidInvoices}*`,
      `⏳ در انتظار پرداخت / رسید: *${stats.pendingInvoices}*`,
      `🔎 در انتظار تایید ادمین: *${stats.awaitingApproval}*`,
      `❌ لغو شده (*CANCELLED*): *${stats.cancelledInvoices}*`,
      `⌛ منقضی شده (*EXPIRED*): *${stats.expiredInvoices}*`,
      "",
      `💰 مجموع درآمد: *${formatToman(stats.totalRevenue)}*`,
    ].join("\n");
  }
}

export const crmService = new CrmService();
