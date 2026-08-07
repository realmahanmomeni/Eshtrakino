import { InvoiceStatus, type Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "../../lib/prisma";
import { formatToman } from "../../lib/money";

export type UserAnalyticsFilter = "all" | "active" | "ghost" | "buyers";

export const USER_LIST_PAGE_SIZE = 10;

export const USER_FILTER_LABELS: Record<UserAnalyticsFilter, string> = {
  all: "همه",
  active: "فعال",
  ghost: "روح",
  buyers: "خریدار",
};

export interface UserProfileStats {
  id: number;
  telegramId: string;
  balance: string;
  totalDeposited: string;
  totalPurchases: number;
  joinedAt: string;
  updatedAt: string;
  status: "Active" | "Ghost";
}

export interface UserListItem {
  id: number;
  telegramId: string;
  status: "Active" | "Ghost";
}

export interface UserListPage {
  users: UserListItem[];
  total: number;
  page: number;
  pageSize: number;
  filter: UserAnalyticsFilter;
  hasPrev: boolean;
  hasNext: boolean;
}

const ACTIVE_DAYS = 30;

function activeCutoff(now = new Date()): Date {
  return new Date(now.getTime() - ACTIVE_DAYS * 24 * 60 * 60 * 1000);
}

function statusFromUpdatedAt(updatedAt: Date, cutoff: Date): "Active" | "Ghost" {
  return updatedAt >= cutoff ? "Active" : "Ghost";
}

function buyersWhere(): Prisma.UserWhereInput {
  return {
    OR: [
      { invoices: { some: { status: InvoiceStatus.PAID } } },
      { swapWalletInvoices: { some: { status: "SUCCESS" } } },
    ],
  };
}

function filterWhere(filter: UserAnalyticsFilter, cutoff: Date): Prisma.UserWhereInput {
  switch (filter) {
    case "active":
      return { updatedAt: { gte: cutoff } };
    case "ghost":
      return { updatedAt: { lt: cutoff } };
    case "buyers":
      return buyersWhere();
    case "all":
    default:
      return {};
  }
}

export function parseUserAnalyticsFilter(raw: string | undefined): UserAnalyticsFilter {
  if (raw === "active" || raw === "ghost" || raw === "buyers" || raw === "all") {
    return raw;
  }
  return "all";
}

export class AdminUserService {
  async getProfileByTelegramId(telegramId: bigint | number | string): Promise<UserProfileStats | null> {
    const tg = BigInt(String(telegramId).trim());
    const cutoff = activeCutoff();

    const user = await prisma.user.findUnique({
      where: { telegramId: tg },
      select: {
        id: true,
        telegramId: true,
        balance: true,
        joinedAt: true,
        updatedAt: true,
      },
    });
    if (!user) return null;

    const [depositAgg, purchaseCount] = await Promise.all([
      prisma.walletTransaction.aggregate({
        where: {
          userId: user.id,
          type: { in: ["TOPUP", "ADMIN_CREDIT"] },
        },
        _sum: { amount: true },
      }),
      prisma.invoice.count({
        where: {
          userId: user.id,
          status: InvoiceStatus.PAID,
          productId: { not: null },
        },
      }),
    ]);

    const totalDeposited = new Decimal(depositAgg._sum.amount?.toString() ?? "0");

    return {
      id: user.id,
      telegramId: user.telegramId.toString(),
      balance: user.balance.toString(),
      totalDeposited: totalDeposited.toString(),
      totalPurchases: purchaseCount,
      joinedAt: user.joinedAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      status: statusFromUpdatedAt(user.updatedAt, cutoff),
    };
  }

  async getProfileById(userId: number): Promise<UserProfileStats | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { telegramId: true },
    });
    if (!user) return null;
    return this.getProfileByTelegramId(user.telegramId);
  }

  /** Paginated user list for Fluid admin UI (`skip` / `take`). */
  async listUsersPage(
    filter: UserAnalyticsFilter = "all",
    page = 0,
    pageSize = USER_LIST_PAGE_SIZE,
  ): Promise<UserListPage> {
    const safePage = Math.max(0, Math.floor(page));
    const safeSize = Math.max(1, Math.min(pageSize, 20));
    const cutoff = activeCutoff();
    const where = filterWhere(filter, cutoff);

    const [total, rows] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        select: {
          id: true,
          telegramId: true,
          updatedAt: true,
        },
        orderBy: { id: "desc" },
        skip: safePage * safeSize,
        take: safeSize,
      }),
    ]);

    return {
      users: rows.map((u) => ({
        id: u.id,
        telegramId: u.telegramId.toString(),
        status: statusFromUpdatedAt(u.updatedAt, cutoff),
      })),
      total,
      page: safePage,
      pageSize: safeSize,
      filter,
      hasPrev: safePage > 0,
      hasNext: (safePage + 1) * safeSize < total,
    };
  }

  formatListMessage(pageData: UserListPage): string {
    const filterLabel = USER_FILTER_LABELS[pageData.filter];
    const pageNo = pageData.page + 1;
    const totalPages = Math.max(1, Math.ceil(pageData.total / pageData.pageSize));

    return [
      `لیست کاربران - فیلتر: ${filterLabel}`,
      `صفحه: ${pageNo}`,
      "",
      `📊 مجموع: *${pageData.total}* کاربر · صفحه *${pageNo}* از *${totalPages}*`,
    ].join("\n");
  }

  formatProfileCard(
    profile: UserProfileStats,
    display?: { name?: string; username?: string },
  ): string {
    const name = display?.name?.trim() || "—";
    const username = display?.username ? `@${display.username}` : "—";
    const joined = new Date(profile.joinedAt).toLocaleString("fa-IR", {
      timeZone: "Asia/Tehran",
    });

    return [
      "👤 *پروفایل کاربر*",
      "",
      `👤 Name: ${escapeMd(name)}`,
      `🔗 Username: ${escapeMd(username)}`,
      `🆔 ID: \`${profile.telegramId}\``,
      `💰 Balance: *${formatToman(profile.balance)}*`,
      `💵 Total Deposited: *${formatToman(profile.totalDeposited)}*`,
      `🛍 Total Purchases: *${profile.totalPurchases}*`,
      `📅 Joined: ${joined}`,
      `📊 Status: ${profile.status === "Active" ? "🟢 Active" : "👻 Ghost"}`,
    ].join("\n");
  }
}

function escapeMd(value: string): string {
  return value.replace(/([_*`\[\]])/g, "\\$1");
}

export const adminUserService = new AdminUserService();
