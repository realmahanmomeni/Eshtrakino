import type { InlineKeyboard } from "grammy";
import {
  appendOneColumn,
  appendTwoColumn,
  type KeyboardButton,
} from "./grid";

/**
 * When two product buttons share a row, Telegram gives each ~half the width and clips long text.
 * Labels longer than this (visible chars, bidi marks stripped) must use a full-width row.
 */
export const PRODUCT_BUTTON_PAIR_MAX_VISIBLE_LENGTH = 24;

export function visibleProductButtonLabelLength(label: string): number {
  return label.replace(/[\u2066-\u2069\u200e\u200f\ufeff]/g, "").trim().length;
}

export function isLongProductButtonLabel(label: string): boolean {
  return visibleProductButtonLabelLength(label) > PRODUCT_BUTTON_PAIR_MAX_VISIBLE_LENGTH;
}

/** Plan product buttons into rows: short+short → 2 columns; any long label → 1 per row. */
export function planProductButtonRows(buttons: KeyboardButton[]): KeyboardButton[][] {
  const rows: KeyboardButton[][] = [];
  let i = 0;
  while (i < buttons.length) {
    const current = buttons[i]!;
    const next = buttons[i + 1];
    if (
      !next ||
      isLongProductButtonLabel(current.text) ||
      isLongProductButtonLabel(next.text)
    ) {
      rows.push([current]);
      i += 1;
    } else {
      rows.push([current, next]);
      i += 2;
    }
  }
  return rows;
}

export function appendProductButtonRows(
  kb: InlineKeyboard,
  buttons: KeyboardButton[],
): InlineKeyboard {
  for (const row of planProductButtonRows(buttons)) {
    if (row.length === 1) {
      appendOneColumn(kb, row);
    } else {
      appendTwoColumn(kb, row);
    }
  }
  return kb;
}
