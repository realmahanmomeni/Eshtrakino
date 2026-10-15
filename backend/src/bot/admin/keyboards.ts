import { InlineKeyboard } from "grammy";
import type { Category, PaymentMethod, Product, DeliveryType, PaymentMethodType } from "@prisma/client";
import { Callbacks } from "../keyboards/callbacks";
import {
  appendFullWidthCta,
  appendNavBar,
  appendOneColumn,
  appendTwoColumn,
  emojiForLabel,
} from "../keyboards/grid";
/** Conversation-scoped callbacks (not handled by admin Composer). */
export const ConvCb = {
  cancel: "conv:cancel",
  skipPhoto: "conv:skip:photo",
  category: (id: number) => `conv:cat:${id}`,
  delivery: (
    type: "READY" | "MANUAL" | "CREDENTIALS_REQUIRED" | "USER_CHOICE" | "SUPPLIER_AUTO",
  ) => `conv:del:${type}`,
  deliveryAdd: (
    type: "READY" | "MANUAL" | "CREDENTIALS_REQUIRED" | "USER_CHOICE" | "SUPPLIER_AUTO",
  ) => `conv:deladd:${type}`,
  deliveryEdit: (
    type: "READY" | "MANUAL" | "CREDENTIALS_REQUIRED" | "USER_CHOICE" | "SUPPLIER_AUTO",
  ) => `conv:deledit:${type}`,
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
  discountScopeAll: "conv:dsc:scope:all",
  discountScopeSpecific: "conv:dsc:scope:specific",
  discountToggleProduct: (id: number) => `conv:dsc:tog:${id}`,
  discountConfirmProducts: "conv:dsc:confirm_prds",
  subCategory: (id: number) => `conv:subcat:${id}`,
  subCategoryAdd: "conv:subcat:add",
  subCategoryNone: "conv:subcat:none",
  editSubCategoryName: "conv:subcat:edit_name",
  editSubCategoryDesc: "conv:subcat:edit_desc",
  deleteSubCategory: "conv:subcat:delete",
  editProductSubCategory: "conv:prd:edit_subcat",
  pickCat: (id: number) => `conv:pick:cat:${id}`,
  pickSubCat: (id: number) => `conv:pick:subcat:${id}`,
  pickProd: (id: number) => `conv:pick:prod:${id}`,
  pickBackCats: "conv:pick:back:cats",
  pickBackCat: "conv:pick:back:cat",
  discountCat: (id: number) => `dsc:cat:${id}`,
  discountSubCat: (id: number) => `dsc:subcat:${id}`,
  discountTog: (id: number) => `dsc:tog:${id}`,
  discountBackCats: "dsc:back_cats",
  discountBackSubCats: "dsc:back_subcats",
  discountDone: "dsc:done",
  discountCancel: "dsc:cancel",
} as const;

export function adminHomeKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();

  const actions = [
    { text: "💳 مدیریت پرداخت", data: Callbacks.adminPayments },
    { text: "📦 مدیریت کاتالوگ", data: Callbacks.adminCatalog },
    { text: "🎫 مدیریت تیکتها", data: Callbacks.adminTickets },
    { text: "📊 آمار و CRM", data: Callbacks.adminStats("all") },
    { text: "🖼️ مدیریت صفحات", data: "adm:cms_menu" },
    { text: "👥 مدیریت کاربران", data: Callbacks.adminUsers },
    { text: "🧾 مدیریت رسیدها", data: Callbacks.adminReceipts },
    { text: "🔗 تامین‌کنندگان", data: "adm:suppliers" },
    { text: "💾 مدیریت بکاپ", data: Callbacks.adminBackupMenu },
    { text: "📢 قفل کانال", data: "adm:force_join" },
    { text: "⚙️ تنظیم گروه لاگ", data: Callbacks.adminSetLogGroup },
    { text: "📢 ارسال پیام همگانی", data: "adm:broadcast" },
    { text: "🏷 مدیریت کدهای تخفیف", data: "admin_discounts:hub" },
    { text: "👮‍♂️ مدیریت دسترسی ادمینها", data: "adm:rbac:manage" },
  ];

  appendTwoColumn(kb, actions);

  appendNavBar(kb, {
    text: "⬅️ بازگشت به منوی کاربر",
    data: Callbacks.mainMenu,
  });
  return kb;
}

export function convDiscountScopeKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🌐 همه محصولات", ConvCb.discountScopeAll)
    .text("🎯 انتخاب محصولات خاص", ConvCb.discountScopeSpecific)
    .row()
    .text("❌ لغو", ConvCb.cancel);
}

export function convDiscountProductsMultiSelectKeyboard(
  products: Array<{ id: number; name: string }>,
  selectedIds: Set<number>,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const p of products) {
    const isSelected = selectedIds.has(p.id);
    const box = isSelected ? "✅" : "⬜";
    const label = `${box} ${p.name}`;
    kb.text(
      label.length > 64 ? label.slice(0, 61) + "…" : label,
      ConvCb.discountToggleProduct(p.id),
    ).row();
  }
  kb.text("🟢 تایید و ثبت انتخابها", ConvCb.discountConfirmProducts).row();
  kb.text("🔴 بازگشت", ConvCb.cancel);
  return kb;
}

export function convDiscountTier1CategoriesKeyboard(
  categories: Array<{ id: number; name: string }>,
  selectedCount: number,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  const buttons = categories.map((c) => ({
    text: `📁 ${truncateLabel(c.name, 25)}`,
    data: `dsc:cat:${c.id}`,
  }));
  appendTwoColumn(kb, buttons);
  kb.row().text(`🟢 تایید و ثبت نهایی (${selectedCount} محصول)`, "dsc:done").row();
  kb.text("🔴 لغو", "dsc:cancel");
  return kb;
}

export function convDiscountTier2CategoryContentsKeyboard(
  subCategories: Array<{ id: number; name: string }>,
  standaloneProducts: Array<{ id: number; name: string }>,
  selectedIds: Set<number>,
  selectedCount: number,
): InlineKeyboard {
  const kb = new InlineKeyboard();

  if (subCategories.length > 0) {
    const subButtons = subCategories.map((s) => ({
      text: `📑 ${truncateLabel(s.name, 25)}`,
      data: `dsc:subcat:${s.id}`,
    }));
    appendTwoColumn(kb, subButtons);
  }

  if (standaloneProducts.length > 0) {
    const prodButtons = standaloneProducts.map((p) => {
      const box = selectedIds.has(p.id) ? "✅" : "⬜";
      return {
        text: `${box} ${truncateLabel(p.name, 24)}`,
        data: `dsc:tog:${p.id}`,
      };
    });
    appendTwoColumn(kb, prodButtons);
  }

  kb.row().text("🔙 بازگشت به دسته‌ها", "dsc:back_cats").row();
  kb.text(`🟢 تایید و ثبت نهایی (${selectedCount} محصول)`, "dsc:done");
  return kb;
}

export function convDiscountTier3PlansKeyboard(
  products: Array<{ id: number; name: string }>,
  selectedIds: Set<number>,
  selectedCount: number,
): InlineKeyboard {
  const kb = new InlineKeyboard();

  const prodButtons = products.map((p) => {
    const box = selectedIds.has(p.id) ? "✅" : "⬜";
    return {
      text: `${box} ${truncateLabel(p.name, 24)}`,
      data: `dsc:tog:${p.id}`,
    };
  });
  appendTwoColumn(kb, prodButtons);

  kb.row().text("🔙 بازگشت به سرویس‌ها", "dsc:back_subcats").row();
  kb.text(`🟢 تایید و ثبت نهایی (${selectedCount} محصول)`, "dsc:done");
  return kb;
}

export function adminDiscountHubKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  kb.text("➕ ثبت کد جدید", "admin_discounts:add")
    .text("🗑 حذف کدهای تخفیف", "admin_discounts:delete")
    .row()
    .text("🔄 به‌روزرسانی لیست", "admin_discounts:refresh")
    .row()
    .text("🔙 بازگشت به پنل ادمین", Callbacks.adminHome);
  return kb;
}

export function convDiscountBatchDeleteKeyboard(
  codes: Array<{
    id: number;
    code: string;
    percentage: number;
    usedCount: number;
    maxUses: number | null;
  }>,
  selectedIds: Set<number>,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const c of codes) {
    const box = selectedIds.has(c.id) ? "✅" : "⬜";
    const maxStr = c.maxUses != null ? c.maxUses : "∞";
    const label = `${box} ${c.code} — ${c.percentage}% (مصرف: ${c.usedCount}/${maxStr})`;
    kb.text(truncateLabel(label, 40), `dsc_del:tog:${c.id}`).row();
  }
  kb.text(`🗑 تایید و حذف نهایی (${selectedIds.size} کد)`, "dsc_del:confirm").row();
  kb.text("🔴 انصراف / بازگشت", "dsc_del:cancel");
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

export function adminCmsMenuKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  const pages = [
    { name: "خانه (Home)", key: "home" },
    { name: "فروشگاه (Shop)", key: "shop" },
    { name: "حساب کاربری (Account)", key: "account" },
    { name: "پشتیبانی (Support)", key: "support" },
    { name: "کیف پول (Wallet)", key: "wallet" },
  ];

  for (const p of pages) {
    kb.text(`📝 ${p.name}`, `adm:cms_panel:${p.key}`).row();
  }

  kb.text("📂 بنر و متن دسته‌ها", "cms:cats").row();
  kb.text("📁 بنر و متن زیردسته‌ها", "cms:subcats").row();

  kb.text("🔙 بازگشت", Callbacks.adminHome);
  return kb;
}

export const adminCmsKeyboard = adminCmsMenuKeyboard;

export function adminCmsPanelKeyboard(pageKey: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  kb.text("📝 ویرایش متن", Callbacks.cmsEditText(pageKey as any));
  if (pageKey === "shop") {
    kb.row()
      .text("📁 مدیریت دسته‌ها", Callbacks.cmsCats)
      .text("🛍 مدیریت محصولات", Callbacks.cmsProds);
  }
  kb.row()
    .text("🖼 تنظیم بنر", Callbacks.cmsSetMedia(pageKey as any))
    .text("🗑 حذف بنر", Callbacks.cmsDelMedia(pageKey as any))
    .row()
    .text("🎛 تغییر چیدمان (ستون)", Callbacks.cmsToggleLayout(pageKey as any))
    .row();

  kb.text("🔙 بازگشت به لیست صفحات", "adm:cms_menu");
  return kb;
}

export function adminForceJoinKeyboard(settings: {
  enabled: boolean;
  channelId: string | null;
  inviteLink: string | null;
}): InlineKeyboard {
  const kb = new InlineKeyboard();

  kb.text(
    settings.enabled ? "🟢 وضعیت: فعال (تغییر)" : "🔴 وضعیت: غیرفعال (تغییر)",
    "adm:fj:toggle"
  ).row();

  kb.text(`شناسه کانال: ${settings.channelId || "تنظیم نشده"}`, "adm:fj:set_id").row();
  kb.text(`لینک دعوت: ${settings.inviteLink ? "تنظیم شده" : "تنظیم نشده"}`, "adm:fj:set_link").row();
  kb.text("📝 ویرایش متن پیام", "adm:fj:set_text").row();
  kb.text("🧪 تست دسترسی ربات در کانال", "adm:fj:test").row();

  kb.text("🔙 بازگشت", Callbacks.adminHome);
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
  status: "OPEN" | "ANSWERED" | "CLOSED",
): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (status === "OPEN" || status === "ANSWERED") {
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
    .text("📑 مدیریت سرویس‌ها (زیردسته‌ها)", Callbacks.adminSubCategories)
    .row()
    .text("⭐ تنظیم نرخ واحد استارز", Callbacks.adminStarsRate)
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

export function adminSubCategoriesKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("➕ افزودن سرویس جدید", Callbacks.adminAddSubCategory)
    .text("✏️ ویرایش / حذف سرویس", Callbacks.adminEditSubCategoryMenu)
    .row()
    .text("🔙 بازگشت به کاتالوگ", Callbacks.adminCatalog);
}

export function convSubCategoryPickKeyboard(
  subCategories: Array<{ id: number; name: string }>,
  options?: {
    allowSkip?: boolean;
    allowAddNew?: boolean;
    cancelCb?: string;
  },
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const s of subCategories) {
    const label = `🔹 ${s.name}`;
    kb.text(label.length > 64 ? `${label.slice(0, 61)}…` : label, `conv:subcat:${s.id}`).row();
  }
  if (options?.allowAddNew) {
    kb.text("➕ افزودن سرویس جدید", "conv:subcat:add").row();
  }
  if (options?.allowSkip) {
    kb.text("⏩ بدون سرویس (مستقیم)", "conv:subcat:none").row();
  }
  kb.text("❌ لغو", options?.cancelCb ?? ConvCb.cancel);
  return kb;
}

export function convSubCategoryEditKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📝 ویرایش نام", ConvCb.editSubCategoryName)
    .text("🔖 ویرایش توضیحات", ConvCb.editSubCategoryDesc)
    .row()
    .text("🗑 حذف سرویس", ConvCb.deleteSubCategory)
    .row()
    .text("🔙 بازگشت", ConvCb.cancel);
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
        const label = `🔹 ${c.name}`;
        return {
          text: label.length > 64 ? `${label.slice(0, 61)}…` : label,
          data: Callbacks.adminDelCategory(c.id),
        };
      }),
  );
  kb.text("🔙 بازگشت", Callbacks.adminCatalog);
  return kb;
}

function truncateLabel(name: string, max = 30): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

export function convProductPickCategoryKeyboard(
  categories: Array<{ id: number; name: string }>,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  const buttons = categories.map((c) => ({
    text: `📁 ${truncateLabel(c.name, 25)}`,
    data: ConvCb.pickCat(c.id),
  }));
  appendTwoColumn(kb, buttons);
  appendNavBar(kb, { text: "🔴 بازگشت", data: ConvCb.cancel });
  return kb;
}

export function convProductPickCategoryContentsKeyboard(
  subCategories: Array<{ id: number; name: string }>,
  standaloneProducts: Array<{ id: number; name: string }>,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (subCategories.length > 0) {
    const subButtons = subCategories.map((s) => ({
      text: `📑 ${truncateLabel(s.name, 25)}`,
      data: ConvCb.pickSubCat(s.id),
    }));
    appendTwoColumn(kb, subButtons);
  }
  if (standaloneProducts.length > 0) {
    const prodButtons = standaloneProducts.map((p) => ({
      text: `🔹 ${truncateLabel(p.name, 25)}`,
      data: ConvCb.pickProd(p.id),
    }));
    appendTwoColumn(kb, prodButtons);
  }
  appendNavBar(kb, { text: "🔙 بازگشت به دسته‌بندی‌ها", data: ConvCb.pickBackCats });
  return kb;
}

export function convProductPickSubCategoryPlansKeyboard(
  products: Array<{ id: number; name: string }>,
  parentLabel?: string,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  const prodButtons = products.map((p) => ({
    text: `🔹 ${truncateLabel(p.name, 25)}`,
    data: ConvCb.pickProd(p.id),
  }));
  appendTwoColumn(kb, prodButtons);
  const backText = parentLabel ? `🔙 بازگشت به ${truncateLabel(parentLabel, 20)}` : "🔙 بازگشت";
  appendNavBar(kb, { text: backText, data: ConvCb.pickBackCat });
  return kb;
}

export const convProductPickKeyboard = convProductPickCategoryContentsKeyboard;

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
      const label = `🔹 ${name} · ${price}`;
      return {
        text: label.length > 64 ? `${label.slice(0, 61)}…` : label,
        data,
      };
    }),
  );
  kb.text("🔙 بازگشت", Callbacks.adminCatalog);
  return kb;
}

export function adminProductDetailKeyboard(
  product: Pick<Product, "id" | "deliveryType">,
): InlineKeyboard {
  const kb = new InlineKeyboard()
    // Row 1: Price and Name
    .text("💰 ویرایش قیمت", ConvCb.editProductPrice)
    .text("📝 ویرایش نام", ConvCb.editProductName)
    .row()
    // Row 2: Description and Banner
    .text("📝 ویرایش توضیحات (کپشن)", ConvCb.editProductDesc)
    .text("🖼 ویرایش بنر محصول", ConvCb.editProductBanner)
    .row()
    // Row 3: Delivery type switcher and SubCategory/Service
    .text("🔄 تغییر نوع تحویل", `adm:prod:toggle_delivery:${product.id}`)
    .text("📑 ویرایش سرویس / زیردسته", ConvCb.editProductSubCategory)
    .row()
    // Row 4: Stock alert and Duration
    .text("⚠️ تنظیم هشدار موجودی", ConvCb.editProductAlert)
    .text("🕒 تنظیم مدت اشتراک (روز)", ConvCb.editProductDuration)
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

export const convProductEditKeyboard = adminProductDetailKeyboard;

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

export function adminDeliveryTypeSwitchKeyboard(productId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("🤖 کوانتوم بات", `adm:prod:set_delivery:${productId}:SUPPLIER_AUTO`)
    .row()
    .text("✋ تحویل دستی", `adm:prod:set_delivery:${productId}:MANUAL`)
    .row()
    .text("⚙️ تحویل سفارشی", `adm:prod:set_delivery:${productId}:CREDENTIALS_REQUIRED`)
    .row()
    .text("🔙 بازگشت", `adm:prd:edit:${productId}`);
}

export function convDeliveryTypeEditKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🤖 کوانتوم بات", ConvCb.deliveryEdit("SUPPLIER_AUTO"))
    .row()
    .text("✋ تحویل دستی", ConvCb.deliveryEdit("MANUAL"))
    .row()
    .text("⚙️ تحویل سفارشی", ConvCb.deliveryEdit("CREDENTIALS_REQUIRED"))
    .row()
    .text("📦 موجودی آماده", ConvCb.deliveryEdit("READY"))
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



export function convPaymentTypeKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("💳 کارت به کارت", ConvCb.payType("CARD"))
    .text("🌐 درگاه آنلاین", ConvCb.payType("GATEWAY"))
    .row()
    .text("❌ لغو", ConvCb.cancel);
}

export function adminSuppliersKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  kb.text("➕ افزودن کلید تامین‌کننده (API Key)", "adm:sup:addkey").row();
  kb.text("🔄 تنظیم نگاشت محصولات (Mapping)", "adm:sup:map").row();
  kb.text("📥 محصولات جدید در انتظار", "adm:sup:pending").row();
  appendNavBar(kb, {
    text: "🔙 بازگشت به پنل",
    data: Callbacks.adminHome,
  });
  return kb;
}

