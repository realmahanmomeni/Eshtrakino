import { GrammyError, type Context } from "grammy";
import { lazyCacheService } from "../../services/catalog/LazyCacheService";
import { CANBOSO_RATE_LIMIT_COOLDOWN_MESSAGE } from "../../services/suppliers/adapters/CanbosoAdapter";
import { SupplierRateLimitError } from "../../services/suppliers/SupplierAdapter";
import { MANUAL_CANBOSO_REFRESH_TOAST } from "../../services/suppliers/canboso/canbosoManualRefreshGate";

export type ShopRefreshToast = {
  text: string;
  show_alert?: boolean;
};

export function isBenignRefreshAnswerError(err: unknown): boolean {
  if (!(err instanceof GrammyError)) return false;
  const description = err.description ?? err.message ?? "";
  return (
    description.includes("query is too old") ||
    description.includes("response timeout expired") ||
    description.includes("QUERY_ID_INVALID")
  );
}

export function isBenignShopRerenderError(err: unknown): boolean {
  if (!(err instanceof GrammyError)) return false;
  const description = err.description ?? err.message ?? "";
  return (
    description.includes("message is not modified") ||
    description.includes("message to edit not found") ||
    description.includes("message can't be edited") ||
    description.includes("message identifier is not specified")
  );
}

/** Runs manual catalog refresh; does not answer the callback. */
export async function resolveShopRefreshToast(): Promise<ShopRefreshToast> {
  try {
    const { usedCachedCatalog } = await lazyCacheService.manualCatalogRefresh();
    return {
      text: usedCachedCatalog
        ? MANUAL_CANBOSO_REFRESH_TOAST
        : "✅ موجودی و قیمت‌های دلاری به‌روزرسانی شد.",
    };
  } catch (err) {
    console.warn("[shop refresh] sync failed:", err);
    const rateLimited =
      err instanceof SupplierRateLimitError ||
      (err instanceof Error && err.message.includes(CANBOSO_RATE_LIMIT_COOLDOWN_MESSAGE));
    return {
      text: rateLimited ? CANBOSO_RATE_LIMIT_COOLDOWN_MESSAGE : "بروزرسانی ناموفق بود",
      show_alert: rateLimited,
    };
  }
}

/** Answer the callback query at most once; never throw to the handler. */
export async function answerShopRefreshCallbackOnce(
  ctx: Context,
  toast: ShopRefreshToast,
): Promise<void> {
  try {
    await ctx.answerCallbackQuery({
      text: toast.text,
      show_alert: toast.show_alert,
    });
  } catch (err) {
    if (isBenignRefreshAnswerError(err)) return;
    console.warn("[shop refresh] answerCallbackQuery failed:", err);
  }
}
