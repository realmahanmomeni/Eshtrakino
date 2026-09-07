import { InlineKeyboard } from "grammy";
import { Callbacks } from "../keyboards/callbacks";
import type { AdminPermission } from "./rbac";

export function adminRbacListKeyboard(
  admins: { id: number; telegramId: bigint }[],
): InlineKeyboard {
  const kb = new InlineKeyboard();

  for (const admin of admins) {
    const label = `ID: ${admin.telegramId}`;
    kb.text(`👮‍♂️ ${label}`, `adm:rbac:user:${admin.telegramId}`).row();
  }

  if (admins.length === 0) {
    kb.text("— ادمینی یافت نشد —", "noop").row();
  }

  kb.text("➕ افزودن ادمین جدید", "adm:rbac:add").row();
  kb.text("🔙 بازگشت به پنل مدیریت", Callbacks.adminHome);

  return kb;
}

export function adminRbacManageKeyboard(
  telegramId: bigint,
  perms: AdminPermission[],
): InlineKeyboard {
  const kb = new InlineKeyboard();

  const toggleBtn = (perm: AdminPermission, label: string) => {
    const has = perms.includes(perm);
    kb.text(`${label}: ${has ? "✅" : "❌"}`, `adm:rbac:toggle:${telegramId}:${perm}`).row();
  };

  toggleBtn("SUPPORT", "پشتیبانی و تیکت");
  toggleBtn("FINANCE", "پرداخت و رسیدها");
  toggleBtn("CATALOG", "کاتالوگ و موجودی");
  toggleBtn("CMS", "مدیریت محتوا و CMS");
  toggleBtn("USERS", "کاربران و آمار");

  kb.text("🗑️ حذف کامل دسترسی ادمین", `adm:rbac:remove:${telegramId}`).row();
  kb.text("⬅️ بازگشت به لیست ادمینها", "adm:rbac:manage");

  return kb;
}
