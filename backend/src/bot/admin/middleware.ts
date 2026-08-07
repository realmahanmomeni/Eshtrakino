import type { NextFunction } from "grammy";
import type { BotContext } from "../context";
import { isAdminTelegramId } from "../../config/env";

export async function adminOnlyMiddleware(
  ctx: BotContext,
  next: NextFunction,
): Promise<void> {
  if (ctx.chat?.type !== "private") {
    return next();
  }

  if (!isAdminTelegramId(ctx.from?.id)) {
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

export function assertAdmin(ctx: BotContext): boolean {
  return isAdminTelegramId(ctx.from?.id);
}
