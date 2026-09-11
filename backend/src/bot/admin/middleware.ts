import type { NextFunction } from "grammy";
import type { BotContext } from "../context";
import { hasAnyAdminAccess } from "./rbac";

export async function adminOnlyMiddleware(
  ctx: BotContext,
  next: NextFunction,
): Promise<void> {
  if (ctx.chat?.type !== "private") {
    return next();
  }

  // Never intercept public commands or customer flows
  const text = ctx.message?.text?.trim();
  if (
    text &&
    (text.startsWith("/start") ||
      text.startsWith("/shop") ||
      text.startsWith("/account") ||
      text.startsWith("/support") ||
      text.startsWith("/cancel"))
  ) {
    return next();
  }

  if (!ctx.from || !(await hasAnyAdminAccess(ctx.from.id))) {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({
        text: "⛔️ دسترسی ادمین ندارید.",
        show_alert: true,
      });
    } else {
      await ctx.reply("⛔️ این بخش فقط برای مدیر سیستم است.");
    }
    return;
  }
  await next();
}

