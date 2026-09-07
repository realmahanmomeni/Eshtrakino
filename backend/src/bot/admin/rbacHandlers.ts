import { Composer } from "grammy";
import type { BotContext, SessionContext, EshtrakinoConversation } from "../context";
import { isAdminTelegramId } from "../../config/env";
import { safeEdit } from "../utils/safeEdit";
import { adminRbacListKeyboard, adminRbacManageKeyboard } from "./rbacKeyboards";
import { prisma } from "../../lib/prisma";
import type { AdminPermission } from "./rbac";
import { getAdminPermissions } from "./rbac";
import { waitTextOnPanel, panelFromCtx, ensurePanel } from "../conversations/wait";
import { Callbacks } from "../keyboards/callbacks";

export const rbacAdmin = new Composer<BotContext>();

// Super Admin only guard for RBAC management
rbacAdmin.use(async (ctx, next) => {
  if (!ctx.from) return;
  // Only super admins from ENV can manage RBAC
  if (!isAdminTelegramId(ctx.from.id)) {
    if (ctx.callbackQuery && ctx.callbackQuery.data && ctx.callbackQuery.data.startsWith("adm:rbac")) {
      await ctx.answerCallbackQuery({ text: "⛔ دسترسی غیرمجاز: فقط سوپر ادمین", show_alert: true });
      return;
    }
  }
  await next();
});

rbacAdmin.callbackQuery("adm:rbac:manage", async (ctx) => {
  if (!isAdminTelegramId(ctx.from?.id)) return;
  await ctx.answerCallbackQuery();

  const admins = await prisma.user.findMany({
    where: {
      adminPermissions: { isEmpty: false }
    },
    select: { id: true, telegramId: true },
  });

  await safeEdit(
    ctx,
    "👮‍♂️ *مدیریت دسترسی ادمین‌ها*\n\nادمین مورد نظر را انتخاب کنید:",
    adminRbacListKeyboard(admins)
  );
});

rbacAdmin.callbackQuery(/^adm:rbac:user:(\d+)$/, async (ctx) => {
  if (!isAdminTelegramId(ctx.from?.id)) return;
  const targetId = BigInt(ctx.match![1] as string);
  await ctx.answerCallbackQuery();

  const user = await prisma.user.findUnique({ where: { telegramId: targetId } });
  if (!user) {
    await ctx.answerCallbackQuery({ text: "کاربر یافت نشد", show_alert: true });
    return;
  }

  const perms = await getAdminPermissions(targetId);
  const label = String(user.telegramId);

  await safeEdit(
    ctx,
    `⚙️ *دسترسی‌های ادمین:* ${label}\n\nتیک بخش‌های مورد نظر را بزنید:`,
    adminRbacManageKeyboard(targetId, perms)
  );
});

rbacAdmin.callbackQuery(/^adm:rbac:toggle:(\d+):([A-Z]+)$/, async (ctx) => {
  if (!isAdminTelegramId(ctx.from?.id)) return;
  const targetId = BigInt(ctx.match![1] as string);
  const perm = ctx.match![2] as AdminPermission;

  const user = await prisma.user.findUnique({ where: { telegramId: targetId } });
  if (!user) {
    await ctx.answerCallbackQuery({ text: "کاربر یافت نشد" });
    return;
  }

  let perms = user.adminPermissions as AdminPermission[];
  if (perms.includes(perm)) {
    perms = perms.filter(p => p !== perm);
  } else {
    perms.push(perm);
  }

  await prisma.user.update({
    where: { telegramId: targetId },
    data: { adminPermissions: perms },
  });

  await ctx.answerCallbackQuery();
  const label = String(user.telegramId);
  await safeEdit(
    ctx,
    `⚙️ *دسترسی‌های ادمین:* ${label}\n\nتیک بخش‌های مورد نظر را بزنید:`,
    adminRbacManageKeyboard(targetId, perms)
  );
});

rbacAdmin.callbackQuery(/^adm:rbac:remove:(\d+)$/, async (ctx) => {
  if (!isAdminTelegramId(ctx.from?.id)) return;
  const targetId = BigInt(ctx.match![1] as string);

  await prisma.user.update({
    where: { telegramId: targetId },
    data: { adminPermissions: [] },
  });

  await ctx.answerCallbackQuery({ text: "دسترسی ادمین به صورت کامل لغو شد." });
  
  const admins = await prisma.user.findMany({
    where: { adminPermissions: { isEmpty: false } },
    select: { id: true, telegramId: true },
  });

  await safeEdit(
    ctx,
    "👮‍♂️ *مدیریت دسترسی ادمین‌ها*\n\nادمین مورد نظر را انتخاب کنید:",
    adminRbacListKeyboard(admins)
  );
});

rbacAdmin.callbackQuery("adm:rbac:add", async (ctx) => {
  if (!isAdminTelegramId(ctx.from?.id)) return;
  await ctx.answerCallbackQuery();
  try { await ctx.conversation.exitAll(); } catch { /* ignore */ }
  await ctx.conversation.enter("rbacAddAdminConversation");
});

export async function rbacAddAdminConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  const initPanel = panelFromCtx(ctx);
  if (!initPanel) return;

  const { text, panel } = await waitTextOnPanel(
    conversation,
    ctx,
    "➕ *افزودن ادمین جدید*\n\nلطفاً ID عددی کاربر (Telegram ID) را وارد کنید:",
    initPanel,
  );

  if (!text) return;

  const targetIdStr = text.trim();
  let targetId: bigint;
  try {
    targetId = BigInt(targetIdStr);
  } catch {
    await ensurePanel(
      ctx,
      "❌ شناسه عددی (Telegram ID) نامعتبر است. لطفاً فقط عدد وارد کنید.",
      { inline_keyboard: [[{ text: "🔙 بازگشت", callback_data: "adm:rbac:manage" }]] },
      panel
    );
    return;
  }

  const userObj = await conversation.external(async () => {
    const u = await prisma.user.findUnique({ where: { telegramId: targetId } });
    if (!u) return null;
    return { adminPermissions: u.adminPermissions };
  });

  if (!userObj) {
    const adminsMapped = await conversation.external(async () => {
      const admins = await prisma.user.findMany({ 
        where: { adminPermissions: { isEmpty: false } }, 
        select: { id: true, telegramId: true } 
      });
      return admins.map(a => ({ id: a.id, telegramIdStr: String(a.telegramId) }));
    });

    const keyboardAdmins = adminsMapped.map(a => ({ id: a.id, telegramId: BigInt(a.telegramIdStr) }));

    await ensurePanel(
      ctx, 
      "❌ این کاربر قبلاً وارد ربات نشده است. ابتدا کاربر باید /start را بزند.", 
      adminRbacListKeyboard(keyboardAdmins), 
      panel
    );
    return;
  }

  let perms = userObj.adminPermissions as AdminPermission[];
  if (!perms) perms = [];

  const label = targetIdStr;
  await ensurePanel(
    ctx,
    `⚙️ *دسترسی‌های ادمین:* ${label}\n\nتیک بخش‌های مورد نظر را بزنید:`,
    adminRbacManageKeyboard(targetId, perms),
    panel
  );
}
