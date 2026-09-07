import { InlineKeyboard } from "grammy";

export type KeyboardButton = {
  text: string;
  data: string;
  icon_custom_emoji_id?: string;
};

/**
 * Keyboard layout contract:
 * 1) Catalog lists (categories / products) → strict 1-column (full-width rows)
 * 2) Compact menus (home) → 2-column grid where appropriate
 * 3) Major CTAs → full-width rows below the list
 * 4) Navigation → exclusive absolute bottom row (بازگشت / لغو)
 * Never mix nav buttons with list/CTA buttons on the same row.
 */

/** Append buttons in a strict 1-column vertical list (one button per row). */
export function appendOneColumn(
  kb: InlineKeyboard,
  buttons: Array<KeyboardButton>,
): InlineKeyboard {
  for (const btn of buttons) {
    if (btn.icon_custom_emoji_id) {
      kb.text({ text: btn.text, icon_custom_emoji_id: btn.icon_custom_emoji_id }, btn.data).row();
    } else {
      kb.text(btn.text, btn.data).row();
    }
  }
  return kb;
}

/** Append buttons in a strict 2-column grid. */
export function appendTwoColumn(
  kb: InlineKeyboard,
  buttons: Array<KeyboardButton>,
): InlineKeyboard {
  for (let i = 0; i < buttons.length; i += 2) {
    const left = buttons[i]!;
    const right = buttons[i + 1];
    if (left.icon_custom_emoji_id) {
      kb.text({ text: left.text, icon_custom_emoji_id: left.icon_custom_emoji_id }, left.data);
    } else {
      kb.text(left.text, left.data);
    }
    if (right) {
      if (right.icon_custom_emoji_id) {
        kb.text({ text: right.text, icon_custom_emoji_id: right.icon_custom_emoji_id }, right.data).row();
      } else {
        kb.text(right.text, right.data).row();
      }
    } else {
      kb.row();
    }
  }
  return kb;
}

/** Full-width call-to-action (خرید / پرداخت / تایید). One button per row. */
export function appendFullWidthCta(
  kb: InlineKeyboard,
  text: string,
  data: string,
  icon_custom_emoji_id?: string,
): InlineKeyboard {
  if (icon_custom_emoji_id) {
    kb.text({ text, icon_custom_emoji_id }, data).row();
  } else {
    kb.text(text, data).row();
  }
  return kb;
}

/**
 * Absolute bottom navigation bar.
 * Pass one or more nav-only buttons (🔙 بازگشت, ❌ لغو). They share one row.
 */
export function appendNavBar(
  kb: InlineKeyboard,
  ...buttons: KeyboardButton[]
): InlineKeyboard {
  if (buttons.length === 0) return kb;
  for (const btn of buttons) {
    if (btn.icon_custom_emoji_id) {
      kb.text({ text: btn.text, icon_custom_emoji_id: btn.icon_custom_emoji_id }, btn.data);
    } else {
      kb.text(btn.text, btn.data);
    }
  }
  kb.row();
  return kb;
}

/** Pick a display emoji from category/product name (not a hardcoded catalog). */
export function emojiForLabel(name: string): string {
  const n = name.toLowerCase();
  if (/ai|هوش|gpt|claude|midjourney|gemini|openai|chatgpt/.test(n)) return "🤖";
  if (/microsoft|مایکروسافت|windows|office|software|نرم|لایسنس|۳۶۵|365/.test(n)) {
    return "💻";
  }
  if (/spotify|netflix|youtube|stream|موسیقی|فیلم|سرگرمی/.test(n)) return "🎬";
  if (/game|بازی|steam/.test(n)) return "🎮";
  if (/cloud|هاست|server|سرور|vps/.test(n)) return "☁️";
  if (/پرداخت|payment|card|کارت|درگاه/.test(n)) return "💳";
  return "✨";
}

export function deliveryTypeLabel(type: string): string {
  switch (type) {
    case "READY":
      return "📦 موجودی آماده";
    case "MANUAL":
      return "✋ تحویل دستی";
    case "CREDENTIALS_REQUIRED":
      return "🔐 نیاز به اطلاعات اکانت";
    case "USER_CHOICE":
      return "🔀 انتخاب توسط کاربر";
    default:
      return type;
  }
}
