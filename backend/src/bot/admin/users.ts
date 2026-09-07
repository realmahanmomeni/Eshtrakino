import type { EshtrakinoConversation, SessionContext } from "../context";
import { toPlain } from "../../lib/plain";
import { formatToman, parseSignedAmount } from "../../lib/money";
import {
  ensurePanel,
  panelFromCtx,
  type PanelRef,
  waitTextOnPanel,
} from "../conversations/wait";
import { safeDeleteMessage } from "../utils/safeEdit";
import { ConvCb } from "./keyboards";
import {
  adminUserProfileKeyboard,
  adminUserSearchCancelKeyboard,
  adminUserSearchNotFoundKeyboard,
  adminUsersListKeyboard,
} from "./keyboards";
import {
  adminUserService,
  parseUserAnalyticsFilter,
  type UserAnalyticsFilter,
  type UserProfileStats,
} from "../../services/adminUsers/AdminUserService";
import {
  InsufficientBalanceError,
  walletService,
} from "../../services/wallet/WalletService";

async function resolveDisplayName(
  ctx: SessionContext,
  telegramId: string,
): Promise<{ name?: string; username?: string }> {
  try {
    const chat = await ctx.api.getChat(Number(telegramId));
    if (chat.type !== "private") return {};
    const name = [chat.first_name, chat.last_name].filter(Boolean).join(" ").trim();
    return {
      name: name || undefined,
      username: chat.username,
    };
  } catch {
    return {};
  }
}

async function listNavFromSession(
  conversation: EshtrakinoConversation,
): Promise<{ filter: UserAnalyticsFilter; page: number }> {
  return conversation.external((c) => ({
    filter: parseUserAnalyticsFilter(c.session.adminUsersListFilter),
    page: Math.max(0, c.session.adminUsersListPage ?? 0),
  }));
}

async function showUsersListPanel(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
  panel: PanelRef | null,
  banner?: string,
): Promise<PanelRef> {
  const nav = await listNavFromSession(conversation);
  const pageData = await conversation.external(async () =>
    toPlain(await adminUserService.listUsersPage(nav.filter, nav.page)),
  );
  const body = adminUserService.formatListMessage(pageData);
  const text = banner ? `${banner}\n\n${body}` : body;
  return ensurePanel(ctx, text, adminUsersListKeyboard(pageData), panel);
}

async function showUserProfilePanel(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
  userId: number,
  panel: PanelRef | null,
  banner?: string,
): Promise<PanelRef> {
  const nav = await listNavFromSession(conversation);

  const profile = await conversation.external(async () => {
    const row = await adminUserService.getProfileById(userId);
    return row ? toPlain(row) : null;
  });

  if (!profile) {
    return showUsersListPanel(conversation, ctx, panel, "⚠️ کاربر یافت نشد.");
  }

  const display = await conversation.external(async () =>
    toPlain(await resolveDisplayName(ctx, profile.telegramId)),
  );

  const body = adminUserService.formatProfileCard(profile as UserProfileStats, display);
  const text = banner ? `${banner}\n\n${body}` : body;
  return ensurePanel(
    ctx,
    text,
    adminUserProfileKeyboard(profile.id, nav.filter, nav.page),
    panel,
  );
}

async function deleteAdminInput(ctx: SessionContext): Promise<void> {
  const chatId = ctx.chat?.id;
  const messageId = ctx.message?.message_id;
  if (chatId == null || messageId == null) return;
  await safeDeleteMessage(ctx.api, chatId, messageId);
}

function isSearchCancelCallback(data: string): boolean {
  return (
    data === ConvCb.cancel ||
    data.startsWith("adm:users:list:") ||
    data === "adm:users"
  );
}

/**
 * Fluid UI: search user by Telegram numeric ID from the paginated list.
 * Deletes admin input; edits a single panel into the profile card on success.
 */
export async function adminSearchUserConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  try {
    let panel = panelFromCtx(ctx);
    const nav = await listNavFromSession(conversation);
    const cancelKb = adminUserSearchCancelKeyboard(nav.filter, nav.page);

    let prompt = [
      "🔍 *جستجوی کاربر*",
      "",
      "لطفاً آیدی عددی (Telegram ID) کاربر مورد نظر را ارسال کنید:",
    ].join("\n");

    panel = await ensurePanel(ctx, prompt, cancelKb, panel);

    while (true) {
      panel = await ensurePanel(ctx, prompt, cancelKb, panel);
      const update = await conversation.waitFor(["message:text", "callback_query:data"]);

      if (update.callbackQuery?.data) {
        try {
          await update.answerCallbackQuery();
        } catch {
          /* ignore */
        }
        if (isSearchCancelCallback(update.callbackQuery.data)) {
          await showUsersListPanel(conversation, update, panel);
          return;
        }
        continue;
      }

      const raw = (update.message?.text ?? "").trim();
      if (raw === "/cancel") {
        await showUsersListPanel(conversation, update, panel);
        return;
      }
      if (!raw) continue;

      await deleteAdminInput(update);

      const telegramId = raw.replace(/\s+/g, "");
      if (!/^\d{5,15}$/.test(telegramId)) {
        prompt = [
          "⚠️ *آیدی نامعتبر*",
          "",
          "لطفاً فقط آیدی عددی تلگرام را بفرستید (مثلاً `123456789`).",
          "",
          "لطفاً آیدی عددی (Telegram ID) کاربر مورد نظر را ارسال کنید:",
        ].join("\n");
        continue;
      }

      const profile = await conversation.external(async () => {
        const row = await adminUserService.getProfileByTelegramId(telegramId);
        return row ? toPlain(row) : null;
      });

      if (!profile) {
        await ensurePanel(
          update,
          "⚠️ کاربری با این آیدی یافت نشد.",
          adminUserSearchNotFoundKeyboard(nav.filter, nav.page),
          panel,
        );
        return;
      }

      const display = await conversation.external(async () =>
        toPlain(await resolveDisplayName(update, profile.telegramId)),
      );

      await ensurePanel(
        update,
        adminUserService.formatProfileCard(profile as UserProfileStats, display),
        adminUserProfileKeyboard(profile.id, nav.filter, nav.page),
        panel,
      );
      return;
    }
  } catch (err) {
    console.error("adminSearchUserConversation error:", err);
    await showUsersListPanel(
      conversation,
      ctx,
      panelFromCtx(ctx),
      "⚠️ خطا در جستجوی کاربر — لطفا دوباره تلاش کنید.",
    );
  }
}

/** Fluid UI: send a DM to the selected user, then refresh profile. */
export async function messageAdminUserConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  const clearTarget = async () => {
    await conversation.external((c) => {
      c.session.adminTargetId = undefined;
      c.session.adminTargetType = undefined;
    });
  };

  try {
    const target = await conversation.external((c) => ({
      userId: c.session.adminTargetId ?? null,
      type: c.session.adminTargetType ?? null,
    }));
    const userId = target.userId;
    if (!userId || target.type !== "user") {
      await clearTarget();
      await showUsersListPanel(
        conversation,
        ctx,
        panelFromCtx(ctx),
        "⚠️ کاربر هدف مشخص نیست.",
      );
      return;
    }

    let panel = panelFromCtx(ctx);
    const nav = await listNavFromSession(conversation);

    const profile = await conversation.external(async () => {
      const row = await adminUserService.getProfileById(userId);
      return row ? toPlain(row) : null;
    });
    if (!profile) {
      await clearTarget();
      await showUsersListPanel(conversation, ctx, panel, "⚠️ کاربر یافت نشد.");
      return;
    }

    const prompt = [
      "✉️ *ارسال پیام به کاربر*",
      "",
      `گیرنده: \`${profile.telegramId}\``,
      "",
      "متن پیام را بفرستید:",
      "",
      "(برای انصراف /cancel را بفرستید)",
    ].join("\n");

    if (!panel) {
      panel = await ensurePanel(
        ctx,
        prompt,
        adminUserProfileKeyboard(userId, nav.filter, nav.page),
        null,
      );
    }

    const waited = await waitTextOnPanel(conversation, ctx, prompt, panel);
    panel = waited.panel;

    if (!waited.text) {
      await clearTarget();
      await showUserProfilePanel(conversation, ctx, userId, panel, "❌ ارسال پیام لغو شد.");
      return;
    }

    const text = waited.text.trim();
    if (!text) {
      await clearTarget();
      await showUserProfilePanel(conversation, ctx, userId, panel, "⚠️ پیام خالی ارسال نشد.");
      return;
    }

    try {
      await ctx.api.sendMessage(
        profile.telegramId,
        ["📩 *پیام از پشتیبانی*", "", text].join("\n"),
        { parse_mode: "Markdown" },
      );
    } catch (err) {
      console.error("admin → user DM failed:", err);
      await clearTarget();
      await showUserProfilePanel(
        conversation,
        ctx,
        userId,
        panel,
        "⚠️ ارسال پیام ناموفق بود (کاربر ممکن است ربات را بلاک کرده باشد).",
      );
      return;
    }

    await clearTarget();
    await showUserProfilePanel(conversation, ctx, userId, panel, "✅ پیام با موفقیت ارسال شد.");
  } catch (err) {
    console.error("messageAdminUserConversation error:", err);
    try {
      await clearTarget();
    } catch {
      /* ignore */
    }
    await showUsersListPanel(
      conversation,
      ctx,
      panelFromCtx(ctx),
      "⚠️ خطا در ارسال پیام — لطفا دوباره تلاش کنید.",
    );
  }
}

/** Fluid UI: add/deduct wallet balance, then refresh profile. */
export async function editAdminUserBalanceConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
): Promise<void> {
  const clearTarget = async () => {
    await conversation.external((c) => {
      c.session.adminTargetId = undefined;
      c.session.adminTargetType = undefined;
    });
  };

  try {
    const target = await conversation.external((c) => ({
      userId: c.session.adminTargetId ?? null,
      type: c.session.adminTargetType ?? null,
    }));
    const userId = target.userId;
    if (!userId || target.type !== "user") {
      await clearTarget();
      await showUsersListPanel(
        conversation,
        ctx,
        panelFromCtx(ctx),
        "⚠️ کاربر هدف مشخص نیست.",
      );
      return;
    }

    let panel = panelFromCtx(ctx);
    const nav = await listNavFromSession(conversation);

    const profile = await conversation.external(async () => {
      const row = await adminUserService.getProfileById(userId);
      return row ? toPlain(row) : null;
    });
    if (!profile) {
      await clearTarget();
      await showUsersListPanel(conversation, ctx, panel, "⚠️ کاربر یافت نشد.");
      return;
    }

    const prompt = [
      "💰 *ویرایش موجودی*",
      "",
      `کاربر: \`${profile.telegramId}\``,
      `موجودی فعلی: *${formatToman(profile.balance)}*`,
      "",
      "مبلغ را بفرستید:",
      "• عدد مثبت (مثلاً `50000`) → افزایش",
      "• عدد منفی (مثلاً `-10000`) → کاهش",
      "",
      "(برای انصراف /cancel را بفرستید)",
    ].join("\n");

    if (!panel) {
      panel = await ensurePanel(
        ctx,
        prompt,
        adminUserProfileKeyboard(userId, nav.filter, nav.page),
        null,
      );
    }

    const waited = await waitTextOnPanel(conversation, ctx, prompt, panel);
    panel = waited.panel;

    if (!waited.text) {
      await clearTarget();
      await showUserProfilePanel(conversation, ctx, userId, panel, "❌ ویرایش موجودی لغو شد.");
      return;
    }

    const delta = parseSignedAmount(waited.text);
    if (delta == null) {
      await clearTarget();
      await showUserProfilePanel(
        conversation,
        ctx,
        userId,
        panel,
        "⚠️ مبلغ نامعتبر است. مثال: `50000` یا `-10000`",
      );
      return;
    }

    try {
      const result = await conversation.external(async () =>
        toPlain(
          await walletService.adjustBalanceByAdmin(
            userId,
            delta,
            `تعدیل ادمین (${delta > 0 ? "+" : ""}${delta})`,
          ),
        ),
      );

      const sign = delta > 0 ? "+" : "";
      await clearTarget();
      await showUserProfilePanel(
        conversation,
        ctx,
        userId,
        panel,
        `✅ موجودی به‌روز شد (${sign}${formatToman(Math.abs(delta))}) → *${formatToman(result.balance)}*`,
      );
    } catch (err) {
      const isInsufficient =
        err instanceof InsufficientBalanceError ||
        (err instanceof Error && err.name === "InsufficientBalanceError");
      if (isInsufficient) {
        await clearTarget();
        await showUserProfilePanel(
          conversation,
          ctx,
          userId,
          panel,
          "⚠️ موجودی کافی نیست — موجودی نمی‌تواند منفی شود.",
        );
        return;
      }
      throw err;
    }
  } catch (err) {
    console.error("editAdminUserBalanceConversation error:", err);
    try {
      await clearTarget();
    } catch {
      /* ignore */
    }
    await showUsersListPanel(
      conversation,
      ctx,
      panelFromCtx(ctx),
      "⚠️ خطا در ویرایش موجودی — لطفا دوباره تلاش کنید.",
    );
  }
}
