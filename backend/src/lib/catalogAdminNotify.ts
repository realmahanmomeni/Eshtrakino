import { prisma } from "./prisma";
import { env } from "../config/env";

/** Telegram IDs that should receive catalog/supplier admin alerts. */
export async function getCatalogAdminTelegramIds(): Promise<number[]> {
  const ids = new Set<number>();
  for (const envId of env.adminIds) {
    ids.add(envId);
  }

  const dbAdmins = await prisma.user.findMany({
    where: { adminPermissions: { has: "CATALOG" } },
    select: { telegramId: true },
  });
  for (const row of dbAdmins) {
    ids.add(Number(row.telegramId));
  }

  return [...ids];
}
