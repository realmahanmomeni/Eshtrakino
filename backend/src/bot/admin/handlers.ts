import { Composer, type Bot } from "grammy";
import { createConversation } from "@grammyjs/conversations";
import { DeliveryType, InvoiceStatus, TicketStatus } from "@prisma/client";
import type { BotContext } from "../context";
import { createInitialSession } from "../context";
import { adminOnlyMiddleware } from "./middleware";
import { hasAnyAdminAccess, hasPermission } from "./rbac";
import { rbacAdmin, rbacAddAdminConversation } from "./rbacHandlers";
import { broadcastConversation } from "./broadcastConversation";

import {
  adminBackupMenuKeyboard,
  adminCatalogKeyboard,
  adminSubCategoriesKeyboard,
  adminCmsMenuKeyboard,
  adminCmsPanelKeyboard,
  adminForceJoinKeyboard,
  adminDeleteCategoriesKeyboard,
  adminHomeKeyboard,
  adminHomeKeyboardAsync,
  adminPaymentListKeyboard,
  adminPaymentsKeyboard,
  adminProductPickKeyboard,
  adminReceiptCategoriesKeyboard,
  adminReceiptsBackKeyboard,
  adminStatsKeyboard,
  adminTicketActionsKeyboard,
  adminTicketListKeyboard,
  adminTicketsKeyboard,
  adminUserProfileKeyboard,
  adminUsersListKeyboard,
  adminDiscountHubKeyboard,
  adminProductDetailKeyboard,
  adminDeliveryTypeSwitchKeyboard,
  adminSuppliersKeyboard,
} from "./keyboards";
import { renderAdminProductCardText, getDeliveryModeCaption } from "./catalog";
import { exitAllConversations } from "../utils/conversations";
import { Callbacks } from "../keyboards/callbacks";
import { catalogService } from "../../services/catalog/CatalogService";
import { paymentMethodService } from "../../services/paymentMethods/PaymentMethodService";
import { crmService } from "../../services/crm/CrmService";
import { invoiceService, InvoiceInvalidStateError } from "../../services/invoices/InvoiceService";
import { ticketService } from "../../services/tickets/TicketService";
import { groupLogger } from "../../services/logger/GroupLogger";
import { backupService } from "../../services/backup/BackupService";
import { inventoryService } from "../../services/inventory/InventoryService";
import { fulfillmentService } from "../../services/fulfillment/FulfillmentService";
import { walletService } from "../../services/wallet/WalletService";
import { discountService } from "../../services/discount/DiscountService";
import {
  adminUserService,
  parseUserAnalyticsFilter,
  type UserAnalyticsFilter,
} from "../../services/adminUsers/AdminUserService";
import {
  settingsService,
  FORCE_JOIN_ENABLED,
  FORCE_JOIN_CHANNEL_ID,
  FORCE_JOIN_INVITE_LINK,
  SWAPPAY_ENABLED,
} from "../../services/settings/SettingsService";
import { formatToman } from "../../lib/money";
import { deliveryTypeLabel } from "../keyboards/grid";
import { BannerAssets } from "../assets/banners";
import {
  editProductConversation,
  editSubCategoryConversation,
  restockProductConversation,
  setCredentialReqConversation,
  setProductStockAlertConversation,
  setProductDurationConversation,
  setStarsRateConversation,
} from "./catalog";
import {
  addCategoryConversation,
  addSubCategoryConversation,
  addPaymentMethodConversation,
  addProductConversation,
  adminReplyTicketConversation,
  configurePaymentConversation,
  rejectInvoiceConversation,
  setAutoBackupConversation,
  setLogGroupConversation,
  setSwapApiKeyConversation,
  setSwapWalletAddressConversation,
  fjSetChannelId,
  fjSetLink,
  fjSetText,
  addDiscountConversation,
  deleteDiscountCodesConversation,
  formatDiscountHubText,
  editCategoryCmsConversation,
  editSubCategoryCmsConversation,
} from "./conversations";
import {
  editAdminUserBalanceConversation,
  messageAdminUserConversation,
  adminSearchUserConversation,
} from "./users";
import { editPageTextConversation } from "../cms/editPageTextConversation";
import { adminCmsMediaConversation } from "../cms/adminCmsMediaConversation";
import { presentCmsPage } from "../cms/presentPage";
import { addSupplierApiKeyConversation, mapSupplierProductConversation } from "./supplierConversation";
import {
  presentCmsCategoryList,
  presentCmsCategoryView,
  presentCmsSubCategoryList,
  presentCmsSubCategoryView,
  presentCmsProductCategoryPick,
  presentCmsProductList,
  presentCmsProductView,
  cmsAddCategoryConversation,
  cmsAddProductConversation,
  cmsEditProductPriceConversation,
  cmsRenameCategoryConversation,
  cmsRenameProductConversation,
} from "../cms/shopCms";
import { isPageKey, pageContentService } from "../../services/cms/PageContentService";
import { safeEdit, safeEditMedia } from "../utils/safeEdit";
import { panelFromCtx } from "../conversations/wait";
import { canbosoDispatchService } from "../../services/suppliers/CanbosoDispatchService";
import {
  presentSupplierMarginPricePanel,
  setProductProfitMarginConversation,
} from "./supplierPriceAdmin";
import { isSupplierMarginAdminProduct } from "../../services/catalog/profitMarginService";
import { registerSupplierPendingImportAdmin } from "./supplierPendingAdmin";

const RECEIPT_STATUS_LABELS: Record<string, string> = {
  AWAITING_APPROVAL: "در انتظار تایید",
  PAID: "تایید شده",
  CANCELLED: "رد شده",
};

function formatReceiptDate(date: Date): string {
  return date.toLocaleString("fa-IR", { timeZone: "Asia/Tehran" });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Midnight today in Asia/Tehran as a UTC Date. */
function startOfDayInTehran(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "01";
  const y = get("year");
  const m = get("month");
  const d = get("day");
  return new Date(`${y}-${m}-${d}T00:00:00+03:30`);
}

function parseReceiptListStatus(raw: string): InvoiceStatus | null {
  if (raw === "AWAITING_APPROVAL") return InvoiceStatus.AWAITING_APPROVAL;
  if (raw === "PAID") return InvoiceStatus.PAID;
  if (raw === "CANCELLED") return InvoiceStatus.CANCELLED;
  return null;
}

async function adminTicketsMenuKeyboard(): Promise<ReturnType<typeof adminTicketsKeyboard>> {
  const counts = await ticketService.getTicketCounts();
  return adminTicketsKeyboard(counts.open, counts.closed);
}

export function registerAdmin(bot: Bot<BotContext>): void {
  bot.use(createConversation(addCategoryConversation, "addCategory"));
  bot.use(createConversation(addSubCategoryConversation, "addSubCategory"));
  bot.use(createConversation(editSubCategoryConversation, "editSubCategory"));
  bot.use(createConversation(addProductConversation, "addProduct"));
  bot.use(createConversation(editProductConversation, "editProduct"));
  bot.use(createConversation(setProductProfitMarginConversation, "setProductProfitMargin"));
  bot.use(createConversation(restockProductConversation, "restockProduct"));
  bot.use(createConversation(setProductStockAlertConversation, "setProductStockAlert"));
  bot.use(createConversation(setProductDurationConversation, "setProductDuration"));
  bot.use(createConversation(setCredentialReqConversation, "setCredentialReq"));
  bot.use(createConversation(setStarsRateConversation, "setStarsRateConversation"));
  bot.use(createConversation(addPaymentMethodConversation, "addPaymentMethod"));
  bot.use(createConversation(configurePaymentConversation, "configurePayment"));
  bot.use(createConversation(rejectInvoiceConversation, "rejectInvoice"));
  bot.use(createConversation(adminReplyTicketConversation, "adminReplyTicket"));
  bot.use(createConversation(setLogGroupConversation, "setLogGroup"));
  bot.use(createConversation(setAutoBackupConversation, "setAutoBackup"));
  bot.use(createConversation(setSwapApiKeyConversation, "setSwapApiKey"));
  bot.use(createConversation(setSwapWalletAddressConversation, "setSwapWalletAddress"));
  bot.use(createConversation(messageAdminUserConversation, "messageAdminUser"));
  bot.use(createConversation(editAdminUserBalanceConversation, "editAdminUserBalance"));
  bot.use(createConversation(adminSearchUserConversation, "adminSearchUser"));
  bot.use(createConversation(editPageTextConversation, "editPageText"));
  bot.use(createConversation(adminCmsMediaConversation, "adminCmsMedia"));
  bot.use(createConversation(cmsAddCategoryConversation, "cmsAddCategory"));
  bot.use(createConversation(cmsRenameCategoryConversation, "cmsRenameCategory"));
  bot.use(createConversation(cmsAddProductConversation, "cmsAddProduct"));
  bot.use(createConversation(cmsRenameProductConversation, "cmsRenameProduct"));
  bot.use(createConversation(cmsEditProductPriceConversation, "cmsEditProductPrice"));
  bot.use(createConversation(fjSetChannelId, "fjSetChannelId"));
  bot.use(createConversation(fjSetLink, "fjSetLink"));
  bot.use(createConversation(fjSetText, "fjSetText"));
  bot.use(createConversation(rbacAddAdminConversation, "rbacAddAdminConversation"));
  bot.use(createConversation(broadcastConversation, "broadcastConversation"));
  bot.use(createConversation(addDiscountConversation, "addDiscountConversation"));
  bot.use(createConversation(deleteDiscountCodesConversation, "deleteDiscountCodesConversation"));
  bot.use(createConversation(editCategoryCmsConversation, "editCategoryCms"));
  bot.use(createConversation(editCategoryCmsConversation, "editCategoryCmsConversation"));
  bot.use(createConversation(editSubCategoryCmsConversation, "editSubCategoryCms"));
  bot.use(createConversation(editSubCategoryCmsConversation, "editSubCategoryCmsConversation"));
  bot.use(createConversation(addSupplierApiKeyConversation, "addSupplierApiKeyConversation"));
  bot.use(createConversation(mapSupplierProductConversation, "mapSupplierProductConversation"));
  
  bot.use(rbacAdmin);

  bot.command("admin", async (ctx) => {
    if (!ctx.from || !(await hasAnyAdminAccess(ctx.from.id))) {
      await ctx.reply(
        ["⛔️ *دسترسی محدود*", "", "دسترسی ادمین ندارید."].join("\n"),
        { parse_mode: "Markdown" },
      );
      return;
    }
    await ctx.reply(
      [
        "🛠 *پنل مدیریت اشتراکینو*",
        "",
        "از منوی زیر بخش مورد نظر را انتخاب کنید:",
      ].join("\n"),
      { parse_mode: "Markdown", reply_markup: await adminHomeKeyboardAsync() },
    );
  });

  bot.command("setup_topics", adminOnlyMiddleware, async (ctx) => {
    try {
      await groupLogger.initializeAllTopics(ctx.api);
      await ctx.reply(
        "✅ ساختار گروه بررسی شد و تمام تاپیک‌های مورد نیاز با موفقیت ایجاد شدند.",
        { parse_mode: "Markdown" },
      );
    } catch (err) {
      console.error("setup_topics failed:", err);
      const detail = err instanceof Error ? err.message : "خطای ناشناخته";
      await ctx.reply(
        ["❌ *خطا در ایجاد تاپیک‌ها*", "", detail].join("\n"),
        { parse_mode: "Markdown" },
      );
    }
  });

  const adminBase = new Composer<BotContext>();
  const admin = adminBase.filter((ctx) => {
    const data = ctx.callbackQuery?.data;
    return typeof data === "string" && data.startsWith("adm:");
  });
  admin.use(adminOnlyMiddleware);

  bot.callbackQuery(Callbacks.adminReceipts, async (ctx) => {
    if (!ctx.from || !(await hasPermission(ctx.from.id, "FINANCE"))) {
      await ctx.answerCallbackQuery({ text: "⛔ دسترسی غیرمجاز", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    const counts = await invoiceService.getReceiptHubCounts();
    await safeEdit(
      ctx,
      [
        "🧾 *مدیریت رسیدها*",
        "",
        "فاکتورها را بر اساس وضعیت بررسی کنید:",
        "",
        `⏳ در انتظار تایید: *${counts.pending}*`,
        `✅ تایید شده: *${counts.approved}*`,
        `❌ رد شده: *${counts.rejected}*`,
        "",
        "👇 یک دسته را انتخاب کنید:",
      ].join("\n"),
      adminReceiptCategoriesKeyboard(counts),
    );
  });

  admin.callbackQuery(Callbacks.adminHome, async (ctx) => {
    await ctx.answerCallbackQuery();
    await safeEdit(
      ctx,
      [
        "🛠 *پنل مدیریت اشتراکینو*",
        "",
        "از منوی زیر بخش مورد نظر را انتخاب کنید:",
      ].join("\n"),
      await adminHomeKeyboardAsync(),
    );
  });

  bot.callbackQuery(
    ["admin_discounts:hub", "admin_discounts:refresh", Callbacks.adminDiscountsHub, Callbacks.adminDiscountsRefresh],
    async (ctx) => {
      if (!ctx.from || !(await hasAnyAdminAccess(ctx.from.id))) {
        await ctx.answerCallbackQuery({ text: "⛔ دسترسی غیرمجاز", show_alert: true });
        return;
      }
      await ctx.answerCallbackQuery();
      const codes = await discountService.listAllDiscountCodes();
      await safeEdit(
        ctx,
        formatDiscountHubText(codes),
        adminDiscountHubKeyboard(),
      );
    },
  );

  bot.callbackQuery(
    ["admin_discounts:add", Callbacks.adminAddDiscount, Callbacks.adminDiscountsAdd],
    async (ctx) => {
      if (!ctx.from || !(await hasAnyAdminAccess(ctx.from.id))) {
        await ctx.answerCallbackQuery({ text: "⛔ دسترسی غیرمجاز", show_alert: true });
        return;
      }
      await ctx.answerCallbackQuery();
      try {
        await ctx.conversation.exitAll();
      } catch {}
      await ctx.conversation.enter("addDiscountConversation");
    },
  );

  bot.callbackQuery(
    ["admin_discounts:delete", Callbacks.adminDiscountsDelete],
    async (ctx) => {
      if (!ctx.from || !(await hasAnyAdminAccess(ctx.from.id))) {
        await ctx.answerCallbackQuery({ text: "⛔ دسترسی غیرمجاز", show_alert: true });
        return;
      }
      await ctx.answerCallbackQuery();
      try {
        await ctx.conversation.exitAll();
      } catch {}
      await ctx.conversation.enter("deleteDiscountCodesConversation");
    },
  );

  bot.callbackQuery("admin:home", async (ctx) => {
    if (!ctx.from || !(await hasAnyAdminAccess(ctx.from.id))) {
      await ctx.answerCallbackQuery({ text: "⛔ دسترسی غیرمجاز", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    await safeEdit(
      ctx,
      [
        "🛠 *پنل مدیریت اشتراکینو*",
        "",
        "از منوی زیر بخش مورد نظر را انتخاب کنید:",
      ].join("\n"),
      adminHomeKeyboard(),
    );
  });

  bot.callbackQuery("adm:force_join", async (ctx) => {
    if (!ctx.from || !(await hasPermission(ctx.from.id, "CMS"))) {
      await ctx.answerCallbackQuery({ text: "⛔ دسترسی غیرمجاز", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    const enabled = await settingsService.getBoolSetting(FORCE_JOIN_ENABLED, false);
    const channelId = await settingsService.getSetting(FORCE_JOIN_CHANNEL_ID);
    const inviteLink = await settingsService.getSetting(FORCE_JOIN_INVITE_LINK);

    await safeEdit(
      ctx,
      "📢 *قفل کانال (جوین اجباری)*\n\nتنظیمات مورد نظر را انتخاب کنید:",
      adminForceJoinKeyboard({ enabled, channelId, inviteLink }),
    );
  });

  bot.callbackQuery("adm:broadcast", async (ctx) => {
    if (!ctx.from || !(await hasPermission(ctx.from.id, "USERS"))) {
      await ctx.answerCallbackQuery({ text: "⛔ دسترسی غیرمجاز", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    try { await ctx.conversation.exitAll(); } catch { /* ignore */ }
    await ctx.conversation.enter("broadcastConversation");
  });

  bot.callbackQuery("adm:suppliers", async (ctx) => {
    if (!ctx.from || !(await hasAnyAdminAccess(ctx.from.id))) {
      await ctx.answerCallbackQuery({ text: "⛔ دسترسی غیرمجاز", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    await safeEdit(
      ctx,
      "🔗 *مدیریت تامین‌کنندگان*\n\nیکی از گزینه‌های زیر را انتخاب کنید:",
      adminSuppliersKeyboard(),
    );
  });

  bot.callbackQuery("adm:sup:addkey", async (ctx) => {
    if (!ctx.from || !(await hasAnyAdminAccess(ctx.from.id))) {
      await ctx.answerCallbackQuery({ text: "⛔ دسترسی غیرمجاز", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    try { await ctx.conversation.exitAll(); } catch {}
    await ctx.conversation.enter("addSupplierApiKeyConversation");
  });

  bot.callbackQuery("adm:sup:map", async (ctx) => {
    if (!ctx.from || !(await hasAnyAdminAccess(ctx.from.id))) {
      await ctx.answerCallbackQuery({ text: "⛔ دسترسی غیرمجاز", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    try { await ctx.conversation.exitAll(); } catch {}
    await ctx.conversation.enter("mapSupplierProductConversation");
  });

  bot.callbackQuery(/^adm:tkt:reply:(\d+)$/, async (ctx) => {
    if (!ctx.from || !(await hasPermission(ctx.from.id, "SUPPORT"))) {
      await ctx.answerCallbackQuery({ text: "⛔ دسترسی غیرمجاز", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    ctx.session.adminTargetId = Number(ctx.match![1]);
    try { await ctx.conversation.exitAll(); } catch { /* ignore */ }
    await ctx.conversation.enter("adminReplyTicket");
  });

  bot.callbackQuery(/^adm:ticket:close:(\d+)$/, async (ctx) => {
    if (!ctx.from || !(await hasPermission(ctx.from.id, "SUPPORT"))) {
      await ctx.answerCallbackQuery({ text: "⛔ دسترسی غیرمجاز", show_alert: true });
      return;
    }
    const ticketId = Number(ctx.match![1]);
    const ticket = await ticketService.closeTicket(ticketId);
    await ctx.answerCallbackQuery({ text: "تیکت بسته شد" });
    try {
      await safeEdit(ctx, `🔒 تیکت #${ticketId} توسط پشتیبانی بسته شد.`, { reply_markup: { inline_keyboard: [] } });
    } catch {}
    try {
      await ctx.api.sendMessage(
        ticket.user.telegramId.toString(),
        `🔒 پشتیبانی تیکت شما به شماره #${ticketId} را بست.`
      );
    } catch {}
  });

  admin.callbackQuery("adm:fj:toggle", async (ctx) => {
    const current = await settingsService.getBoolSetting(FORCE_JOIN_ENABLED, false);
    await settingsService.setBoolSetting(FORCE_JOIN_ENABLED, !current);
    await ctx.answerCallbackQuery({ text: !current ? "فعال شد" : "غیرفعال شد" });
    
    const channelId = await settingsService.getSetting(FORCE_JOIN_CHANNEL_ID);
    const inviteLink = await settingsService.getSetting(FORCE_JOIN_INVITE_LINK);
    await safeEdit(
      ctx,
      "📢 *قفل کانال (جوین اجباری)*\n\nتنظیمات مورد نظر را انتخاب کنید:",
      adminForceJoinKeyboard({ enabled: !current, channelId, inviteLink }),
    );
  });

  admin.callbackQuery("adm:fj:set_id", async (ctx) => {
    await ctx.answerCallbackQuery();
    try { await ctx.conversation.exitAll(); } catch { /* ignore */ }
    await ctx.conversation.enter("fjSetChannelId");
  });

  admin.callbackQuery("adm:fj:set_link", async (ctx) => {
    await ctx.answerCallbackQuery();
    try { await ctx.conversation.exitAll(); } catch { /* ignore */ }
    await ctx.conversation.enter("fjSetLink");
  });

  admin.callbackQuery("adm:fj:set_text", async (ctx) => {
    await ctx.answerCallbackQuery();
    try { await ctx.conversation.exitAll(); } catch { /* ignore */ }
    await ctx.conversation.enter("fjSetText");
  });

  admin.callbackQuery("adm:fj:test", async (ctx) => {
    const channelId = await settingsService.getSetting(FORCE_JOIN_CHANNEL_ID);
    if (!channelId) {
      await ctx.answerCallbackQuery({ text: "ابتدا شناسه کانال را تنظیم کنید", show_alert: true });
      return;
    }
    try {
      const member = await ctx.api.getChatMember(channelId, ctx.me.id);
      if (["creator", "administrator"].includes(member.status)) {
        await ctx.answerCallbackQuery({ text: "✅ ربات در کانال ادمین است", show_alert: true });
      } else {
        await ctx.answerCallbackQuery({ text: "⚠️ ربات در کانال عضو است اما ادمین نیست!", show_alert: true });
      }
    } catch (err) {
      await ctx.answerCallbackQuery({ text: `❌ خطا در بررسی کانال: ${err}`, show_alert: true });
    }
  });

  bot.callbackQuery("adm:cms_menu", async (ctx) => {
    if (!ctx.from || !(await hasPermission(ctx.from.id, "CMS"))) {
      await ctx.answerCallbackQuery({ text: "⛔ دسترسی غیرمجاز", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    await safeEdit(
      ctx,
      "🖼️ *مدیریت صفحات (CMS)*\n\nبخش مورد نظر را انتخاب کنید:",
      adminCmsMenuKeyboard(),
    );
  });

  admin.callbackQuery(/^adm:cms_panel:(home|shop|account|support|wallet)$/, async (ctx) => {
    const pageKey = ctx.match![1] as string;
    await ctx.answerCallbackQuery();
    await safeEdit(
      ctx,
      `⚙️ *مدیریت صفحه: ${pageKey}*\n\nتنظیمات مورد نظر را انتخاب کنید:`,
      adminCmsPanelKeyboard(pageKey),
    );
  });

  admin.callbackQuery(/^adm:cms:edit:(home|shop|account|support|wallet)$/, async (ctx) => {
    const pageKey = ctx.match![1];
    if (!isPageKey(pageKey)) {
      await ctx.answerCallbackQuery({ text: "صفحه نامعتبر", show_alert: true });
      return;
    }
    ctx.session.adminCmsPageKey = pageKey;
    await ctx.answerCallbackQuery();
    try {
      await ctx.conversation.exitAll();
    } catch {
      /* ignore */
    }
    await ctx.conversation.enter("editPageText");
  });

  admin.callbackQuery(/^adm:cms:media:(home|shop|account|support|wallet)$/, async (ctx) => {
    const pageKey = ctx.match![1];
    if (!isPageKey(pageKey)) {
      await ctx.answerCallbackQuery({ text: "صفحه نامعتبر", show_alert: true });
      return;
    }
    ctx.session.adminCmsPageKey = pageKey;
    await ctx.answerCallbackQuery();
    try {
      await ctx.conversation.exitAll();
    } catch {
      /* ignore */
    }
    await ctx.conversation.enter("adminCmsMedia");
  });

  admin.callbackQuery(/^adm:cms:delmedia:(home|shop|account|support|wallet)$/, async (ctx) => {
    const pageKey = ctx.match![1];
    if (!isPageKey(pageKey)) {
      await ctx.answerCallbackQuery({ text: "صفحه نامعتبر", show_alert: true });
      return;
    }
    await pageContentService.clearMedia(pageKey);
    await ctx.answerCallbackQuery({ text: "بنر حذف شد" });
    await presentCmsPage(ctx, pageKey, "edit", "🗑 بنر صفحه حذف شد.");
  });

  admin.callbackQuery(/^adm:cms:layout:(home|shop|account|support|wallet)$/, async (ctx) => {
    const pageKey = ctx.match![1];
    if (!isPageKey(pageKey)) {
      await ctx.answerCallbackQuery({ text: "صفحه نامعتبر", show_alert: true });
      return;
    }
    const next = await pageContentService.toggleLayout(pageKey);
    await ctx.answerCallbackQuery({
      text: next === 1 ? "چیدمان: ۱ ستونه" : "چیدمان: ۲ ستونه",
    });
    await presentCmsPage(
      ctx,
      pageKey,
      "edit",
      next === 1 ? "🎛 چیدمان روی *۱ ستون* تنظیم شد." : "🎛 چیدمان روی *۲ ستون* تنظیم شد.",
    );
  });

  // —— CMS Shop: Categories ——
  admin.callbackQuery(/^(?:cms:cats|adm:cms:cats)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      await ctx.conversation.exitAll();
    } catch {
      /* ignore */
    }
    await presentCmsCategoryList(ctx, panelFromCtx(ctx));
  });

  admin.callbackQuery(Callbacks.cmsCatAdd, async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      await ctx.conversation.exitAll();
    } catch {
      /* ignore */
    }
    await ctx.conversation.enter("cmsAddCategory");
  });

  admin.callbackQuery(/^adm:cms:cat:v:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match![1]);
    await ctx.answerCallbackQuery();
    await presentCmsCategoryView(ctx, id, panelFromCtx(ctx));
  });

  admin.callbackQuery(/^adm:cms:cat:media:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match![1]);
    ctx.session.adminCmsCategoryId = id;
    ctx.session.adminCmsAction = "banner";
    await ctx.answerCallbackQuery();
    try {
      await ctx.conversation.exitAll();
    } catch {}
    await ctx.conversation.enter("editCategoryCms");
  });

  admin.callbackQuery(/^adm:cms:cat:desc:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match![1]);
    ctx.session.adminCmsCategoryId = id;
    ctx.session.adminCmsAction = "desc";
    await ctx.answerCallbackQuery();
    try {
      await ctx.conversation.exitAll();
    } catch {}
    await ctx.conversation.enter("editCategoryCms");
  });

  admin.callbackQuery(/^adm:cms:cat:delmedia:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match![1]);
    try {
      await catalogService.updateCategoryBanner(id, null);
      await ctx.answerCallbackQuery({ text: "بنر دسته حذف شد" });
      await presentCmsCategoryView(ctx, id, panelFromCtx(ctx), "🗑 بنر اختصاصی دسته حذف شد و به حالت پیش‌فرض بازگشت.");
    } catch (err) {
      console.error("delmedia category error:", err);
      await ctx.answerCallbackQuery({ text: "خطا در حذف بنر", show_alert: true });
    }
  });

  admin.callbackQuery(/^adm:cms:cat:rn:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match![1]);
    ctx.session.adminCmsCategoryId = id;
    await ctx.answerCallbackQuery();
    try {
      await ctx.conversation.exitAll();
    } catch {
      /* ignore */
    }
    await ctx.conversation.enter("cmsRenameCategory");
  });

  admin.callbackQuery(/^adm:cms:cat:del:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match![1]);
    try {
      const cat = await catalogService.deleteCategory(id);
      await ctx.answerCallbackQuery({ text: `دسته «${cat.name}» حذف شد` });
      await presentCmsCategoryList(ctx, panelFromCtx(ctx), `🗑 دسته «${cat.name}» حذف شد.`);
    } catch (err) {
      console.error("cms cat delete error:", err);
      await ctx.answerCallbackQuery({ text: "خطا در حذف دسته", show_alert: true });
    }
  });

  // —— CMS Shop: SubCategories ——
  admin.callbackQuery(/^(?:cms:subcats|adm:cms:subcats)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      await ctx.conversation.exitAll();
    } catch {}
    await presentCmsSubCategoryList(ctx, panelFromCtx(ctx));
  });

  admin.callbackQuery(/^adm:cms:subcat:v:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match![1]);
    await ctx.answerCallbackQuery();
    await presentCmsSubCategoryView(ctx, id, panelFromCtx(ctx));
  });

  admin.callbackQuery(/^adm:cms:subcat:media:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match![1]);
    ctx.session.adminCmsSubCategoryId = id;
    ctx.session.adminCmsAction = "banner";
    await ctx.answerCallbackQuery();
    try {
      await ctx.conversation.exitAll();
    } catch {}
    await ctx.conversation.enter("editSubCategoryCms");
  });

  admin.callbackQuery(/^adm:cms:subcat:desc:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match![1]);
    ctx.session.adminCmsSubCategoryId = id;
    ctx.session.adminCmsAction = "desc";
    await ctx.answerCallbackQuery();
    try {
      await ctx.conversation.exitAll();
    } catch {}
    await ctx.conversation.enter("editSubCategoryCms");
  });

  admin.callbackQuery(/^adm:cms:subcat:delmedia:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match![1]);
    try {
      await catalogService.updateSubCategoryBanner(id, null);
      await ctx.answerCallbackQuery({ text: "بنر زیردسته حذف شد" });
      await presentCmsSubCategoryView(ctx, id, panelFromCtx(ctx), "🗑 بنر اختصاصی زیردسته حذف شد و به حالت ارث‌بری/پیش‌فرض بازگشت.");
    } catch (err) {
      console.error("delmedia subcategory error:", err);
      await ctx.answerCallbackQuery({ text: "خطا در حذف بنر", show_alert: true });
    }
  });

  // —— CMS Shop: Products ——
  admin.callbackQuery(Callbacks.cmsProds, async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      await ctx.conversation.exitAll();
    } catch {
      /* ignore */
    }
    await presentCmsProductCategoryPick(ctx, panelFromCtx(ctx));
  });

  admin.callbackQuery(/^adm:cms:prod:list:(\d+)$/, async (ctx) => {
    const catId = Number(ctx.match![1]);
    await ctx.answerCallbackQuery();
    await presentCmsProductList(ctx, catId, panelFromCtx(ctx));
  });

  admin.callbackQuery(/^adm:cms:prod:add:(\d+)$/, async (ctx) => {
    const catId = Number(ctx.match![1]);
    ctx.session.adminCmsCategoryId = catId;
    await ctx.answerCallbackQuery();
    try {
      await ctx.conversation.exitAll();
    } catch {
      /* ignore */
    }
    await ctx.conversation.enter("cmsAddProduct");
  });

  admin.callbackQuery(/^adm:cms:prod:v:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match![1]);
    await ctx.answerCallbackQuery();
    await presentCmsProductView(ctx, id, panelFromCtx(ctx));
  });

  admin.callbackQuery(/^adm:cms:prod:rn:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match![1]);
    ctx.session.adminCmsProductId = id;
    await ctx.answerCallbackQuery();
    try {
      await ctx.conversation.exitAll();
    } catch {
      /* ignore */
    }
    await ctx.conversation.enter("cmsRenameProduct");
  });

  admin.callbackQuery(/^adm:cms:prod:pr:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match![1]);
    ctx.session.adminCmsProductId = id;
    await ctx.answerCallbackQuery();
    try {
      await ctx.conversation.exitAll();
    } catch {
      /* ignore */
    }
    await ctx.conversation.enter("cmsEditProductPrice");
  });

  admin.callbackQuery(/^adm:cms:prod:del:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match![1]);
    try {
      const product = await catalogService.deleteProduct(id);
      await ctx.answerCallbackQuery({ text: `محصول «${product.name}» حذف شد` });
      await presentCmsProductList(
        ctx,
        product.categoryId,
        panelFromCtx(ctx),
        `🗑 محصول «${product.name}» حذف شد.`,
      );
    } catch (err) {
      console.error("cms prod delete error:", err);
      await ctx.answerCallbackQuery({ text: "خطا در حذف محصول", show_alert: true });
    }
  });

  bot.callbackQuery(Callbacks.adminCatalog, async (ctx) => {
    if (!ctx.from || !(await hasPermission(ctx.from.id, "CATALOG"))) {
      await ctx.answerCallbackQuery({ text: "⛔ دسترسی غیرمجاز", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    await safeEdit(
      ctx,
      [
        "📦 *مدیریت کاتالوگ*",
        "",
        "دسته ها و محصولات را از دیتابیس مدیریت کنید:",
      ].join("\n"),
      adminCatalogKeyboard(),
    );
  });

  bot.callbackQuery(Callbacks.adminSubCategories, async (ctx) => {
    if (!ctx.from || !(await hasPermission(ctx.from.id, "CATALOG"))) {
      await ctx.answerCallbackQuery({ text: "⛔ دسترسی غیرمجاز", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    await safeEdit(
      ctx,
      [
        "📑 *مدیریت سرویس‌ها (زیردسته‌ها)*",
        "",
        "از این بخش می‌توانید سرویس‌های زیرمجموعه دسته‌ها (مانند Gemini Pro زیرمجموعه هوش مصنوعی) را ایجاد و مدیریت کنید:",
      ].join("\n"),
      adminSubCategoriesKeyboard(),
    );
  });

  admin.callbackQuery(Callbacks.adminStarsRate, async (ctx) => {
    if (!ctx.from || !(await hasPermission(ctx.from.id, "CATALOG"))) {
      await ctx.answerCallbackQuery({ text: "⛔ دسترسی غیرمجاز", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    try {
      await ctx.conversation.exitAll();
    } catch {}
    await ctx.conversation.enter("setStarsRateConversation");
  });

  admin.callbackQuery(Callbacks.adminAddSubCategory, async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      await ctx.conversation.exitAll();
    } catch {}
    await ctx.conversation.enter("addSubCategory");
  });

  admin.callbackQuery(Callbacks.adminEditSubCategoryMenu, async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      await ctx.conversation.exitAll();
    } catch {}
    await ctx.conversation.enter("editSubCategory");
  });

  admin.callbackQuery(Callbacks.adminUsers, async (ctx) => {
    await ctx.answerCallbackQuery();
    const filter = parseUserAnalyticsFilter(ctx.session.adminUsersListFilter);
    const page = Math.max(0, ctx.session.adminUsersListPage ?? 0);
    const pageData = await adminUserService.listUsersPage(filter, page);
    ctx.session.adminUsersListFilter = pageData.filter;
    ctx.session.adminUsersListPage = pageData.page;
    await safeEdit(
      ctx,
      adminUserService.formatListMessage(pageData),
      adminUsersListKeyboard(pageData),
    );
  });

  admin.callbackQuery(/^adm:users:list:(all|active|ghost|buyers):(\d+)$/, async (ctx) => {
    const filter = ctx.match![1] as UserAnalyticsFilter;
    const page = Number(ctx.match![2]);
    await ctx.answerCallbackQuery();
    try {
      await ctx.conversation.exitAll();
    } catch {
      /* ignore */
    }
    const pageData = await adminUserService.listUsersPage(filter, page);
    ctx.session.adminUsersListFilter = pageData.filter;
    ctx.session.adminUsersListPage = pageData.page;
    await safeEdit(
      ctx,
      adminUserService.formatListMessage(pageData),
      adminUsersListKeyboard(pageData),
    );
  });

  admin.callbackQuery(Callbacks.adminUsersSearchInit, async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      await ctx.conversation.exitAll();
    } catch {
      /* ignore */
    }
    await ctx.conversation.enter("adminSearchUser");
  });

  admin.callbackQuery(/^adm:users:v:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match![1]);
    await ctx.answerCallbackQuery();
    const listFilter = parseUserAnalyticsFilter(ctx.session.adminUsersListFilter);
    const listPage = Math.max(0, ctx.session.adminUsersListPage ?? 0);

    const profile = await adminUserService.getProfileById(id);
    if (!profile) {
      const pageData = await adminUserService.listUsersPage(listFilter, listPage);
      await safeEdit(
        ctx,
        ["⚠️ *کاربر یافت نشد*", "", adminUserService.formatListMessage(pageData)].join("\n\n"),
        adminUsersListKeyboard(pageData),
      );
      return;
    }

    let display: { name?: string; username?: string } = {};
    try {
      const chat = await ctx.api.getChat(Number(profile.telegramId));
      if (chat.type === "private") {
        display = {
          name: [chat.first_name, chat.last_name].filter(Boolean).join(" ").trim() || undefined,
          username: chat.username,
        };
      }
    } catch {
      /* ignore */
    }

    await safeEdit(
      ctx,
      adminUserService.formatProfileCard(profile, display),
      adminUserProfileKeyboard(profile.id, listFilter, listPage),
    );
  });

  admin.callbackQuery(/^adm:users:msg:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match![1]);
    ctx.session.adminTargetId = id;
    ctx.session.adminTargetType = "user";
    await ctx.answerCallbackQuery();
    try {
      await ctx.conversation.exitAll();
    } catch {
      /* ignore */
    }
    await ctx.conversation.enter("messageAdminUser");
  });

  admin.callbackQuery(/^adm:users:bal:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match![1]);
    ctx.session.adminTargetId = id;
    ctx.session.adminTargetType = "user";
    await ctx.answerCallbackQuery();
    try {
      await ctx.conversation.exitAll();
    } catch {
      /* ignore */
    }
    await ctx.conversation.enter("editAdminUserBalance");
  });



  admin.callbackQuery(/^adm:receipts:list:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const statusKey = ctx.match![1]!;
    const status = parseReceiptListStatus(statusKey);

    if (!status) {
      await safeEdit(
        ctx,
        ["⚠️ *وضعیت نامعتبر*", "", "دسته رسید یافت نشد."].join("\n"),
        adminReceiptsBackKeyboard(),
      );
      return;
    }

    const invoices = await invoiceService.listByStatusRecent(status, 15);
    const title = RECEIPT_STATUS_LABELS[status] ?? status;

    if (invoices.length === 0) {
      await safeEditMedia(
        ctx,
        BannerAssets.welcome,
        [
          `🧾 *رسیدها — ${title}*`,
          "",
          "هیچ موردی یافت نشد.",
        ].join("\n"),
        adminReceiptsBackKeyboard(),
      );
      return;
    }

    const blocks = invoices.map((inv) =>
      [
        `🔹 فاکتور: *#${inv.id}*`,
        `👤 کاربر: \`${inv.user.telegramId.toString()}\``,
        `📦 مورد: *${invoiceService.invoiceLabel(inv)}*`,
        `💵 مبلغ: *${formatToman(inv.amount)}*`,
        `📅 تاریخ: ${formatReceiptDate(inv.createdAt)}`,
      ].join("\n"),
    );

    const text = [
      `🧾 *رسیدها — ${title}*`,
      "",
      `نمایش *${invoices.length}* مورد اخیر (مرتب بر اساس شناسه):`,
      "",
      blocks.join("\n\n"),
    ].join("\n");

    // Long lists may exceed photo caption limits — prefer text edit with media fallback path
    if (text.length > 1000) {
      await safeEdit(ctx, text, adminReceiptsBackKeyboard());
    } else {
      await safeEditMedia(ctx, BannerAssets.welcome, text, adminReceiptsBackKeyboard());
    }
  });

  bot.callbackQuery(Callbacks.adminPayments, async (ctx) => {
    if (!ctx.from || !(await hasPermission(ctx.from.id, "FINANCE"))) {
      await ctx.answerCallbackQuery({ text: "⛔ دسترسی غیرمجاز", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    await safeEdit(
      ctx,
      [
        "💳 *مدیریت پرداخت*",
        "",
        "روش های پرداخت پویا را اضافه یا تنظیم کنید:",
      ].join("\n"),
      adminPaymentsKeyboard(),
    );
  });

  bot.callbackQuery(/^adm:stats:(all|month|week|today)$/, async (ctx) => {
    if (!ctx.from || !(await hasPermission(ctx.from.id, "USERS"))) {
      await ctx.answerCallbackQuery({ text: "⛔ دسترسی غیرمجاز", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    const timeframe = (ctx.match![1] ?? "all").toLowerCase();

    let startDate: Date | undefined;
    let timeframeLabel = "کل زمان ها";

    if (timeframe === "today") {
      startDate = startOfDayInTehran();
      timeframeLabel = "امروز";
    } else if (timeframe === "week") {
      startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      timeframeLabel = "این هفته";
    } else {
      startDate = undefined;
      timeframeLabel = "کل زمان ها";
    }

    const active = timeframe === "today" || timeframe === "week" ? timeframe : "all";
    const stats = await crmService.getAdvancedStats(startDate);
    await safeEditMedia(
      ctx,
      BannerAssets.welcome,
      crmService.formatAdvancedStatsMessage(stats, timeframeLabel),
      adminStatsKeyboard(active),
    );
  });

  // ——— Tickets ———
  bot.callbackQuery(Callbacks.adminTickets, async (ctx) => {
    if (!ctx.from || !(await hasPermission(ctx.from.id, "SUPPORT"))) {
      await ctx.answerCallbackQuery({ text: "⛔ دسترسی غیرمجاز", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    await safeEdit(
      ctx,
      [
        "🎫 *مدیریت تیکت ها*",
        "",
        "تیکت های باز یا بسته شده را انتخاب کنید:",
      ].join("\n"),
      await adminTicketsMenuKeyboard(),
    );
  });

  admin.callbackQuery(Callbacks.adminTicketsOpen, async (ctx) => {
    await ctx.answerCallbackQuery();
    const tickets = await ticketService.listByStatus(TicketStatus.OPEN);
    if (tickets.length === 0) {
      await safeEdit(
        ctx,
        ["🟢 *تیکت های باز*", "", "تیکت بازی وجود ندارد."].join("\n"),
        await adminTicketsMenuKeyboard(),
      );
      return;
    }
    await safeEdit(
      ctx,
      [
        `🟢 *تیکت های باز* (${tickets.length})`,
        "",
        "یکی را برای مشاهده و پاسخ انتخاب کنید:",
      ].join("\n"),
      adminTicketListKeyboard(
        tickets.map((t) => ({
          id: t.id,
          userTelegramId: t.user.telegramId.toString(),
        })),
        "open",
      ),
    );
  });

  admin.callbackQuery(Callbacks.adminTicketsClosed, async (ctx) => {
    await ctx.answerCallbackQuery();
    const tickets = await ticketService.listByStatus(TicketStatus.CLOSED);
    if (tickets.length === 0) {
      await safeEdit(
        ctx,
        ["🔒 *تیکت های بسته شده*", "", "تیکت بسته شده ای وجود ندارد."].join("\n"),
        await adminTicketsMenuKeyboard(),
      );
      return;
    }
    await safeEdit(
      ctx,
      [
        `🔒 *تیکت های بسته شده* (${tickets.length})`,
        "",
        "برای مرور تاریخچه یکی را انتخاب کنید:",
      ].join("\n"),
      adminTicketListKeyboard(
        tickets.map((t) => ({
          id: t.id,
          userTelegramId: t.user.telegramId.toString(),
        })),
        "closed",
      ),
    );
  });

  admin.callbackQuery(/^adm:tkt:v:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match![1]);
    await ctx.answerCallbackQuery();
    const ticket = await ticketService.getByIdWithUser(id);
    if (!ticket) {
      await safeEdit(
        ctx,
        ["⚠️ *تیکت یافت نشد*", "", "این تیکت در سیستم وجود ندارد."].join("\n"),
        await adminTicketsMenuKeyboard(),
      );
      return;
    }

    const thread = ticketService.formatThread(ticket);
    const text = [
      `🎫 تیکت #${ticket.id}`,
      `📊 وضعیت: ${ticket.status}`,
      `👤 کاربر: ${ticket.user.telegramId.toString()}`,
      ticket.subject ? `موضوع: ${ticket.subject}` : null,
      "",
      "💬 آخرین پیام ها:",
      thread,
    ]
      .filter(Boolean)
      .join("\n");

    // Avoid Markdown — user messages may contain _ * `
    try {
      await ctx.editMessageText(text, {
        reply_markup: adminTicketActionsKeyboard(ticket.id, ticket.status),
      });
    } catch {
      await ctx.reply(text, {
        reply_markup: adminTicketActionsKeyboard(ticket.id, ticket.status),
      });
    }
  });

  admin.callbackQuery(/^adm:tkt:cl:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match![1]);
    try {
      const ticket = await ticketService.closeTicket(id);
      await ctx.answerCallbackQuery({ text: "تیکت بسته شد" });

      try {
        await ctx.api.sendMessage(
          ticket.user.telegramId.toString(),
          [
            "🔒 *تیکت بسته شد*",
            "",
            `🎫 تیکت: *#${ticket.id}*`,
            `📊 وضعیت: *CLOSED*`,
            "",
            "در صورت نیاز دوباره از منوی پشتیبانی پیام بفرستید.",
          ].join("\n"),
          { parse_mode: "Markdown" },
        );
      } catch (err) {
        console.error("Failed to notify user of ticket close:", err);
      }

      await safeEdit(
        ctx,
        [
          "🔒 *تیکت بسته شد*",
          "",
          `🎫 تیکت: *#${ticket.id}*`,
          `📊 وضعیت: *CLOSED*`,
        ].join("\n"),
        await adminTicketsMenuKeyboard(),
      );
    } catch (err) {
      console.error("close ticket error:", err);
      await ctx.answerCallbackQuery({ text: "خطا در بستن تیکت", show_alert: true });
    }
  });

  admin.callbackQuery(Callbacks.adminAddCategory, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("addCategory");
  });

  admin.callbackQuery(Callbacks.adminSetLogGroup, async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      await ctx.conversation.exitAll();
    } catch {
      /* ignore */
    }
    await ctx.conversation.enter("setLogGroup");
  });

  admin.callbackQuery(Callbacks.adminSetSwapApiKey, async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      await ctx.conversation.exitAll();
    } catch {
      /* ignore */
    }
    await ctx.conversation.enter("setSwapApiKey");
  });

  admin.callbackQuery(Callbacks.adminSetSwapWalletAddress, async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      await ctx.conversation.exitAll();
    } catch {
      /* ignore */
    }
    await ctx.conversation.enter("setSwapWalletAddress");
  });

  admin.callbackQuery(Callbacks.adminBackupMenu, async (ctx) => {
    await ctx.answerCallbackQuery();
    await safeEdit(
      ctx,
      [
        "💾 *مدیریت بکاپ*",
        "",
        "از این بخش می توانید بکاپ دستی بگیرید یا بازه بکاپ خودکار را تنظیم کنید.",
      ].join("\n"),
      adminBackupMenuKeyboard(),
    );
  });

  admin.callbackQuery(Callbacks.adminManualBackup, async (ctx) => {
    await ctx.answerCallbackQuery({ text: "در حال تهیه بکاپ..." });
    let filePath: string | undefined;
    try {
      filePath = await backupService.createDump();
      const stamp = new Date().toLocaleString("fa-IR", { timeZone: "Asia/Tehran" });
      await groupLogger.logBackup(
        ctx.api,
        filePath,
        ["📥 *بکاپ دستی دیتابیس*", "", `🕐 زمان: *${stamp}*`].join("\n"),
      );
      await ctx.reply(
        [
          "✅ *بکاپ ارسال شد*",
          "",
          "فایل بکاپ به گروه لاگ (تاپیک بکاپ ربات 🤖) ارسال شد.",
        ].join("\n"),
        { parse_mode: "Markdown", reply_markup: adminBackupMenuKeyboard() },
      );
    } catch (err) {
      console.error("manual backup error:", err);
      const msg =
        err instanceof Error && err.message.includes("LOG_GROUP_ID")
          ? "ابتدا گروه لاگ را از «⚙️ تنظیم گروه لاگ» تنظیم کنید."
          : "خطا در تهیه یا ارسال بکاپ. لاگ سرور را بررسی کنید.";
      await ctx.reply(
        ["⚠️ *خطا در بکاپ*", "", msg].join("\n"),
        { parse_mode: "Markdown", reply_markup: adminBackupMenuKeyboard() },
      );
    } finally {
      if (filePath) {
        await backupService.cleanup(filePath).catch(console.error);
      }
    }
  });

  admin.callbackQuery(Callbacks.adminSetAutoBackup, async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      await ctx.conversation.exitAll();
    } catch {
      /* ignore */
    }
    await ctx.conversation.enter("setAutoBackup");
  });

  admin.callbackQuery(Callbacks.adminAddProduct, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("addProduct");
  });

  admin.callbackQuery(Callbacks.adminAddPayment, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("addPaymentMethod");
  });

  admin.callbackQuery(Callbacks.adminDelCategoryMenu, async (ctx) => {
    await ctx.answerCallbackQuery();
    const categories = await catalogService.listAllCategories();
    const active = categories.filter((c) => c.isActive);
    if (active.length === 0) {
      await safeEdit(
        ctx,
        ["ℹ️ *حذف دسته*", "", "دسته ای برای حذف نیست."].join("\n"),
        adminCatalogKeyboard(),
      );
      return;
    }
    await safeEdit(
      ctx,
      [
        "🗑 *حذف دسته*",
        "",
        "دسته ای که می خواهید غیرفعال شود را انتخاب کنید:",
      ].join("\n"),
      adminDeleteCategoriesKeyboard(active),
    );
  });

  admin.callbackQuery(/^adm:cat:del:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match![1]);
    const cat = await catalogService.deleteCategory(id);
    await ctx.answerCallbackQuery({ text: "حذف شد" });
    await safeEdit(
      ctx,
      ["✅ *دسته غیرفعال شد*", "", `📦 نام: *${cat.name}*`].join("\n"),
      adminCatalogKeyboard(),
    );
  });

  admin.callbackQuery(Callbacks.adminEditProductMenu, async (ctx) => {
    await ctx.answerCallbackQuery();
    const products = await catalogService.listActiveProducts();
    if (products.length === 0) {
      await safeEdit(
        ctx,
        ["ℹ️ *ویرایش محصول*", "", "محصول فعالی نیست."].join("\n"),
        adminCatalogKeyboard(),
      );
      return;
    }
    try {
      await ctx.conversation.exitAll();
    } catch {
      /* ignore */
    }
    ctx.session.adminTargetId = undefined;
    ctx.session.adminTargetType = undefined;
    await ctx.conversation.enter("editProduct");
  });

  admin.callbackQuery(Callbacks.adminInventoryReport, async (ctx) => {
    await ctx.answerCallbackQuery();
    const rows = await inventoryService.getCompleteInventoryReport();
    const lines = rows.map((row) => {
      const status = row.isActive ? "" : " *(غیرفعال)*";
      return `🔹 ${row.productName}${status}: *${row.unsoldCount}* عدد`;
    });

    await safeEdit(
      ctx,
      [
        "📊 *گزارش موجودی انبار*",
        "",
        "موجودی آماده برای همه محصولات:",
        "",
        ...(lines.length > 0 ? lines : ["هیچ محصولی ثبت نشده است."]),
      ].join("\n"),
      adminCatalogKeyboard(),
    );
  });

  admin.callbackQuery(/^adm:prd:(?:edit|view):(\d+)$/, async (ctx) => {
    const id = Number(ctx.match![1]);
    if (!ctx.session) {
      ctx.session = createInitialSession();
    }
    ctx.session.adminTargetId = id;
    ctx.session.adminTargetType = "product";
    await ctx.answerCallbackQuery();
    await exitAllConversations(ctx);
    await ctx.conversation.enter("editProduct");
  });

  admin.callbackQuery(/^adm:prd:restock:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match![1]);
    ctx.session.adminTargetId = id;
    ctx.session.adminTargetType = "product";
    await ctx.answerCallbackQuery();
    try {
      await ctx.conversation.exitAll();
    } catch {
      /* ignore */
    }
    await ctx.conversation.enter("restockProduct");
  });

  admin.callbackQuery(/^adm:prd:alert:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match![1]);
    ctx.session.adminTargetId = id;
    ctx.session.adminTargetType = "product";
    await ctx.answerCallbackQuery();
    try {
      await ctx.conversation.exitAll();
    } catch {
      /* ignore */
    }
    await ctx.conversation.enter("setProductStockAlert");
  });

  admin.callbackQuery(/^adm:prd:duration:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match![1]);
    ctx.session.adminTargetId = id;
    ctx.session.adminTargetType = "product";
    await ctx.answerCallbackQuery();
    try {
      await ctx.conversation.exitAll();
    } catch {
      /* ignore */
    }
    await ctx.conversation.enter("setProductDuration");
  });

  admin.callbackQuery(/^adm:prd:cred_req:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match![1]);
    ctx.session.adminTargetId = id;
    ctx.session.adminTargetType = "product";
    await ctx.answerCallbackQuery();
    try {
      await ctx.conversation.exitAll();
    } catch {
      /* ignore */
    }
    await ctx.conversation.enter("setCredentialReq");
  });

  admin.callbackQuery(/^adm:prod:toggle_delivery:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match![1]);
    await ctx.answerCallbackQuery();
    const product = await catalogService.getProduct(id, false);
    if (!product) {
      await safeEdit(ctx, "محصول یافت نشد.", adminCatalogKeyboard());
      return;
    }

    await safeEdit(
      ctx,
      [
        "🔄 *تغییر نوع تحویل محصول*",
        "",
        `📦 محصول: *${product.name}*`,
        getDeliveryModeCaption(product.deliveryType),
        "",
        "لطفاً نوع تحویل جدید را انتخاب کنید:",
      ].join("\n"),
      adminDeliveryTypeSwitchKeyboard(id),
    );
  });

  admin.callbackQuery(
    /^adm:prod:set_delivery:(\d+):(SUPPLIER_AUTO|MANUAL|CREDENTIALS_REQUIRED)$/,
    async (ctx) => {
      const id = Number(ctx.match![1]);
      const newType = ctx.match![2] as DeliveryType;
      await ctx.answerCallbackQuery({ text: "✅ نوع تحویل با موفقیت بروزرسانی شد." });

      await catalogService.updateProductDeliveryType(id, newType);
      const product = await catalogService.getProduct(id, false);
      if (!product) {
        await safeEdit(ctx, "محصول یافت نشد.", adminCatalogKeyboard());
        return;
      }

      ctx.session.adminTargetId = id;
      ctx.session.adminTargetType = "product";

      let stockCount: number | null = null;
      if (product.deliveryType === "READY") {
        stockCount = await inventoryService.countAvailable(id);
      }

      await safeEdit(
        ctx,
        renderAdminProductCardText(product, stockCount),
        adminProductDetailKeyboard(product),
      );
    },
  );

  admin.callbackQuery(/^adm:ticket:close:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match![1]);
    await ctx.answerCallbackQuery();
    try {
      const ticket = await ticketService.closeTicket(id);
      await ctx.api.sendMessage(
        ticket.user.telegramId.toString(),
        `🔒 *تیکت #${ticket.id} توسط پشتیبانی بسته شد.*`,
        { parse_mode: "Markdown" },
      );
      await ctx.editMessageReplyMarkup({
        reply_markup: {
          inline_keyboard: [[{ text: "✅ تیکت بسته شد", callback_data: "adm:ticket:closed" }]],
        },
      });
    } catch (err) {
      console.error("close support topic ticket error:", err);
      await ctx.answerCallbackQuery({
        text: "خطا در بستن تیکت",
        show_alert: true,
      });
    }
  });

  admin.callbackQuery(Callbacks.adminEditPriceMenu, async (ctx) => {
    await ctx.answerCallbackQuery();
    const products = await catalogService.listActiveProducts();
    if (products.length === 0) {
      await safeEdit(
        ctx,
        ["ℹ️ *ویرایش قیمت*", "", "محصول فعالی نیست."].join("\n"),
        adminCatalogKeyboard(),
      );
      return;
    }
    await safeEdit(
      ctx,
      [
        "💵 *ویرایش قیمت*",
        "",
        "محصولی که می خواهید قیمتش را تغییر دهید انتخاب کنید:",
      ].join("\n"),
      adminProductPickKeyboard(products, "price"),
    );
  });

  admin.callbackQuery(/^adm:prd:price:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match![1]);
    ctx.session.adminTargetId = id;
    ctx.session.adminTargetType = "product";
    await ctx.answerCallbackQuery();
    await exitAllConversations(ctx);

    if (await isSupplierMarginAdminProduct(id)) {
      await presentSupplierMarginPricePanel(ctx, id);
      return;
    }

    ctx.session.adminOpenProductPriceEdit = true;
    try {
      await ctx.conversation.exitAll();
    } catch {
      /* ignore */
    }
    await ctx.conversation.enter("editProduct");
  });

  admin.callbackQuery(/^adm:prd:margin:edit:(\d+)$/, async (ctx) => {
    const productId = Number(ctx.match![1]);
    if (!ctx.session) {
      ctx.session = createInitialSession();
    }
    ctx.session.adminTargetId = productId;
    ctx.session.adminTargetType = "product";
    await ctx.answerCallbackQuery({ text: "در حال باز کردن…" });
    await exitAllConversations(ctx);
    await ctx.conversation.enter("setProductProfitMargin", productId);
  });

  admin.callbackQuery(/^adm:prd:margin:live:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match![1]);
    const { refreshSupplierMarginAndPresentPanel } = await import("./supplierPriceAdmin.js");
    const { ok } = await refreshSupplierMarginAndPresentPanel(ctx, id);
    if (ok) {
      await ctx.answerCallbackQuery({
        text: "✅ قیمت دلاری و تومانی با موفقیت به‌روزرسانی شد.",
      });
    } else {
      await ctx.answerCallbackQuery({
        text: "استعلام ناموفق بود. دوباره تلاش کنید.",
        show_alert: true,
      });
    }
  });

  admin.callbackQuery(Callbacks.adminDelProductMenu, async (ctx) => {
    await ctx.answerCallbackQuery();
    const products = await catalogService.listActiveProducts();
    if (products.length === 0) {
      await safeEdit(
        ctx,
        ["ℹ️ *حذف محصول*", "", "محصول فعالی نیست."].join("\n"),
        adminCatalogKeyboard(),
      );
      return;
    }
    await safeEdit(
      ctx,
      [
        "🗑 *حذف محصول*",
        "",
        "محصولی که می خواهید حذف (غیرفعال) شود را انتخاب کنید:",
      ].join("\n"),
      adminProductPickKeyboard(products, "delete"),
    );
  });

  admin.callbackQuery(/^adm:prd:del:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match![1]);
    const product = await catalogService.deleteProduct(id);
    await ctx.answerCallbackQuery({ text: "حذف شد" });
    await safeEdit(
      ctx,
      ["✅ *محصول غیرفعال شد*", "", `📦 نام: *${product.name}*`].join("\n"),
      adminCatalogKeyboard(),
    );
  });

  admin.callbackQuery(Callbacks.adminListPayments, async (ctx) => {
    await ctx.answerCallbackQuery();
    const [methods, swapEnabled] = await Promise.all([
      paymentMethodService.listAll(),
      settingsService.getBoolSetting(SWAPPAY_ENABLED, true),
    ]);
    if (methods.length === 0) {
      await safeEdit(
        ctx,
        [
          "📋 *روش های پرداخت*",
          "",
          "هنوز روش پرداختی (کارت/درگاه) ثبت نشده است.",
          "",
          "سواپ ولت را از همین لیست فعال/غیرفعال کنید، یا از «افزودن روش پرداخت» کارت/درگاه اضافه کنید.",
        ].join("\n"),
        adminPaymentListKeyboard(methods, swapEnabled),
      );
      return;
    }
    await safeEdit(
      ctx,
      [
        "📋 *روش های پرداخت*",
        "",
        "• روی نام بزنید تا فعال / غیرفعال شود",
        "• روی تنظیمات برای ویرایش کارت یا توکن",
      ].join("\n"),
      adminPaymentListKeyboard(methods, swapEnabled),
    );
  });

  admin.callbackQuery(/^adm:pm:tog:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match![1]);
    const method = await paymentMethodService.toggleActive(id);
    await ctx.answerCallbackQuery({
      text: method.isActive ? "فعال شد" : "غیرفعال شد",
    });
    const [methods, swapEnabled] = await Promise.all([
      paymentMethodService.listAll(),
      settingsService.getBoolSetting(SWAPPAY_ENABLED, true),
    ]);
    await safeEdit(
      ctx,
      [
        "💳 *وضعیت روش پرداخت*",
        "",
        `نام: *${method.name}*`,
        `وضعیت: ${method.isActive ? "✅ *فعال*" : "⏸ *غیرفعال*"}`,
      ].join("\n"),
      adminPaymentListKeyboard(methods, swapEnabled),
    );
  });

  admin.callbackQuery(Callbacks.adminToggleSwapPay, async (ctx) => {
    const current = await settingsService.getBoolSetting(SWAPPAY_ENABLED, true);
    const next = !current;
    await settingsService.setBoolSetting(SWAPPAY_ENABLED, next);
    await ctx.answerCallbackQuery({
      text: next ? "سواپ ولت فعال شد" : "سواپ ولت غیرفعال شد",
    });
    const [methods, swapEnabled] = await Promise.all([
      paymentMethodService.listAll(),
      settingsService.getBoolSetting(SWAPPAY_ENABLED, true),
    ]);
    await safeEdit(
      ctx,
      [
        "💎 *وضعیت سواپ ولت*",
        "",
        `وضعیت: ${swapEnabled ? "✅ *فعال*" : "⏸ *غیرفعال*"}`,
      ].join("\n"),
      adminPaymentListKeyboard(methods, swapEnabled),
    );
  });

  admin.callbackQuery(/^adm:pm:cfg:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match![1]);
    ctx.session.adminTargetId = id;
    ctx.session.adminTargetType = "payment";
    await ctx.answerCallbackQuery();
    try {
      await ctx.conversation.exitAll();
    } catch {
      /* ignore */
    }
    await ctx.conversation.enter("configurePayment");
  });

  /**
   * Synchronize the Admin Log Group receipt photo when processed anywhere (Bot PM or Log Group).
   * Updates caption with approving/rejecting admin details and removes inline buttons.
   */
  async function syncLogGroupReceipt(
    api: any,
    invoiceId: number,
    isApproved: boolean,
    details: {
      amountFormatted: string;
      buyerInfo: string;
      adminName: string;
      adminUsername: string;
      adminId: number | bigint;
      timeStr: string;
      fromPm?: boolean;
    },
  ): Promise<void> {
    try {
      const logGroupId = await groupLogger.getLogGroupId();
      if (!logGroupId) return;

      const syncData = await invoiceService.getSyncData(invoiceId);
      if (!syncData.logMessageId) return;

      const title = isApproved
        ? (details.fromPm ? "✅ <b>فاکتور تایید و شارژ شد (از پنل ربات)</b>" : "✅ <b>فاکتور تایید و شارژ شد</b>")
        : (details.fromPm ? "❌ <b>فاکتور رد شد (از پنل ربات)</b>" : "❌ <b>فاکتور رد شد</b>");

      const caption = [
        title,
        "",
        `🧾 شماره فاکتور: #${invoiceId}`,
        `💵 مبلغ: ${details.amountFormatted} تومان`,
        `👤 خریدار: ${details.buyerInfo}`,
        `👮‍♂️ <b>${isApproved ? "تایید شده توسط ادمین:" : "رد شده توسط ادمین:"}</b> ${details.adminName} (@${details.adminUsername})`,
        `🆔 <b>شناسه عددی ادمین:</b> <code>${details.adminId}</code>`,
        `🕒 زمان ${isApproved ? "تایید" : "رد"}: ${details.timeStr}`,
      ].join("\n");

      await api.editMessageCaption(logGroupId, syncData.logMessageId, {
        caption,
        parse_mode: "HTML",
        reply_markup: undefined,
      }).catch(() => {});
    } catch (err) {
      console.warn(`[syncLogGroupReceipt] failed for invoice #${invoiceId}:`, err);
    }
  }

  admin.callbackQuery(/^adm:approve_inv:(\d+)$/, async (ctx) => {
    // 1. Immediate Callback Acknowledgment to prevent timeouts
    await ctx.answerCallbackQuery().catch(() => {});

    if (!ctx.from || !(await hasAnyAdminAccess(ctx.from.id))) {
      await ctx.answerCallbackQuery({
        text: "⛔ دسترسی غیرمجاز",
        show_alert: true,
      }).catch(() => {});
      return;
    }

    const id = Number(ctx.match![1]);
    const isPrivateChat = ctx.chat?.type === "private";

    try {
      // 2. Idempotency Check
      const pending = await invoiceService.getById(id);
      if (!pending) {
        await ctx.answerCallbackQuery({
          text: "⚠️ فاکتور یافت نشد.",
          show_alert: true,
        }).catch(() => {});
        await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
        return;
      }

      // Check if already processed
      if (
        pending.status !== InvoiceStatus.AWAITING_APPROVAL &&
        pending.status !== InvoiceStatus.PENDING
      ) {
        const syncData = await invoiceService.getSyncData(pending);
        const adminName = syncData.approvedByAdminName || "ادمین";
        const adminIdStr = syncData.approvedByAdminId != null ? String(syncData.approvedByAdminId) : "—";
        const statusLabel = pending.status === InvoiceStatus.PAID ? "✅ تایید شده" : "❌ رد شده";

        await ctx.answerCallbackQuery({
          text: `⚠️ این فاکتور قبلاً توسط ${adminName} تعیین وضعیت شده است.`,
          show_alert: true,
        }).catch(() => {});

        // If clicked in log group or PM, update caption to clarify stale state and strip buttons
        const staleCaption = [
          "ℹ️ <b>این فاکتور قبلاً تعیین وضعیت شده است.</b>",
          "",
          `🧾 شماره فاکتور: #${pending.id}`,
          `📊 وضعیت: ${statusLabel}`,
          `👮‍♂️ توسط: ${adminName} (شناسه: <code>${adminIdStr}</code>)`,
        ].join("\n");

        try {
          await ctx.editMessageCaption({
            caption: staleCaption,
            parse_mode: "HTML",
            reply_markup: undefined,
          });
        } catch {
          await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
        }
        return;
      }

      // 3. Admin Identity & Details
      const adminFirstName = escapeHtml(ctx.from.first_name || "ادمین");
      const adminUsername = ctx.from.username ? escapeHtml(ctx.from.username) : "ندارد";
      const adminId = ctx.from.id;
      const currentTime = formatReceiptDate(new Date());

      const amountNum = pending.topUpAmount ? Number(pending.topUpAmount) : Number(pending.amount);
      const formattedAmount = Math.round(amountNum).toLocaleString("en-US");
      const buyerTelegramId = pending.user?.telegramId ? pending.user.telegramId.toString() : String(pending.userId);
      const buyerInfo = `کاربر #${pending.userId} (شناسه: <code>${buyerTelegramId}</code>)`;

      // Save acting admin info & logMessageId (if clicked from log group)
      await invoiceService.setApprovalAdmin(id, {
        id: adminId,
        name: `${ctx.from.first_name || "ادمین"} (@${ctx.from.username || "ندارد"})`,
      });

      if (!isPrivateChat && ctx.callbackQuery.message?.message_id) {
        await invoiceService.setLogMessageId(id, ctx.callbackQuery.message.message_id);
      }

      const approvalCaption = [
        isPrivateChat ? "✅ <b>فاکتور تایید و شارژ شد (از پنل ربات)</b>" : "✅ <b>فاکتور تایید و شارژ شد</b>",
        "",
        `🧾 شماره فاکتور: #${pending.id}`,
        `💵 مبلغ: ${formattedAmount} تومان`,
        `👤 خریدار: ${buyerInfo}`,
        `👮‍♂️ <b>تایید شده توسط ادمین:</b> ${adminFirstName} (@${adminUsername})`,
        `🆔 <b>شناسه عددی ادمین:</b> <code>${adminId}</code>`,
        `🕒 زمان تایید: ${currentTime}`,
      ].join("\n");

      // 4. Process Approval
      if (pending.isWalletTopUp) {
        const invoice = await walletService.processTopUpApproval(id);
        const topUpAmount = invoice.topUpAmount ?? invoice.amount;
        const tgId = invoice.user.telegramId.toString();

        await groupLogger
          .logFinance(ctx.api, topUpAmount, "CARD")
          .catch(console.error);

        // Edit current message caption and remove buttons
        try {
          await ctx.editMessageCaption({
            caption: approvalCaption,
            parse_mode: "HTML",
            reply_markup: undefined,
          });
        } catch (editErr) {
          console.error("Failed to editMessageCaption on top-up approval:", editErr);
          await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
        }

        // If approved from PM, synchronize the Log Group message caption immediately
        if (isPrivateChat) {
          await syncLogGroupReceipt(ctx.api, id, true, {
            amountFormatted: formattedAmount,
            buyerInfo,
            adminName: adminFirstName,
            adminUsername,
            adminId,
            timeStr: currentTime,
            fromPm: true,
          });
        }

        try {
          await ctx.api.sendMessage(
            tgId,
            `✅ کیف پول شما با موفقیت به مبلغ ${formatToman(topUpAmount)} شارژ شد.`,
          );
        } catch (err) {
          console.error("Failed to notify user of wallet top-up:", err);
        }
        return;
      }

      const invoice = await invoiceService.approve(id);
      const itemLabel = invoiceService.invoiceLabel(invoice);

      await groupLogger
        .logPurchase(
          ctx.api,
          invoice.id,
          itemLabel,
          invoice.amount,
          invoice.user.telegramId.toString(),
        )
        .catch(console.error);

      const paymentType = invoice.receiptFileId ? "CARD" : "GATEWAY";
      await groupLogger
        .logFinance(ctx.api, invoice.amount, paymentType)
        .catch(console.error);

      // Edit current message caption and remove buttons
      try {
        await ctx.editMessageCaption({
          caption: approvalCaption,
          parse_mode: "HTML",
          reply_markup: undefined,
        });
      } catch (editErr) {
        console.error("Failed to editMessageCaption on purchase approval:", editErr);
        await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
      }

      // If approved from PM, synchronize the Log Group message caption immediately
      if (isPrivateChat) {
        await syncLogGroupReceipt(ctx.api, id, true, {
          amountFormatted: formattedAmount,
          buyerInfo,
          adminName: adminFirstName,
          adminUsername,
          adminId,
          timeStr: currentTime,
          fromPm: true,
        });
      }

      try {
        await fulfillmentService.processApprovedInvoice(ctx.api, invoice.id);
      } catch (err) {
        console.error("Failed to notify buyer of approval:", err);
      }
    } catch (err) {
      console.error("approve invoice error:", err);
      if (err instanceof InvoiceInvalidStateError) {
        await ctx.answerCallbackQuery({
          text: "⚠️ این فاکتور قبلاً تعیین تکلیف شده است.",
          show_alert: true,
        }).catch(() => {});
        await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
        return;
      }
      await ctx.answerCallbackQuery({
        text: "خطا در تایید — وضعیت فاکتور را چک کنید",
        show_alert: true,
      }).catch(() => {});
    }
  });

  admin.callbackQuery(/^adm:reject_inv:(\d+)$/, async (ctx) => {
    // 1. Immediate Callback Acknowledgment to prevent timeouts
    await ctx.answerCallbackQuery().catch(() => {});

    if (!ctx.from || !(await hasAnyAdminAccess(ctx.from.id))) {
      await ctx.answerCallbackQuery({
        text: "⛔ دسترسی غیرمجاز",
        show_alert: true,
      }).catch(() => {});
      return;
    }

    const id = Number(ctx.match![1]);
    const isPrivateChat = ctx.chat?.type === "private";

    try {
      // 2. Idempotency Check
      const invoice = await invoiceService.getById(id);
      if (!invoice) {
        await ctx.answerCallbackQuery({
          text: "⚠️ فاکتور یافت نشد.",
          show_alert: true,
        }).catch(() => {});
        await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
        return;
      }

      // Check if already processed
      if (
        invoice.status !== InvoiceStatus.AWAITING_APPROVAL &&
        invoice.status !== InvoiceStatus.PENDING
      ) {
        const syncData = await invoiceService.getSyncData(invoice);
        const adminName = syncData.approvedByAdminName || "ادمین";
        const adminIdStr = syncData.approvedByAdminId != null ? String(syncData.approvedByAdminId) : "—";
        const statusLabel = invoice.status === InvoiceStatus.PAID ? "✅ تایید شده" : "❌ رد شده";

        await ctx.answerCallbackQuery({
          text: `⚠️ این فاکتور قبلاً توسط ${adminName} تعیین وضعیت شده است.`,
          show_alert: true,
        }).catch(() => {});

        // If clicked in log group or PM, update caption to clarify stale state and strip buttons
        const staleCaption = [
          "ℹ️ <b>این فاکتور قبلاً تعیین وضعیت شده است.</b>",
          "",
          `🧾 شماره فاکتور: #${invoice.id}`,
          `📊 وضعیت: ${statusLabel}`,
          `👮‍♂️ توسط: ${adminName} (شناسه: <code>${adminIdStr}</code>)`,
        ].join("\n");

        try {
          await ctx.editMessageCaption({
            caption: staleCaption,
            parse_mode: "HTML",
            reply_markup: undefined,
          });
        } catch {
          await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
        }
        return;
      }

      // 3. Process Rejection
      await invoiceService.reject(id, "رد شده توسط ادمین");

      // 4. Admin Identity & Details
      const adminFirstName = escapeHtml(ctx.from.first_name || "ادمین");
      const adminUsername = ctx.from.username ? escapeHtml(ctx.from.username) : "ندارد";
      const adminId = ctx.from.id;
      const currentTime = formatReceiptDate(new Date());

      const amountNum = invoice.topUpAmount ? Number(invoice.topUpAmount) : Number(invoice.amount);
      const formattedAmount = Math.round(amountNum).toLocaleString("en-US");
      const buyerTelegramId = invoice.user?.telegramId ? invoice.user.telegramId.toString() : String(invoice.userId);
      const buyerInfo = `کاربر #${invoice.userId} (شناسه: <code>${buyerTelegramId}</code>)`;

      // Save acting admin info & logMessageId (if clicked from log group)
      await invoiceService.setApprovalAdmin(id, {
        id: adminId,
        name: `${ctx.from.first_name || "ادمین"} (@${ctx.from.username || "ندارد"})`,
      });

      if (!isPrivateChat && ctx.callbackQuery.message?.message_id) {
        await invoiceService.setLogMessageId(id, ctx.callbackQuery.message.message_id);
      }

      const rejectionCaption = [
        isPrivateChat ? "❌ <b>فاکتور رد شد (از پنل ربات)</b>" : "❌ <b>فاکتور رد شد</b>",
        "",
        `🧾 شماره فاکتور: #${invoice.id}`,
        `💵 مبلغ: ${formattedAmount} تومان`,
        `👤 خریدار: ${buyerInfo}`,
        `👮‍♂️ <b>رد شده توسط ادمین:</b> ${adminFirstName} (@${adminUsername})`,
        `🆔 <b>شناسه عددی ادمین:</b> <code>${adminId}</code>`,
        `🕒 زمان رد: ${currentTime}`,
      ].join("\n");

      // 5. Update Caption & Remove Buttons on current message
      try {
        await ctx.editMessageCaption({
          caption: rejectionCaption,
          parse_mode: "HTML",
          reply_markup: undefined,
        });
      } catch (editErr) {
        console.error("Failed to editMessageCaption on reject:", editErr);
        await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
      }

      // If rejected from PM, synchronize the Log Group message caption immediately
      if (isPrivateChat) {
        await syncLogGroupReceipt(ctx.api, id, false, {
          amountFormatted: formattedAmount,
          buyerInfo,
          adminName: adminFirstName,
          adminUsername,
          adminId,
          timeStr: currentTime,
          fromPm: true,
        });
      }

      // 6. Notify Buyer
      try {
        const itemLabel = invoice.isWalletTopUp
          ? "شارژ کیف پول"
          : (invoice.product?.name ?? "سفارش");
        await ctx.api.sendMessage(
          invoice.user.telegramId.toString(),
          [
            "❌ *پرداخت شما تایید نشد و فاکتور رد شد.*",
            "",
            `🧾 شماره فاکتور: *#${invoice.id}*`,
            `📦 مورد: *${itemLabel}*`,
            `💵 مبلغ: *${formatToman(invoice.amount)}*`,
            "",
            "در صورت واریز وجه یا هرگونه سوال، لطفاً با پشتیبانی در ارتباط باشید.",
          ].join("\n"),
          { parse_mode: "Markdown" },
        );
      } catch (err) {
        console.error("Failed to notify buyer of rejection:", err);
      }
    } catch (err) {
      console.error("reject invoice error:", err);
      if (err instanceof InvoiceInvalidStateError) {
        await ctx.answerCallbackQuery({
          text: "⚠️ این فاکتور قبلاً تعیین تکلیف شده است.",
          show_alert: true,
        }).catch(() => {});
        await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
        return;
      }
      await ctx.answerCallbackQuery({
        text: "خطا در رد فاکتور — وضعیت فاکتور را چک کنید",
        show_alert: true,
      }).catch(() => {});
    }
  });

  admin.callbackQuery(/^adm:tkt:re:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match![1]);
    ctx.session.adminTargetId = id;
    ctx.session.adminTargetType = "ticket";
    await ctx.answerCallbackQuery();
    try {
      await ctx.conversation.exitAll();
    } catch {
      /* ignore */
    }
    await ctx.conversation.enter("adminReplyTicket");
  });

  admin.callbackQuery(/^adm:dispatch:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: "در حال ارسال به تامین‌کننده…" }).catch(() => {});

    if (!ctx.from || !(await hasAnyAdminAccess(ctx.from.id))) {
      await ctx.answerCallbackQuery({ text: "⛔ دسترسی غیرمجاز", show_alert: true }).catch(() => {});
      return;
    }

    const invoiceId = Number(ctx.match![1]);
    const editAdminMessage = async (text: string) => {
      await safeEdit(ctx, text, { parse_mode: "Markdown", reply_markup: undefined });
    };

    const result = await canbosoDispatchService.executeDispatch(
      ctx.api,
      invoiceId,
      editAdminMessage,
    );

    if (result.ok) {
      await ctx.answerCallbackQuery({ text: "✅ تحویل شد" }).catch(() => {});
      return;
    }

    await ctx.answerCallbackQuery({
      text: `❌ ${result.message}`,
      show_alert: true,
    }).catch(() => {});

    await safeEdit(
      ctx,
      [
        "📦 *سفارش تامین‌کننده*",
        "",
        `❌ خطا در خرید از تامین‌کننده: ${result.message}`,
        "",
        "کیف پول تامین‌کننده را بررسی کنید و مجدداً دکمه ارسال را بزنید.",
      ].join("\n"),
      {
        parse_mode: "Markdown",
        reply_markup: ctx.callbackQuery.message?.reply_markup,
      },
    ).catch(() => {});
  });

  admin.callbackQuery(/^adm:cancel_order:(\d+)$/, async (ctx) => {
    if (!ctx.from || !(await hasAnyAdminAccess(ctx.from.id))) {
      await ctx.answerCallbackQuery({ text: "⛔ دسترسی غیرمجاز", show_alert: true }).catch(() => {});
      return;
    }

    const invoiceId = Number(ctx.match![1]);
    const editAdminMessage = async (text: string) => {
      await safeEdit(ctx, text, { parse_mode: "Markdown", reply_markup: undefined });
    };

    const result = await canbosoDispatchService.cancelAndRefundWallet(
      ctx.api,
      invoiceId,
      editAdminMessage,
    );

    if (result.ok) {
      await ctx.answerCallbackQuery({ text: "سفارش لغو و مبلغ بازگشت داده شد" }).catch(() => {});
      return;
    }

    await ctx.answerCallbackQuery({ text: result.message, show_alert: true }).catch(() => {});
  });

  registerSupplierPendingImportAdmin(bot);
  bot.use(adminBase);
}
