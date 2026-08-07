import { InlineKeyboard } from "grammy";
import type { Category, PaymentMethod, Product } from "@prisma/client";
import { Callbacks } from "../keyboards/callbacks";
import {
  appendFullWidthCta,
  appendNavBar,
  appendOneColumn,
  emojiForLabel,
} from "../keyboards/grid";
/** Conversation-scoped callbacks (not handled by admin Composer). */
export const ConvCb = {
  cancel: "conv:cancel",
  skipPhoto: "conv:skip:photo",
  category: (id: number) => `conv:cat:${id}`,
  delivery: (type: "READY" | "MANUAL" | "CREDENTIALS_REQUIRED" | "USER_CHOICE") =>
    `conv:del:${type}`,
  deliveryAdd: (type: "READY" | "MANUAL" | "CREDENTIALS_REQUIRED" | "USER_CHOICE") =>
    `conv:deladd:${type}`,
  deliveryEdit: (type: "READY" | "MANUAL" | "CREDENTIALS_REQUIRED" | "USER_CHOICE") =>
    `conv:deledit:${type}`,
  payType: (type: "CARD" | "GATEWAY") => `conv:ptype:${type}`,
  editProductName: "conv:prd:edit:name",
  editProductPrice: "conv:prd:edit:price",
  editProductDesc: "conv:prd:edit:desc",
  editProductBanner: "conv:prd:edit:banner",
  editProductDelivery: "conv:prd:edit:delivery",
  editProductAlert: "conv:prd:edit:alert",
  editProductDuration: "conv:prd:edit:duration",
  editProductCredReq: "conv:prd:edit:cred_req",
  editProductRestock: "conv:prd:edit:restock",
  durationPreset: (days: number) => `conv:dur:${days}`,
  durationManual: "conv:dur:manual",
} as const;

export function adminHomeKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text("📦 مدیریت کاتالوگ", Callbacks.adminCatalog)
    .text("💳 مدیریت پرداخت", Callbacks.adminPayments)
    .row()
    .text("📊 آمار و CRM", Callbacks.adminStats("all"))
    .text("🎫 مدیریت تیکت ها", Callbacks.adminTickets)
    .row();

  appendFullWidthCta(kb, "👥 مدیریت کاربران", Callbacks.adminUsers);
  appendFullWidthCta(kb, "🧾 مدیریت رسیدها", Callbacks.adminReceipts);
  appendFullWidthCta(kb, "💾 مدیریت بکاپ", Callbacks.adminBackupMenu);
  appendFullWidthCta(kb, "⚙️ تنظیم گروه لاگ", Callbacks.adminSetLogGroup);
  appendNavBar(kb, {
    text: "🔙 بازگشت به منوی کاربر",
    data: Callbacks.mainMenu,
  });
  return kb;
}

export function adminUsersListKeyboard(
  pageData: {
    users: Array<{ id: number; telegramId: string; status: "Active" | "Ghost" }>;
    filter: "all" | "active" | "ghost" | "buyers";
    page: number;
    hasPrev: boolean;
    hasNext: boolean;
  },
): InlineKeyboard {
  const kb = new InlineKeyboard();

  for (const u of pageData.users) {
    const statusIcon = u.status === "Active" ? "🟢" : "👻";
    const label = `${statusIcon} 👤 ID: ${u.telegramId}`;
    kb.text(label.length > 64 ? label.slice(0, 61) + "…" : label, Callbacks.adminUserProfile(u.id)).row();
  }

  if (pageData.users.length === 0) {
    kb.text("— کاربری یافت نشد —", Callbacks.adminUsersList(pageData.filter, 0)).row();
  }

  // Pagination
  const pageLabel = `📄 صفحه ${pageData.page + 1}`;
  if (pageData.hasPrev) {
    kb.text("⬅️ صفحه قبل", Callbacks.adminUsersList(pageData.filter, pageData.page - 1));
  }
  kb.text(pageLabel, Callbacks.adminUsersList(pageData.filter, pageData.page));
  if (pageData.hasNext) {
    kb.text("صفحه بعد ➡️", Callbacks.adminUsersList(pageData.filter, pageData.page + 1));
  }
  kb.row();

  // Filters (reset to page 0)
  const mark = (key: typeof pageData.filter, label: string) =>
    pageData.filter === key ? `· ${label} ·` : label;
  kb.text(mark("all", "همه"), Callbacks.adminUsersList("all", 0))
    .text(mark("active", "فعال"), Callbacks.adminUsersList("active", 0))
    .text(mark("ghost", "روح"), Callbacks.adminUsersList("ghost", 0))
    .text(mark("buyers", "خریدار"), Callbacks.adminUsersList("buyers", 0))
    .row();

  kb.text("🔍 جستجوی کاربر", Callbacks.adminUsersSearchInit).row();
  kb.text("بازگشت", Callbacks.adminHome);
  return kb;
}

/** Cancel search → return to current list page (Composer handles list callback). */
export function adminUserSearchCancelKeyboard(
  listFilter: "all" | "active" | "ghost" | "buyers" = "all",
  listPage = 0,
): InlineKeyboard {
  return new InlineKeyboard().text(
    "لغو و بازگشت",
    Callbacks.adminUsersList(listFilter, listPage),
  );
}

export function adminUserSearchNotFoundKeyboard(
  listFilter: "all" | "active" | "ghost" | "buyers" = "all",
  listPage = 0,
): InlineKeyboard {
  return new InlineKeyboard().text(
    "بازگشت به لیست",
    Callbacks.adminUsersList(listFilter, listPage),
  );
}

export function adminUserProfileKeyboard(
  userId: number,
  listFilter: "all" | "active" | "ghost" | "buyers" = "all",
  listPage = 0,
): InlineKeyboard {
  return new InlineKeyboard()
    .text("✉️ ارسال پیام", Callbacks.adminUserMessage(userId))
    .text("💰 ویرایش موجودی", Callbacks.adminUserBalance(userId))
    .row()
    .text("بازگشت", Callbacks.adminUsersList(listFilter, listPage));
}

export function adminStatsKeyboard(activeTimeframe: string): InlineKeyboard {
  const active = activeTimeframe || "all";
  const mark = (key: string, label: string) =>
    active === key ? `🟢 ${label}` : label;

  const kb = new InlineKeyboard()
    .text(mark("today", "امروز"), Callbacks.adminStats("today"))
    .text(mark("week", "این هفته"), Callbacks.adminStats("week"))
    .text(mark("all", "کل زمان ها"), Callbacks.adminStats("all"))
    .row();

  appendNavBar(kb, {
    text: "🔙 بازگشت به پنل",
    data: Callbacks.adminHome,
  });
  return kb;
}

export function adminReceiptCategoriesKeyboard(counts: {
  pending: number;
  approved: number;
  rejected: number;
}): InlineKeyboard {
  const kb = new InlineKeyboard();
  appendFullWidthCta(
    kb,
    `⏳ در انتظار تایید (${counts.pending})`,
    Callbacks.adminReceiptsList("AWAITING_APPROVAL"),
  );
  appendFullWidthCta(
    kb,
    `✅ تایید شده (${counts.approved})`,
    Callbacks.adminReceiptsList("PAID"),
  );
  appendFullWidthCta(
    kb,
    `❌ رد شده (${counts.rejected})`,
    Callbacks.adminReceiptsList("CANCELLED"),
  );
  appendNavBar(kb, {
    text: "🔙 بازگشت به پنل",
    data: Callbacks.adminHome,
  });
  return kb;
}

export function adminReceiptsBackKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  appendNavBar(kb, {
    text: "🔙 بازگشت به رسیدها",
    data: Callbacks.adminReceipts,
  });
  return kb;
}

export function adminBackupMenuKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  appendFullWidthCta(kb, "📥 بکاپ دستی", Callbacks.adminManualBackup);
  appendFullWidthCta(kb, "⏱ تنظیم بکاپ خودکار", Callbacks.adminSetAutoBackup);
  appendNavBar(kb, {
    text: "🔙 بازگشت به پنل",
    data: Callbacks.adminHome,
  });
  return kb;
}

export function adminTicketsKeyboard(openCount: number, closedCount: number): InlineKeyboard {
  return new InlineKeyboard()
    .text(`🟢 تیکت های باز (${openCount})`, Callbacks.adminTicketsOpen)
    .text(`🔴 تیکت های بسته (${closedCount})`, Callbacks.adminTicketsClosed)
    .row()
    .text("🔙 بازگشت", Callbacks.adminHome);
}

export function adminTicketListKeyboard(
  tickets: Array<{ id: number; userTelegramId: string }>,
  list: "open" | "closed",
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const t of tickets) {
    const label = `#${t.id} · 👤 ${t.userTelegramId}`;
    kb.text(label.length > 60 ? `${label.slice(0, 57)}…` : label, Callbacks.adminTicketView(t.id)).row();
  }
  kb.text(
    "🔙 بازگشت",
    list === "open" || list === "closed" ? Callbacks.adminTickets : Callbacks.adminHome,
  );
  return kb;
}

export function adminTicketActionsKeyboard(
  ticketId: number,
  status: "OPEN" | "CLOSED",
): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (status === "OPEN") {
    kb.text("💬 پاسخ دادن", Callbacks.adminReplyTicket(ticketId))
      .text("🔒 بستن تیکت", Callbacks.adminCloseTicket(ticketId))
      .row();
  } else {
    kb.text("💬 پاسخ دادن", Callbacks.adminReplyTicket(ticketId)).row();
  }
  kb.text("🔙 لیست باز", Callbacks.adminTicketsOpen)
    .text("🎫 منوی تیکت", Callbacks.adminTickets);
  return kb;
}

export function adminCatalogKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("➕ افزودن دسته", Callbacks.adminAddCategory)
    .text("🗑 حذف دسته", Callbacks.adminDelCategoryMenu)
    .row()
    .text("➕ افزودن محصول", Callbacks.adminAddProduct)
    .text("✏️ ویرایش محصول", Callbacks.adminEditProductMenu)
    .row()
    .text("📊 گزارش موجودی انبار", Callbacks.adminInventoryReport)
    .row()
    .text("🗑 حذف محصول", Callbacks.adminDelProductMenu)
    .row()
    .text("🔙 بازگشت", Callbacks.adminHome);
}

export function adminPaymentsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("➕ افزودن روش پرداخت", Callbacks.adminAddPayment)
    .row()
    .text("📋 لیست و تنظیمات", Callbacks.adminListPayments)
    .row()
    .text("🔙 بازگشت", Callbacks.adminHome);
}

export function adminDeleteCategoriesKeyboard(categories: Category[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  appendOneColumn(
    kb,
    categories
      .filter((c) => c.isActive)
      .map((c) => {
        const label = `${emojiForLabel(c.name)} ${c.name}`;
        return {
          text: label.length > 64 ? `${label.slice(0, 61)}…` : label,
          data: Callbacks.adminDelCategory(c.id),
        };
      }),
  );
  kb.text("🔙 بازگشت", Callbacks.adminCatalog);
  return kb;
}

export function adminProductPickKeyboard(
  products: Array<Product & { category?: Category }>,
  mode: "price" | "delete" | "edit",
): InlineKeyboard {
  const kb = new InlineKeyboard();
  appendOneColumn(
    kb,
    products.map((p) => {
      const price = Math.round(Number(p.price)).toLocaleString("en-US");
      const name = p.name.length > 36 ? `${p.name.slice(0, 35)}…` : p.name;
      const data =
        mode === "price"
          ? Callbacks.adminEditPrice(p.id)
          : mode === "edit"
            ? Callbacks.adminEditProduct(p.id)
            : Callbacks.adminDelProduct(p.id);
      const label = `${emojiForLabel(p.name)} ${name} · ${price}`;
      return {
        text: label.length > 64 ? `${label.slice(0, 61)}…` : label,
        data,
      };
    }),
  );
  kb.text("🔙 بازگشت", Callbacks.adminCatalog);
  return kb;
}

export function convProductEditKeyboard(
  product: Pick<Product, "id" | "deliveryType">,
): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text("📝 ویرایش نام", ConvCb.editProductName)
    .text("💰 ویرایش قیمت", ConvCb.editProductPrice)
    .row()
    .text("🔖 ویرایش توضیحات (کپشن)", ConvCb.editProductDesc)
    .row()
    .text("🖼 ویرایش بنر محصول", ConvCb.editProductBanner)
    .row()
    .text("🚚 ویرایش نوع تحویل", ConvCb.editProductDelivery)
    .row()
    .text("⚠️ تنظیم هشدار موجودی", ConvCb.editProductAlert)
    .row()
    .text("⏱ تنظیم مدت اشتراک (روز)", ConvCb.editProductDuration)
    .row();

  if (
    product.deliveryType === "CREDENTIALS_REQUIRED" ||
    product.deliveryType === "USER_CHOICE"
  ) {
    kb.text("🔑 تنظیم فیلدهای دریافتی", ConvCb.editProductCredReq).row();
  }

  if (product.deliveryType === "READY") {
    kb.text("📦 شارژ انبار", ConvCb.editProductRestock).row();
  }

  kb.text("❌ لغو", ConvCb.cancel);
  return kb;
}

export function convProductDurationKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("۱ ماهه (۳۰ روز)", ConvCb.durationPreset(30))
    .text("۳ ماهه (۹۰ روز)", ConvCb.durationPreset(90))
    .row()
    .text("۶ ماهه (۱۸۰ روز)", ConvCb.durationPreset(180))
    .text("یکسال (۳۶۵ روز)", ConvCb.durationPreset(365))
    .row()
    .text("⌨️ وارد کردن دستی", ConvCb.durationManual)
    .row()
    .text("❌ لغو", ConvCb.cancel);
}

export function convDeliveryTypeEditKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📦 موجودی آماده", ConvCb.deliveryEdit("READY"))
    .text("✋ تحویل دستی", ConvCb.deliveryEdit("MANUAL"))
    .row()
    .text("🔐 نیاز به اطلاعات اکانت", ConvCb.deliveryEdit("CREDENTIALS_REQUIRED"))
    .row()
    .text("🔀 انتخاب توسط کاربر (آنی/شخصی)", ConvCb.deliveryEdit("USER_CHOICE"))
    .row()
    .text("❌ لغو", ConvCb.cancel);
}

export function adminPaymentListKeyboard(
  methods: PaymentMethod[],
  swapEnabled: boolean,
): InlineKeyboard {
  const kb = new InlineKeyboard();

  for (const m of methods) {
    const status = m.isActive ? "✅" : "⏸";
    const icon = m.type === "CARD" ? "💳" : "🌐";
    kb.text(`${status} ${icon} ${m.name}`, Callbacks.adminTogglePayment(m.id)).row();
    kb.text(`⚙️ تنظیم «${m.name}»`, Callbacks.adminConfigPayment(m.id)).row();
  }

  const swapStatus = swapEnabled ? "✅" : "⏸";
  kb.text(`${swapStatus} 💎 سواپ ولت`, Callbacks.adminToggleSwapPay).row();
  kb.text("🔑 تنظیم API Key سواپ ولت", Callbacks.adminSetSwapApiKey).row();
  kb.text("💼 تنظیم آدرس ولت سواپ", Callbacks.adminSetSwapWalletAddress).row();

  kb.text("🔙 بازگشت", Callbacks.adminPayments);
  return kb;
}

export function convCancelKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("❌ لغو", ConvCb.cancel);
}

export function convCategoryPickKeyboard(categories: Category[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  appendOneColumn(
    kb,
    categories.map((c) => {
      const label = `${emojiForLabel(c.name)} ${c.name}`;
      return {
        text: label.length > 64 ? `${label.slice(0, 61)}…` : label,
        data: ConvCb.category(c.id),
      };
    }),
  );
  kb.text("❌ لغو", ConvCb.cancel);
  return kb;
}

/** Add-product delivery types */
export function convDeliveryAddProductKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📦 موجودی آماده", ConvCb.deliveryAdd("READY"))
    .text("✋ تحویل دستی", ConvCb.deliveryAdd("MANUAL"))
    .row()
    .text("🔐 نیاز به اطلاعات اکانت", ConvCb.deliveryAdd("CREDENTIALS_REQUIRED"))
    .row()
    .text("🔀 انتخاب توسط کاربر (آنی/شخصی)", ConvCb.deliveryAdd("USER_CHOICE"))
    .row()
    .text("❌ لغو", ConvCb.cancel);
}

/** Matches reference: 📦 موجودی آماده / ✋ تحویل دستی / 🔐 نیاز به اطلاعات اکانت */
export function convDeliveryKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📦 موجودی آماده", ConvCb.delivery("READY"))
    .text("✋ تحویل دستی", ConvCb.delivery("MANUAL"))
    .row()
    .text("🔐 نیاز به اطلاعات اکانت", ConvCb.delivery("CREDENTIALS_REQUIRED"))
    .row()
    .text("❌ لغو", ConvCb.cancel);
}

/** @deprecated alias */
export function convFulfillmentKeyboard(): InlineKeyboard {
  return convDeliveryKeyboard();
}

export function convPaymentTypeKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("💳 کارت به کارت", ConvCb.payType("CARD"))
    .text("🌐 درگاه آنلاین", ConvCb.payType("GATEWAY"))
    .row()
    .text("❌ لغو", ConvCb.cancel);
}
