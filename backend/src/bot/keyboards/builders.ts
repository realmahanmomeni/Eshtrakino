import { InlineKeyboard, Keyboard } from "grammy";
import type { Category, Product } from "@prisma/client";
import { Callbacks } from "./callbacks";
import {
  appendFullWidthCta,
  appendNavBar,
  appendOneColumn,
  appendTwoColumn,
  emojiForLabel,
  type KeyboardButton,
} from "./grid";
import {
  BUTTON_CUSTOM_EMOJIS,
  getProductCustomEmojiId,
  getCategoryCustomEmojiId,
  getSubCategoryCustomEmojiId,
} from "./buttonEmojis";
import { withOutOfStockPrefix } from "../../services/catalog/catalogAvailability";
import { truncateInlineButtonLabel } from "../../lib/telegramLabel";
import { formatShopProductInlineLabel } from "./shopProductButtonLabel";
import { formatShopNavButtonLabel } from "./shopNavButtonLabel";

/**
 * Layout order (top → bottom):
 *   [1-col catalog list] → [full-width CTAs] → [nav bar]
 * Button labels use full Persian spaces (no half-space U+200C).
 */

/**
 * @deprecated Removed in favor of pure inline keyboards to prevent locking Android back gesture.
 */
export function persistentReplyKeyboard(isAdmin = false): Keyboard {
  const kb = new Keyboard()
    .text("🛍️ فروشگاه").text("📦 سفارشهای من").row()
    .text("💳 کیف پول").text("👤 حساب کاربری").row()
    .text("📞 پشتیبانی و تیکت");

  if (isAdmin) {
    kb.row().text("⚙️ پنل مدیریت");
  }

  return kb.resized().persistent();
}

export function mainMenuKeyboard(
  hasPendingInvoice: boolean,
  isAdmin = false,
  layoutColumns: 1 | 2 = 2,
): InlineKeyboard {
  const kb = new InlineKeyboard();

  const destinations: KeyboardButton[] = [
    { text: "فروشگاه", data: Callbacks.shop, icon_custom_emoji_id: BUTTON_CUSTOM_EMOJIS.CATEGORY },
    { text: "حساب من", data: Callbacks.account, icon_custom_emoji_id: BUTTON_CUSTOM_EMOJIS.ACCOUNT },
    { text: "کیف پول من", data: Callbacks.wallet, icon_custom_emoji_id: BUTTON_CUSTOM_EMOJIS.WALLET },
    { text: "پشتیبانی / تیکت", data: Callbacks.support, icon_custom_emoji_id: BUTTON_CUSTOM_EMOJIS.SUPPORT },
  ];

  if (layoutColumns === 1) {
    appendOneColumn(kb, destinations);
  } else {
    appendTwoColumn(kb, destinations);
  }

  // Destructive / privileged CTAs (full-width, above any future nav)
  if (hasPendingInvoice) {
    appendFullWidthCta(
      kb,
      "لغو فاکتور در انتظار",
      Callbacks.cancelInvoice,
      BUTTON_CUSTOM_EMOJIS.CANCEL,
    );
  }
  if (isAdmin) {
    appendFullWidthCta(kb, "🛠 پنل مدیریت", Callbacks.adminHome);
  }

  // Root menu has no back target
  return kb;
}

export function categoriesKeyboard(
  categories: Category[],
  layoutColumns: 1 | 2 = 2,
  options?: { outOfStockByCategoryId?: Map<number, boolean> },
): InlineKeyboard {
  const kb = new InlineKeyboard();
  const buttons: KeyboardButton[] = categories.map((c) => {
    const fullyOos = options?.outOfStockByCategoryId?.get(c.id) ?? false;
    const label = withOutOfStockPrefix(formatShopNavButtonLabel(c.name), fullyOos);
    return {
      text: label.length > 64 ? truncateInlineButtonLabel(label, 64) : label,
      data: Callbacks.category(c.id),
      icon_custom_emoji_id: getCategoryCustomEmojiId(c.name),
    };
  });
  if (layoutColumns === 2) {
    appendTwoColumn(kb, buttons);
  } else {
    appendOneColumn(kb, buttons);
  }
  appendNavBar(kb, {
    text: "🔙 بازگشت",
    data: Callbacks.mainMenu,
    icon_custom_emoji_id: BUTTON_CUSTOM_EMOJIS.BACK,
  });
  return kb;
}

const SHOP_SEARCH_BTN = "🔍 جستجو در محصولات";
const SHOP_REFRESH_BTN = "🔄 بروزرسانی قیمت و موجودی";
const SHOP_BACK_MAIN_BTN = "🔙 بازگشت به منوی اصلی";

/** Root shop menu: categories → search → refresh → back to main. */
export function shopRootMenuKeyboard(
  categories: Category[],
  layoutColumns: 1 | 2 = 2,
  options?: { outOfStockByCategoryId?: Map<number, boolean> },
): InlineKeyboard {
  const kb = new InlineKeyboard();
  const buttons: KeyboardButton[] = categories.map((c) => {
    const fullyOos = options?.outOfStockByCategoryId?.get(c.id) ?? false;
    const label = withOutOfStockPrefix(formatShopNavButtonLabel(c.name), fullyOos);
    return {
      text: label.length > 64 ? truncateInlineButtonLabel(label, 64) : label,
      data: Callbacks.category(c.id),
      icon_custom_emoji_id: getCategoryCustomEmojiId(c.name),
    };
  });
  if (layoutColumns === 2) {
    appendTwoColumn(kb, buttons);
  } else {
    appendOneColumn(kb, buttons);
  }
  appendFullWidthCta(kb, SHOP_SEARCH_BTN, Callbacks.shopSearch, BUTTON_CUSTOM_EMOJIS.SEARCH);
  kb.row().text(SHOP_REFRESH_BTN, Callbacks.shopRefresh);
  appendNavBar(kb, {
    text: SHOP_BACK_MAIN_BTN,
    data: Callbacks.mainMenu,
    icon_custom_emoji_id: BUTTON_CUSTOM_EMOJIS.BACK,
  });
  return kb;
}

export function searchResultsKeyboard(
  products: Array<{ id: number; name: string; outOfStock: boolean }>,
  _displayQuery: string,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const p of products) {
    const customEmojiId = getProductCustomEmojiId(p.name);
    const namePart = truncateLabel(cleanProductLabel(p.name), 35);
    const label = withOutOfStockPrefix(namePart, p.outOfStock);
    appendFullWidthCta(
      kb,
      label.length > 64 ? `${label.slice(0, 61)}…` : label,
      Callbacks.viewProduct(p.id),
      customEmojiId,
    );
  }
  kb
    .row()
    .text(SHOP_SEARCH_BTN, Callbacks.shopSearch)
    .text("🛍 بازگشت به فروشگاه", Callbacks.shopRoot);
  return kb;
}

function truncateLabel(name: string, max = 40): string {
  return truncateInlineButtonLabel(name, max);
}

function extractDurationSuffix(name: string): string | null {
  const m = name.match(
    /(?:۱|۲|۳|۴|۵|۶|۷|۸|۹|۰|\d+)\s*(?:ماهه?|ساله?|روزه?)/,
  );
  return m ? m[0].replace(/\s+/g, " ").trim() : null;
}

/** Keep inline shop labels distinct within one list (append duration or price when names collide). */
export function shopProductButtonLabels(
  products: Array<{ id: number; name: string; formattedPrice?: string }>,
): Map<number, string> {
  const cleaned = products.map((p) => ({
    id: p.id,
    base: cleanProductLabel(p.name),
    price: p.formattedPrice?.trim(),
  }));
  const counts = new Map<string, number>();
  for (const p of cleaned) {
    counts.set(p.base, (counts.get(p.base) ?? 0) + 1);
  }

  const labels = new Map<number, string>();
  for (const p of cleaned) {
    let displayName = p.base;
    if ((counts.get(p.base) ?? 0) > 1) {
      const duration = extractDurationSuffix(p.base);
      if (duration && !displayName.includes(duration)) {
        displayName = `${displayName} ${duration}`;
      } else if (!p.price) {
        displayName = `${displayName} #${p.id}`;
      }
    }
    labels.set(
      p.id,
      formatShopProductInlineLabel(displayName, p.price),
    );
  }
  return labels;
}

/**
 * Strips obsolete ticket emoji (🎟) from product names at display time.
 * The button icon itself uses the Star Premium custom emoji (icon_custom_emoji_id).
 */
function cleanProductLabel(name: string): string {
  return name
    .replace(/[🎟🎫]/g, "")
    .replace(/\s*[-—–]\s*[\d,۰-۹٠-٩]+\s*(?:تومان|toman)\b/gi, "")
    .replace(/\s*\([\d,۰-۹٠-٩]+\s*(?:تومان|toman)\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function categoryContentsKeyboard(
  subCategories: Array<{ id: number; name: string; outOfStock?: boolean }>,
  standaloneProducts: Array<{
    id: number;
    name: string;
    outOfStock?: boolean;
    formattedPrice?: string;
  }> = [],
  options?: {
    hasPendingInvoice?: boolean;
    layoutColumns?: 1 | 2;
    categoryId?: number;
    subCategoryId?: number;
    adminOutOfStockToggle?: { showing: boolean };
  },
): InlineKeyboard {
  const kb = new InlineKeyboard();

  if (subCategories.length > 0) {
    const subCatButtons: KeyboardButton[] = subCategories.map((s) => {
      const namePart = formatShopNavButtonLabel(cleanProductLabel(s.name));
      const label = withOutOfStockPrefix(namePart, Boolean(s.outOfStock));
      return {
        text: label.length > 64 ? truncateInlineButtonLabel(label, 64) : label,
        data: Callbacks.subCategoryView(s.id),
        icon_custom_emoji_id: getSubCategoryCustomEmojiId(s.name),
      };
    });
    appendTwoColumn(kb, subCatButtons);
  }

  if (standaloneProducts.length > 0) {
    const labelById = shopProductButtonLabels(standaloneProducts);
    const prodButtons: KeyboardButton[] = standaloneProducts.map((p) => {
      const customEmojiId = getProductCustomEmojiId(p.name);
      const namePart =
        labelById.get(p.id) ??
        formatShopProductInlineLabel(cleanProductLabel(p.name), p.formattedPrice);
      const label = withOutOfStockPrefix(namePart, Boolean(p.outOfStock));
      return {
        text: label,
        data: Callbacks.viewProduct(p.id),
        icon_custom_emoji_id: customEmojiId,
      };
    });
    if (options?.layoutColumns === 1) {
      appendOneColumn(kb, prodButtons);
    } else {
      appendTwoColumn(kb, prodButtons);
    }
  }

  appendFullWidthCta(kb, SHOP_SEARCH_BTN, Callbacks.shopSearch, BUTTON_CUSTOM_EMOJIS.SEARCH);

  if (options?.adminOutOfStockToggle) {
    kb.row().text(
      options.adminOutOfStockToggle.showing
        ? "🙈 مخفی کردن ناموجودها"
        : "👁 نمایش ناموجودها",
      Callbacks.shopToggleOutOfStock,
    );
  }

  if (options?.categoryId != null) {
    kb.row().text("🔄 بروزرسانی قیمت و موجودی", Callbacks.categoryRefresh(options.categoryId));
  }

  // Cancel is navigation/destructive
  if (options?.hasPendingInvoice) {
    appendFullWidthCta(
      kb,
      "لغو فاکتور ✕",
      Callbacks.cancelInvoice,
      BUTTON_CUSTOM_EMOJIS.CANCEL,
    );
  }
  appendNavBar(kb, {
    text: "🔙 بازگشت",
    data: Callbacks.shop,
    icon_custom_emoji_id: BUTTON_CUSTOM_EMOJIS.BACK,
  });
  return kb;
}

export function subCategoriesKeyboard(
  subCategories: Array<{ id: number; name: string }>,
  standaloneProducts: Array<{ id: number; name: string }> = [],
  options?: { hasPendingInvoice?: boolean; layoutColumns?: 1 | 2 },
): InlineKeyboard {
  return categoryContentsKeyboard(subCategories, standaloneProducts, options);
}

export function servicePlansKeyboard(
  products: Array<{ id: number; name: string; formattedPrice?: string; outOfStock?: boolean }>,
  categoryId: number,
  categoryName?: string,
  subCategoryId?: number,
  options?: {
    adminOutOfStockToggle?: { showing: boolean };
  },
): InlineKeyboard {
  const kb = new InlineKeyboard();
  const labelById = shopProductButtonLabels(products);
  for (const p of products) {
    const customEmojiId = getProductCustomEmojiId(p.name);
    const namePart =
      labelById.get(p.id) ??
      formatShopProductInlineLabel(cleanProductLabel(p.name), p.formattedPrice);
    const label = withOutOfStockPrefix(namePart, Boolean(p.outOfStock));
    appendFullWidthCta(kb, label, Callbacks.viewProduct(p.id), customEmojiId);
  }
  if (options?.adminOutOfStockToggle) {
    kb.row().text(
      options.adminOutOfStockToggle.showing
        ? "🙈 مخفی کردن ناموجودها"
        : "👁 نمایش ناموجودها",
      Callbacks.shopToggleOutOfStock,
    );
  }
  if (subCategoryId != null) {
    kb.row().text("🔄 بروزرسانی قیمت و موجودی", Callbacks.categoryRefresh(categoryId));
  }
  appendNavBar(kb, {
    text: "🔙 بازگشت",
    data: Callbacks.category(categoryId),
    icon_custom_emoji_id: BUTTON_CUSTOM_EMOJIS.BACK,
  });
  return kb;
}

export function productsKeyboard(
  products: Product[],
  options?: { hasPendingInvoice?: boolean; layoutColumns?: 1 | 2 },
): InlineKeyboard {
  return categoryContentsKeyboard([], products, options);
}

/** Product detail — full-width خرید CTA + back to subcategory or category list. */
export function productDetailKeyboard(
  productId: number,
  categoryId: number,
  subCategoryId?: number | null,
  options?: { showDescriptionMore?: boolean; allowPurchase?: boolean },
): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (options?.showDescriptionMore) {
    appendFullWidthCta(kb, "📄 ادامه توضیحات", Callbacks.productDescriptionMore(productId));
  }
  if (options?.allowPurchase !== false) {
    appendFullWidthCta(
      kb,
      "خرید این محصول",
      Callbacks.buy(productId),
      BUTTON_CUSTOM_EMOJIS.BUY,
    );
  }
  if (subCategoryId != null) {
    appendNavBar(kb, {
      text: "🔙 بازگشت",
      data: Callbacks.subCategoryView(subCategoryId),
      icon_custom_emoji_id: BUTTON_CUSTOM_EMOJIS.BACK,
    });
  } else {
    appendNavBar(kb, {
      text: "🔙 بازگشت",
      data: Callbacks.category(categoryId),
      icon_custom_emoji_id: BUTTON_CUSTOM_EMOJIS.BACK,
    });
  }
  return kb;
}

export function chooseDeliveryPreferenceKeyboard(productId: number): InlineKeyboard {
  const kb = new InlineKeyboard();
  appendFullWidthCta(
    kb,
    "اکانت آماده (تحویل آنی)",
    Callbacks.chooseDeliveryReady(productId),
    BUTTON_CUSTOM_EMOJIS.READY_ACCOUNT,
  );
  appendFullWidthCta(
    kb,
    "روی ایمیل شخصی (نیاز به اطلاعات)",
    Callbacks.chooseDeliveryCredentials(productId),
    BUTTON_CUSTOM_EMOJIS.EMAIL_DELIVERY,
  );
  appendNavBar(kb, {
    text: "🔙 بازگشت",
    data: Callbacks.viewProduct(productId),
    icon_custom_emoji_id: BUTTON_CUSTOM_EMOJIS.BACK,
  });
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
    methods.map((m) => {
      const isGateway = m.type === "GATEWAY";
      if (isGateway) {
        return {
          text: `درگاه بانکی: ${m.name}`,
          data: Callbacks.payCustom(invoiceId, m.id),
          icon_custom_emoji_id: BUTTON_CUSTOM_EMOJIS.BANK_GATEWAY,
        };
      }
      return {
        text: m.name,
        data: Callbacks.payCustom(invoiceId, m.id),
        icon_custom_emoji_id: BUTTON_CUSTOM_EMOJIS.CARD_TO_CARD,
      };
    }),
  );

  appendNavBar(
    kb,
    {
      text: "لغو فاکتور ✕",
      data: Callbacks.cancelInv(invoiceId),
      icon_custom_emoji_id: BUTTON_CUSTOM_EMOJIS.CANCEL,
    },
    {
      text: "بازگشت",
      data: Callbacks.mainMenu,
      icon_custom_emoji_id: BUTTON_CUSTOM_EMOJIS.BACK,
    },
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
    hasDiscount?: boolean;
  },
): InlineKeyboard {
  const kb = new InlineKeyboard();
  const methods = options?.methods ?? [];

  for (const m of methods) {
    const isGateway = m.type === "GATEWAY";
    if (isGateway) {
      appendFullWidthCta(
        kb,
        `درگاه بانکی: ${m.name}`,
        Callbacks.payCustom(invoiceId, m.id),
        BUTTON_CUSTOM_EMOJIS.BANK_GATEWAY,
      );
    } else {
      const suffix = m.type === "CARD" ? " (ارسال فیش)" : "";
      appendFullWidthCta(
        kb,
        `${m.name}${suffix}`,
        Callbacks.payCustom(invoiceId, m.id),
        BUTTON_CUSTOM_EMOJIS.CARD_TO_CARD,
      );
    }
  }

  if (options?.swapEnabled) {
    appendFullWidthCta(
      kb,
      "پرداخت با کریپتو (سواپ ولت)",
      Callbacks.paySwap(invoiceId),
      BUTTON_CUSTOM_EMOJIS.CRYPTO,
    );
  }

  appendFullWidthCta(
    kb,
    `پرداخت از کیف پول (موجودی: ${balanceLabel})`,
    Callbacks.payWallet(invoiceId),
    BUTTON_CUSTOM_EMOJIS.WALLET,
  );

  appendFullWidthCta(
    kb,
    options?.hasDiscount ? "تغییر کد تخفیف" : "اعمال کد تخفیف",
    Callbacks.applyDiscount(invoiceId),
    BUTTON_CUSTOM_EMOJIS.DISCOUNT,
  );

  appendNavBar(
    kb,
    {
      text: "لغو فاکتور ✕",
      data: Callbacks.cancelInv(invoiceId),
      icon_custom_emoji_id: BUTTON_CUSTOM_EMOJIS.CANCEL,
    },
    {
      text: "بازگشت",
      data: Callbacks.mainMenu,
      icon_custom_emoji_id: BUTTON_CUSTOM_EMOJIS.BACK,
    },
  );
  return kb;
}

export function pendingInvoiceKeyboard(
  invoiceId: number,
  options?: { hasDiscount?: boolean },
): InlineKeyboard {
  const kb = new InlineKeyboard();

  // Major CTA — full-width green positive accent
  appendFullWidthCta(
    kb,
    "تایید و پرداخت",
    Callbacks.pay(invoiceId),
    BUTTON_CUSTOM_EMOJIS.CONFIRM_PAYMENT,
  );

  // Discount button
  appendFullWidthCta(
    kb,
    options?.hasDiscount ? "تغییر کد تخفیف" : "اعمال کد تخفیف",
    Callbacks.applyDiscount(invoiceId),
    BUTTON_CUSTOM_EMOJIS.DISCOUNT,
  );

  // Nav bar — cancel + back (Back is 🔴 and Cancel is colorless ✕)
  appendNavBar(
    kb,
    {
      text: "لغو فاکتور ✕",
      data: Callbacks.cancelInv(invoiceId),
      icon_custom_emoji_id: BUTTON_CUSTOM_EMOJIS.CANCEL,
    },
    {
      text: "بازگشت",
      data: Callbacks.mainMenu,
      icon_custom_emoji_id: BUTTON_CUSTOM_EMOJIS.BACK,
    },
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

export function depositAmountButton(
  text: string,
  data: string,
): KeyboardButton {
  return {
    text,
    data,
    icon_custom_emoji_id: BUTTON_CUSTOM_EMOJIS.DEPOSIT_AMOUNT,
  };
}
