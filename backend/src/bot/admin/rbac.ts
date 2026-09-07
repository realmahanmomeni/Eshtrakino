import { prisma } from "../../lib/prisma";
import { isAdminTelegramId } from "../../config/env";

export type AdminPermission = "SUPPORT" | "FINANCE" | "CATALOG" | "CMS" | "USERS";

export async function hasPermission(telegramId: number | bigint, perm: AdminPermission): Promise<boolean> {
  if (isAdminTelegramId(Number(telegramId))) return true;

  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
    select: { adminPermissions: true },
  });

  if (!user || !user.adminPermissions) return false;
  return user.adminPermissions.includes(perm);
}

export async function getAdminPermissions(telegramId: number | bigint): Promise<AdminPermission[]> {
  if (isAdminTelegramId(Number(telegramId))) {
    return ["SUPPORT", "FINANCE", "CATALOG", "CMS", "USERS"];
  }

  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
    select: { adminPermissions: true },
  });

  return (user?.adminPermissions as AdminPermission[]) || [];
}

export async function hasAnyAdminAccess(telegramId: number | bigint): Promise<boolean> {
  if (isAdminTelegramId(Number(telegramId))) return true;
  
  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
    select: { adminPermissions: true },
  });

  return (user?.adminPermissions?.length ?? 0) > 0;
}
