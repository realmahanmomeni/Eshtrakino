import { InlineKeyboard } from "grammy";
import type { Category, Product } from "@prisma/client";
import { Callbacks } from "./callbacks";
import {
  appendFullWidthCta,
  appendNavBar,
  appendOneColumn,
  appendTwoColumn,
  emojiForLabel,
} from "./grid";

/**
 * Layout order (top → bottom):
 *   [1-col catalog list] → [full-width CTAs] → [nav bar]
 * Button labels use full Persian spaces (no half-space U+200C).
 */

export function mainMenuKeyboard(
  hasPendingInvoice: boolean,
  isAdmin = false,
  layoutColumns: 1 | 2 = 2,
): InlineKeyboard {
  const kb = new InlineKeyboard();

  const destinations = [
    { text: "🛒 فروشگاه", data: Callbacks.shop },
    { text: "👤 حساب من", data: Callbacks.account },
    { text: "💰 کیف پول من", data: Callbacks.wallet },
    { text: "🎧 پشتیبانی / تیکت", data: Callbacks.support },
  ];

  if (layoutColumns === 1) {
    appendOneColumn(kb, destinations);
  } else {
    appendTwoColumn(kb, destinations);
  }

  // Destructive / privileged CTAs (full-width, above any future nav)
  if (hasPendingInvoice) {
    appendFullWidthCta(kb, "❌ لغو فاکتور در انتظار", Callbacks.cancelInvoice);
  }
  if (isAdmin) {
    appendFullWidthCta(kb, "🛠 پنل مدیریت", Callbacks.adminHome);
  }

  // Root menu has no back target
  return kb;
}

export function categoriesKeyboard(
  categories: Category[],
  layoutColumns: 1 | 2 = 1,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  const buttons = categories.map((c) => {
    const label = `${emojiForLabel(c.name)} ${c.name}`;
    return {
      text: label.length > 64 ? `${label.slice(0, 61)}…` : label,
      data: Callbacks.category(c.id),
    };
  });
  if (layoutColumns === 2) {
    appendTwoColumn(kb, buttons);
  } else {
    appendOneColumn(kb, buttons);
  }
  appendNavBar(kb, { text: "🔙 بازگشت", data: Callbacks.mainMenu });
  return kb;
}

function truncateLabel(name: string, max = 40): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

export function productsKeyboard(
  products: Product[],
  options?: { hasPendingInvoice?: boolean; layoutColumns?: 1 | 2 },
): InlineKeyboard {
  const kb = new InlineKeyboard();
  const layoutColumns = options?.layoutColumns ?? 1;

  const buttons = products.map((p) => {
    const label = `📦 ${truncateLabel(p.name)}`;
    return {
      text: label.length > 64 ? `${label.slice(0, 61)}…` : label,
      data: Callbacks.viewProduct(p.id),
    };
  });
  if (layoutColumns === 2) {
    appendTwoColumn(kb, buttons);
  } else {
    appendOneColumn(kb, buttons);
  }

  // Cancel is navigation/destructive — full-width above the back bar
  if (options?.hasPendingInvoice) {
    appendFullWidthCta(kb, "❌ لغو فاکتور", Callbacks.cancelInvoice);
  }

  appendNavBar(kb, { text: "🔙 بازگشت", data: Callbacks.shop });
  return kb;
}

/** Product detail — full-width خرید CTA + back to category list. */
export function productDetailKeyboard(
  productId: number,
  categoryId: number,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  appendFullWidthCta(kb, "💳 خرید این محصول", Callbacks.buy(productId));
  appendNavBar(kb, {
    text: "🔙 بازگشت به لیست",
    data: Callbacks.category(categoryId),
  });
  return kb;
}

export function chooseDeliveryPreferenceKeyboard(productId: number): InlineKeyboard {
  const kb = new InlineKeyboard();
  appendFullWidthCta(kb, "⚡ اکانت آماده (تحویل آنی)", Callbacks.chooseDeliveryReady(productId));
  appendFullWidthCta(
    kb,
    "👤 روی ایمیل شخصی (نیاز به اطلاعات)",
    Callbacks.chooseDeliveryCredentials(productId),
  );
  appendNavBar(kb, { text: "🔙 بازگشت", data: Callbacks.viewProduct(productId) });
  return kb;
}

export function provideCredentialsKeyboard(invoiceId: number): InlineKeyboard {
  const kb = new InlineKeyboard();
  appendFullWidthCta(kb, "🔐 ارسال اطلاعات اکانت", Callbacks.provideCredentials(invoiceId));
  return kb;
}

export function paymentMethodsKeyboard(
  invoiceId: number,
  methods: Array<{ id: number; name: string; type?: string }>,
): InlineKeyboard {
  const kb = new InlineKeyboard();

  appendTwoColumn(
    kb,
    methods.map((m) => ({
      text: `${m.type === "GATEWAY" ? "🌐" : "💳"} ${m.name}`,
      data: Callbacks.payCustom(invoiceId, m.id),
    })),
  );

  appendNavBar(
    kb,
    { text: "❌ لغو فاکتور", data: Callbacks.cancelInv(invoiceId) },
    { text: "🔙 بازگشت", data: Callbacks.mainMenu },
  );
  return kb;
}

export type CheckoutMethodButton = {
  id: number;
  name: string;
  type: "CARD" | "GATEWAY" | string;
};

export function checkoutPaymentChoiceKeyboard(
  invoiceId: number,
  balanceLabel: string,
  options?: {
    swapEnabled?: boolean;
    methods?: CheckoutMethodButton[];
  },
): InlineKeyboard {
  const kb = new InlineKeyboard();
  const methods = options?.methods ?? [];

  for (const m of methods) {
    const icon = m.type === "GATEWAY" ? "🌐" : "💳";
    const suffix = m.type === "CARD" ? " (ارسال فیش)" : "";
    appendFullWidthCta(
      kb,
      `${icon} ${m.name}${suffix}`,
      Callbacks.payCustom(invoiceId, m.id),
    );
  }

  if (options?.swapEnabled) {
    appendFullWidthCta(
      kb,
      "💎 پرداخت با کریپتو (سواپ ولت)",
      Callbacks.paySwap(invoiceId),
    );
  }

  appendFullWidthCta(
    kb,
    `💰 پرداخت از کیف پول (موجودی: ${balanceLabel})`,
    Callbacks.payWallet(invoiceId),
  );
  appendNavBar(
    kb,
    { text: "❌ لغو فاکتور", data: Callbacks.cancelInv(invoiceId) },
    { text: "🔙 بازگشت", data: Callbacks.mainMenu },
  );
  return kb;
}

export function pendingInvoiceKeyboard(invoiceId: number): InlineKeyboard {
  const kb = new InlineKeyboard();

  // Major CTA — full-width
  appendFullWidthCta(kb, "💳 پرداخت", Callbacks.pay(invoiceId));

  // Nav bar — cancel + back
  appendNavBar(
    kb,
    { text: "❌ لغو فاکتور", data: Callbacks.cancelInv(invoiceId) },
    { text: "🔙 بازگشت", data: Callbacks.mainMenu },
  );
  return kb;
}

export function afterPurchaseKeyboard(invoiceId: number): InlineKeyboard {
  return pendingInvoiceKeyboard(invoiceId);
}

/** Admin receipt review — stacked full-width CTAs (تایید / رد). */
export function adminInvoiceReviewKeyboard(invoiceId: number): InlineKeyboard {
  const kb = new InlineKeyboard();
  appendFullWidthCta(kb, "✅ تایید می کنم", Callbacks.adminApproveInvoice(invoiceId));
  appendFullWidthCta(kb, "❌ رد فاکتور", Callbacks.adminRejectInvoice(invoiceId));
  return kb;
}

export function adminTicketReplyKeyboard(ticketId: number): InlineKeyboard {
  const kb = new InlineKeyboard();
  appendFullWidthCta(kb, "💬 پاسخ دادن", Callbacks.adminReplyTicket(ticketId));
  return kb;
}
