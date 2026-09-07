import { InlineKeyboard } from "grammy";
import { Callbacks } from "../keyboards/callbacks";
import {
  appendNavBar,
  appendOneColumn,
  appendTwoColumn,
  type KeyboardButton,
} from "../keyboards/grid";
import { BUTTON_CUSTOM_EMOJIS } from "../keyboards/buttonEmojis";

export type WalletMethodButton = {
  id: number;
  name: string;
  type: "CARD" | "GATEWAY" | string;
};

export function walletMenuKeyboard(options?: {
  swapEnabled?: boolean;
  methods?: WalletMethodButton[];
  layoutColumns?: 1 | 2;
}): InlineKeyboard {
  const kb = new InlineKeyboard();
  const methods = options?.methods ?? [];
  const layoutColumns = options?.layoutColumns ?? 2;

  const actionButtons: Array<KeyboardButton> = [];

  for (const m of methods) {
    const isGateway = m.type === "GATEWAY";
    if (isGateway) {
      actionButtons.push({
        text: `شارژ با درگاه ${m.name}`,
        data: Callbacks.walletCustom(m.id),
        icon_custom_emoji_id: BUTTON_CUSTOM_EMOJIS.BANK_GATEWAY,
      });
    } else {
      const label = `شارژ با ${m.name}`;
      actionButtons.push({
        text:
          label.length > 64
            ? label.slice(0, 61) + "…"
            : label,
        data: Callbacks.walletCustom(m.id),
        icon_custom_emoji_id: BUTTON_CUSTOM_EMOJIS.CARD_TO_CARD,
      });
    }
  }

  if (options?.swapEnabled !== false) {
    actionButtons.push({
      text: "شارژ با کریپتو (SwapWallet)",
      data: Callbacks.walletSwapDeposit,
      icon_custom_emoji_id: BUTTON_CUSTOM_EMOJIS.CRYPTO,
    });
  }

  if (layoutColumns === 2 && actionButtons.length > 0) {
    appendTwoColumn(kb, actionButtons);
  } else if (actionButtons.length > 0) {
    appendOneColumn(kb, actionButtons);
  }

  appendNavBar(kb, {
    text: "بازگشت",
    data: Callbacks.mainMenu,
    icon_custom_emoji_id: BUTTON_CUSTOM_EMOJIS.BACK,
  });
  return kb;
}
