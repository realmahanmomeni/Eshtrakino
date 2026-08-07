import type { NextFunction } from "grammy";
import type { BotContext } from "../context";
import { invoiceService } from "../../services/invoices/InvoiceService";

/** Ensures a User row exists for every Telegram interaction. */
export async function ensureUserMiddleware(
  ctx: BotContext,
  next: NextFunction,
): Promise<void> {
  if (!ctx.from) {
    await next();
    return;
  }

  const result = await invoiceService.ensureUserWithStatus(BigInt(ctx.from.id));
  if (result.created) {
    ctx.session.newUserJustCreated = true;
  }
  await next();
}
