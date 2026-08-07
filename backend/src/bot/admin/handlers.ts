import { Composer, type Bot } from "grammy";
import { createConversation } from "@grammyjs/conversations";
import { InvoiceStatus, TicketStatus } from "@prisma/client";
import type { BotContext } from "../context";
import { adminOnlyMiddleware, assertAdmin } from "./middleware";
import {
  adminBackupMenuKeyboard,
  adminCatalogKeyboard,
  adminDeleteCategoriesKeyboard,
  adminHomeKeyboard,
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
} from "./keyboards";
import { Callbacks } from "../keyboards/callbacks";
import { catalogService } from "../../services/catalog/CatalogService";
import { paymentMethodService } from "../../services/paymentMethods/PaymentMethodService";
import { crmService } from "../../services/crm/CrmService";
import { invoiceService } from "../../services/invoices/InvoiceService";
import { ticketService } from "../../services/tickets/TicketService";
import { groupLogger } from "../../services/logger/GroupLogger";
import { backupService } from "../../services/backup/BackupService";
import { inventoryService } from "../../services/inventory/InventoryService";
import { fulfillmentService } from "../../services/fulfillment/FulfillmentService";
import { walletService } from "../../services/wallet/WalletService";
import {
  adminUserService,
  parseUserAnalyticsFilter,
  type UserAnalyticsFilter,
} from "../../services/adminUsers/AdminUserService";
import {
  settingsService,
  SWAPPAY_ENABLED,
} from "../../services/settings/SettingsService";
import { formatToman } from "../../lib/money";
import { deliveryTypeLabel } from "../keyboards/grid";
import { BannerAssets } from "../assets/banners";
import {
  editProductConversation,
  restockProductConversation,
  setCredentialReqConversation,
  setProductStockAlertConversation,
  setProductDurationConversation,
} from "./catalog";
import {
  addCategoryConversation,
  addPaymentMethodConversation,
  addProductConversation,
  adminReplyTicketConversation,
  configurePaymentConversation,
  rejectInvoiceConversation,
  setAutoBackupConversation,
  setLogGroupConversation,
  setSwapApiKeyConversation,
  setSwapWalletAddressConversation,
} from "./conversations";
import {
  editAdminUserBalanceConversation,
  messageAdminUserConversation,
  adminSearchUserConversation,
} from "./users";
import { editPageTextConversation } from "../cms/editPageTextConversation";
import { adminCmsMediaConversation } from "../cms/adminCmsMediaConversation";
import { presentCmsPage } from "../cms/presentPage";
import {
  cmsAddCategoryConversation,
  cmsAddProductConversation,
  cmsEditProductPriceConversation,
  cmsRenameCategoryConversation,
  cmsRenameProductConversation,
  presentCmsCategoryList,
  presentCmsCategoryView,
  presentCmsProductCategoryPick,
  presentCmsProductList,
  presentCmsProductView,
} from "../cms/shopCms";
import { isPageKey, pageContentService } from "../../services/cms/PageContentService";
import { safeEdit, safeEditMedia } from "../utils/safeEdit";
import { panelFromCtx } from "../conversations/wait";

const RECEIPT_STATUS_LABELS: Record<string, string> = {
  AWAITING_APPROVAL: "در انتظار تایید",
  PAID: "تایید شده",
  CANCELLED: "رد شده",
};

function formatReceiptDate(date: Date): string {
  return date.toLocaleString("fa-IR", { timeZone: "Asia/Tehran" });
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
  bot.use(createConversation(addProductConversation, "addProduct"));
  bot.use(createConversation(editProductConversation, "editProduct"));
  bot.use(createConversation(restockProductConversation, "restockProduct"));
  bot.use(createConversation(setProductStockAlertConversation, "setProductStockAlert"));
  bot.use(createConversation(setProductDurationConversation, "setProductDuration"));
  bot.use(createConversation(setCredentialReqConversation, "setCredentialReq"));
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

  bot.command("admin", async (ctx) => {
    if (!assertAdmin(ctx)) {
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
      { parse_mode: "Markdown", reply_markup: adminHomeKeyboard() },
    );
  });

  const adminCommands = new Composer<BotContext>();
  adminCommands.use(adminOnlyMiddleware);

  adminCommands.command("setup_topics", async (ctx) => {
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

  bot.use(adminCommands);

  const admin = new Composer<BotContext>().filter((ctx) => {
    const data = ctx.callbackQuery?.data;
    return typeof data === "string" && data.startsWith("adm:");
  });
  admin.use(adminOnlyMiddleware);

  admin.callbackQuery(Callbacks.adminHome, async (ctx) => {
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
  admin.callbackQuery(Callbacks.cmsCats, async (ctx) => {
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

  admin.callbackQuery(Callbacks.adminCatalog, async (ctx) => {
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

  admin.callbackQuery(Callbacks.adminReceipts, async (ctx) => {
    await ctx.answerCallbackQuery();
    const counts = await invoiceService.getReceiptHubCounts();
    await safeEditMedia(
      ctx,
      BannerAssets.welcome,
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

  admin.callbackQuery(Callbacks.adminPayments, async (ctx) => {
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

  admin.callbackQuery(/^adm:stats:(.+)$/, async (ctx) => {
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
  admin.callbackQuery(Callbacks.adminTickets, async (ctx) => {
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

  admin.callbackQuery(/^adm:prd:edit:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match![1]);
    ctx.session.adminTargetId = id;
    ctx.session.adminTargetType = "product";
    await ctx.answerCallbackQuery();
    try {
      await ctx.conversation.exitAll();
    } catch {
      /* ignore */
    }
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
    try {
      await ctx.conversation.exitAll();
    } catch {
      /* ignore */
    }
    await ctx.conversation.enter("editProduct");
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

  admin.callbackQuery(/^adm:approve_inv:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match![1]);
    try {
      const pending = await invoiceService.getById(id);
      if (!pending) {
        await ctx.answerCallbackQuery({ text: "فاکتور یافت نشد", show_alert: true });
        return;
      }

      if (pending.isWalletTopUp) {
        const invoice = await walletService.processTopUpApproval(id);
        await ctx.answerCallbackQuery({ text: "شارژ کیف پول تایید شد ✅" });

        const topUpAmount = invoice.topUpAmount ?? invoice.amount;
        const tgId = invoice.user.telegramId.toString();

        await groupLogger
          .logFinance(ctx.api, topUpAmount, "CARD")
          .catch(console.error);

        try {
          await ctx.editMessageCaption({
            caption: [
              "✅ *شارژ کیف پول تایید شد*",
              "",
              `🧾 فاکتور: *#${invoice.id}*`,
              `💵 مبلغ: *${formatToman(topUpAmount)}*`,
              `📊 وضعیت: *PAID*`,
            ].join("\n"),
            parse_mode: "Markdown",
            reply_markup: { inline_keyboard: [] },
          });
        } catch {
          await ctx.reply(
            [
              "✅ *شارژ کیف پول تایید شد*",
              "",
              `🧾 فاکتور: *#${invoice.id}*`,
              `📊 وضعیت: *PAID*`,
            ].join("\n"),
            { parse_mode: "Markdown" },
          );
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
      await ctx.answerCallbackQuery({ text: "تایید شد ✅" });

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

      try {
        await ctx.editMessageCaption({
          caption: [
            "✅ *فاکتور تایید شد*",
            "",
            `🧾 شماره: *#${invoice.id}*`,
            `📦 مورد: *${itemLabel}*`,
            `💵 مبلغ: *${formatToman(invoice.amount)}*`,
            `📊 وضعیت: *PAID*`,
            "",
            "پرداخت تایید و محصول آماده تحویل است.",
          ].join("\n"),
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: [] },
        });
      } catch {
        await ctx.reply(
          [
            "✅ *فاکتور تایید شد*",
            "",
            `🧾 شماره: *#${invoice.id}*`,
            `📊 وضعیت: *PAID*`,
          ].join("\n"),
          { parse_mode: "Markdown" },
        );
      }

      try {
        await fulfillmentService.processApprovedInvoice(ctx.api, invoice.id);
      } catch (err) {
        console.error("Failed to notify buyer of approval:", err);
      }
    } catch (err) {
      console.error("approve invoice error:", err);
      await ctx.answerCallbackQuery({
        text: "خطا در تایید — وضعیت فاکتور را چک کنید",
        show_alert: true,
      });
    }
  });

  admin.callbackQuery(/^adm:reject_inv:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match![1]);
    ctx.session.adminRejectInvoiceId = id;
    ctx.session.adminTargetId = id;
    ctx.session.adminTargetType = "invoice";
    await ctx.answerCallbackQuery({ text: "دلیل رد را بنویسید" });

    try {
      await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
    } catch {
      /* ignore — caption-only / already cleared */
    }

    try {
      await ctx.conversation.exitAll();
    } catch {
      /* ignore */
    }
    await ctx.conversation.enter("rejectInvoice");
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

  bot.use(admin);
}
