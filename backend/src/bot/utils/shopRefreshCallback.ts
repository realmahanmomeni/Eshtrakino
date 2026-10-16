import { GrammyError, type Context } from "grammy";
import { lazyCacheService } from "../../services/catalog/LazyCacheService";
import {
  canFetchCanbosoCatalogFromNetwork,
  MANUAL_CANBOSO_REFRESH_TOAST,
} from "../../services/suppliers/canboso/canbosoManualRefreshGate";

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

const SHOP_REFRESH_SUCCESS_TOAST = "✅ موجودی و قیمت‌های دلاری به‌روزرسانی شد.";
const SHOP_REFRESH_FALLBACK_TOAST = "🔄 بروزرسانی انجام شد.";

/**
 * Toast text from the 60s Canboso gate only (sync-safe to show before network work).
 * Call answerCallbackQuery immediately after this — before manualCatalogRefresh().
 */
export function peekShopRefreshToast(now = Date.now()): ShopRefreshToast {
  if (!canFetchCanbosoCatalogFromNetwork(now)) {
    return { text: MANUAL_CANBOSO_REFRESH_TOAST };
  }
  return { text: SHOP_REFRESH_SUCCESS_TOAST };
}

/** Runs manual catalog refresh after the callback was answered. */
export async function runShopManualCatalogRefresh(): Promise<void> {
  await lazyCacheService.manualCatalogRefresh();
}

/** Answer the callback query at most once; never throw to the handler. */
export async function answerShopRefreshCallbackOnce(
  ctx: Context,
  toast: ShopRefreshToast,
): Promise<void> {
  const text = toast.text?.trim() || SHOP_REFRESH_FALLBACK_TOAST;
  try {
    await ctx.answerCallbackQuery({
      text,
      show_alert: toast.show_alert,
    });
  } catch (err) {
    if (isBenignRefreshAnswerError(err)) return;
    console.warn("[shop refresh] answerCallbackQuery failed:", err);
  }
}
