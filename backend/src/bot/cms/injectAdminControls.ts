import { InlineKeyboard } from "grammy";
import { isAdminTelegramId } from "../../config/env";
import { Callbacks } from "../keyboards/callbacks";
import type { PageKey } from "../../services/cms/PageContentService";

type CtxLike = { from?: { id: number } | undefined };

/**
 * Appends contextual CMS controls for admins at the bottom of a user-facing keyboard.
 * Non-admins receive the keyboard unchanged.
 */
export function injectAdminControls(
  ctx: CtxLike,
  keyboard: InlineKeyboard,
  pageKey: PageKey,
): InlineKeyboard {
  if (!isAdminTelegramId(ctx.from?.id)) {
    return keyboard;
  }

  // Visual break before privileged actions
  keyboard.row();

  switch (pageKey) {
    case "shop":
      keyboard
        .text("📝 ویرایش متن", Callbacks.cmsEditText("shop"))
        .text("📁 مدیریت دسته‌ها", Callbacks.cmsCats)
        .row()
        .text("🛍 مدیریت محصولات", Callbacks.cmsProds)
        .row();
      break;
    default:
      keyboard.text("📝 ویرایش متن صفحه", Callbacks.cmsEditText(pageKey)).row();
      break;
  }

  keyboard
    .text("🖼 تنظیم بنر", Callbacks.cmsSetMedia(pageKey))
    .text("🗑 حذف بنر", Callbacks.cmsDelMedia(pageKey))
    .row()
    .text("🎛 تغییر چیدمان (ستون)", Callbacks.cmsToggleLayout(pageKey))
    .row();

  return keyboard;
}
