import { InlineKeyboard } from "grammy";
import { Callbacks } from "../keyboards/callbacks";
import {
  appendFullWidthCta,
  appendNavBar,
  appendTwoColumn,
} from "../keyboards/grid";

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
  const layoutColumns = options?.layoutColumns ?? 1;

  const methodButtons = methods.map((m) => {
    const icon = m.type === "GATEWAY" ? "🌐" : "💳";
    return {
      text: `${icon} شارژ با ${m.name}`.length > 64
        ? `${icon} ${m.name}`.slice(0, 61) + "…"
        : `${icon} شارژ با ${m.name}`,
      data: Callbacks.walletCustom(m.id),
    };
  });

  if (layoutColumns === 2 && methodButtons.length > 0) {
    appendTwoColumn(kb, methodButtons);
  } else {
    for (const b of methodButtons) {
      appendFullWidthCta(kb, b.text, b.data);
    }
  }

  if (options?.swapEnabled !== false) {
    appendFullWidthCta(kb, "💎 شارژ با کریپتو (SwapWallet)", Callbacks.walletSwapDeposit);
  }

  appendNavBar(kb, { text: "🔙 بازگشت", data: Callbacks.mainMenu });
  return kb;
}
