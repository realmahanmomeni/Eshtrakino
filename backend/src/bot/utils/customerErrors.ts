import type { BotContext } from "../context";

/** Shown on unexpected callback failures for regular customers. */
export const CUSTOMER_PROCESSING_ERROR =
  "مشکلی در پردازش پیش آمد، لطفاً دوباره تلاش کنید.";

export function logHandlerError(scope: string, err: unknown): void {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.error(`[${scope}] ${msg}`);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
}

function isAdminScopedCallback(data: string): boolean {
  return data.startsWith("adm:") || data.startsWith("admin_");
}

/**
 * Catches unhandled errors in customer callback flows, logs stack traces,
 * and shows a polite Persian alert (without swallowing admin callbacks).
 */
export async function customerCallbackErrorMiddleware(
  ctx: BotContext,
  next: () => Promise<void>,
): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (typeof data !== "string" || isAdminScopedCallback(data)) {
    await next();
    return;
  }

  try {
    await next();
  } catch (err) {
    logHandlerError("callback", err);
    try {
      await ctx.answerCallbackQuery({
        text: CUSTOMER_PROCESSING_ERROR,
        show_alert: true,
      });
    } catch {
      /* query may already be answered */
    }
  }
}
