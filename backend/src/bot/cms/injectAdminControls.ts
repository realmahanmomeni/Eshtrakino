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
  // As per dual-layer UI architecture, CMS controls have been strictly isolated 
  // into the dedicated Admin Panel. This function now just returns the keyboard.
  return keyboard;
}
