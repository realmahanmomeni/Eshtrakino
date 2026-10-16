import { Composer, InlineKeyboard } from "grammy";
import type { Bot } from "grammy";
import { createConversation } from "@grammyjs/conversations";
import { SupplierPendingImportStatus } from "@prisma/client";
import type { BotContext, EshtrakinoConversation, SessionContext } from "../context";
import { hasAnyAdminAccess, hasPermission } from "./rbac";
import { safeEdit } from "../utils/safeEdit";
import { adminSuppliersKeyboard } from "./keyboards";
import { catalogService } from "../../services/catalog/CatalogService";
import { prisma } from "../../lib/prisma";
import {
  PENDING_LIST_PAGE_SIZE,
  buildPendingImportSummaryHtml,
  buildPendingPlacementConfirmHtml,
  formatPendingDisplayName,
  pendingImportActionKeyboard,
  pendingImportConfirmKeyboard,
  supplierPendingImportService,
} from "../../services/suppliers/SupplierPendingImportService";
import { ensurePanel, panelFromCtx, waitTextOnPanel, type PanelRef } from "../conversations/wait";
import { truncateInlineButtonLabel } from "../../lib/telegramLabel";
import { parseProfitMarginPercentInput } from "../../services/catalog/profitMarginInput";
import {
  pendingCategoryKeyboard,
  presentPlacementConfirm,
  presentSubCategoryPicker,
} from "./supplierPendingAdminUi";
import { registerPendingImportPlacementConversations } from "./pendingImportPlacementConversation";
import { suggestPendingImportSubCategoryName } from "../../services/suppliers/pendingImportBrandName";
import { registerSupplierNameSyncAdmin } from "./supplierNameSyncAdmin";

type ListFilter = "PENDING" | "REJECTED";

export async function guardCatalogAdmin(ctx: BotContext): Promise<boolean> {
  if (
    !ctx.from ||
    (!(await hasAnyAdminAccess(ctx.from.id)) &&
      !(await hasPermission(ctx.from.id, "CATALOG")))
  ) {
    await ctx.answerCallbackQuery({ text: "⛔ دسترسی غیرمجاز", show_alert: true });
    return false;
  }
  return true;
}

function parseListCallback(data: string): { filter: ListFilter; page: number } {
  const m = /^adm:sup:pend:list:(PENDING|REJECTED):(\d+)$/.exec(data);
  if (m) {
    return { filter: m[1] as ListFilter, page: Number(m[2]) };
  }
  return { filter: "PENDING", page: 0 };
}

async function presentPendingList(
  ctx: BotContext,
  filter: ListFilter = "PENDING",
  page = 0,
): Promise<void> {
  const status =
    filter === "PENDING"
      ? SupplierPendingImportStatus.PENDING
      : SupplierPendingImportStatus.REJECTED;

  const [total, pendingCount, rejectedCount, rows] = await Promise.all([
    prisma.supplierPendingImport.count({ where: { status } }),
    prisma.supplierPendingImport.count({
      where: { status: SupplierPendingImportStatus.PENDING },
    }),
    prisma.supplierPendingImport.count({
      where: { status: SupplierPendingImportStatus.REJECTED },
    }),
    prisma.supplierPendingImport.findMany({
      where: { status },
      orderBy: { createdAt: "desc" },
      skip: page * PENDING_LIST_PAGE_SIZE,
      take: PENDING_LIST_PAGE_SIZE,
    }),
  ]);

  const kb = new InlineKeyboard();
  kb
    .text(
      filter === "PENDING" ? "⏳ در انتظار ✓" : "⏳ در انتظار",
      "adm:sup:pend:list:PENDING:0",
    )
    .text(
      filter === "REJECTED" ? "🚫 رد شده ✓" : "🚫 رد شده",
      "adm:sup:pend:list:REJECTED:0",
    )
    .row();

  if (rows.length === 0) {
    kb.text("🔙 بازگشت", "adm:suppliers").row();
    await safeEdit(
      ctx,
      [
        "📥 *محصولات جدید تامین‌کننده*",
        "",
        `⏳ در انتظار: *${pendingCount}*`,
        `🚫 رد شده: *${rejectedCount}*`,
        "",
        filter === "PENDING"
          ? "مورد در انتظاری وجود ندارد."
          : "مورد رد‌شده‌ای وجود ندارد.",
      ].join("\n"),
      { parse_mode: "Markdown", reply_markup: kb },
    );
    return;
  }

  for (const row of rows) {
    const icon = filter === "PENDING" ? "⏳" : "🚫";
    const label = truncateInlineButtonLabel(
      `${icon} ${formatPendingDisplayName(row.displayName)}`,
      60,
    );
    kb.text(label, `adm:sup:pend:v:${row.id}`).row();
  }

  const pageCount = Math.max(1, Math.ceil(total / PENDING_LIST_PAGE_SIZE));
  if (pageCount > 1) {
    if (page > 0) {
      kb.text("◀️ قبلی", `adm:sup:pend:list:${filter}:${page - 1}`);
    }
    if (page + 1 < pageCount) {
      kb.text("بعدی ▶️", `adm:sup:pend:list:${filter}:${page + 1}`);
    }
    kb.row();
  }

  kb.text("🔙 بازگشت", "adm:suppliers").row();

  const from = page * PENDING_LIST_PAGE_SIZE + 1;
  const to = page * PENDING_LIST_PAGE_SIZE + rows.length;

  await safeEdit(
    ctx,
    [
      "📥 *محصولات جدید تامین‌کننده*",
      "",
      `⏳ در انتظار: *${pendingCount}*`,
      `🚫 رد شده: *${rejectedCount}*`,
      "",
      filter === "PENDING"
        ? `نمایش *${from}–${to}* از *${total}* مورد در انتظار:`
        : `نمایش *${from}–${to}* از *${total}* مورد رد‌شده:`,
    ].join("\n"),
    { parse_mode: "Markdown", reply_markup: kb },
  );
}

export async function setPendingImportMarginConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
  pendingIdFromEnter?: number,
): Promise<void> {
  const pendingId =
    pendingIdFromEnter ??
    (await conversation.external((c) => c.session?.adminTargetId));

  if (!pendingId || !Number.isFinite(pendingId)) {
    await ctx.reply("⚠️ درخواست محصول مشخص نیست.");
    return;
  }

  let panel: PanelRef | null = panelFromCtx(ctx);
  let prompt = [
    "✏️ <b>ویرایش درصد سود (محصول جدید)</b>",
    "",
    "درصد سود را به صورت عدد انگلیسی وارد کنید (مثال: 20 یا 12.5):",
    "",
    "▫️ برای انصراف /cancel را ارسال کنید.",
  ].join("\n");

  while (true) {
    const input = await waitTextOnPanel(conversation, ctx, prompt, panel, {
      parse_mode: "HTML",
    });
    panel = input.panel;

    if (!input.text) {
      const row = await conversation.external(() =>
        prisma.supplierPendingImport.findUnique({ where: { id: pendingId } }),
      );
      if (row) {
        if (row.categoryId != null) {
          const summary = await conversation.external(() =>
            buildPendingPlacementConfirmHtml(row),
          );
          if (summary) {
            await ensurePanel(
              ctx,
              summary,
              pendingImportConfirmKeyboard(row.id),
              panel,
              { parse_mode: "HTML" },
            );
            return;
          }
        }
        const summary = await conversation.external(() => buildPendingImportSummaryHtml(row));
        await ensurePanel(
          ctx,
          summary,
          pendingImportActionKeyboard(row.id, row.status),
          panel,
          { parse_mode: "HTML" },
        );
      }
      return;
    }

    const parsed = parseProfitMarginPercentInput(input.text);
    if (!parsed.ok) {
      prompt = [
        parsed.errorMessage,
        "",
        "لطفاً درصد سود را دوباره وارد کنید (مثال: 20 یا 12.5):",
        "",
        "▫️ برای انصراف /cancel را ارسال کنید.",
      ].join("\n");
      await ensurePanel(ctx, parsed.errorMessage, undefined, panel, { parse_mode: "HTML" });
      continue;
    }

    const row = await conversation.external(async () => {
      await supplierPendingImportService.updatePendingMargin(pendingId, parsed.value);
      return prisma.supplierPendingImport.findUnique({ where: { id: pendingId } });
    });

    if (!row) {
      await ctx.reply("⚠️ درخواست یافت نشد.");
      return;
    }

    if (row.categoryId != null) {
      const summary = await conversation.external(() => buildPendingPlacementConfirmHtml(row));
      if (summary) {
        await ensurePanel(
          ctx,
          [`✅ درصد سود به <b>${parsed.value}%</b> تنظیم شد.`, "", summary].join("\n"),
          pendingImportConfirmKeyboard(row.id),
          panel,
          { parse_mode: "HTML" },
        );
        return;
      }
    }

    const summary = await conversation.external(() => buildPendingImportSummaryHtml(row));
    await ensurePanel(
      ctx,
      [`✅ درصد سود به <b>${parsed.value}%</b> تنظیم شد.`, "", summary].join("\n"),
      pendingImportActionKeyboard(row.id, row.status),
      panel,
      { parse_mode: "HTML" },
    );
    return;
  }
}

export function registerSupplierPendingImportAdmin(bot: Bot<BotContext>): void {
  const admin = new Composer<BotContext>();
  registerPendingImportPlacementConversations(bot);
  bot.use(createConversation(setPendingImportMarginConversation, "setPendingImportMargin"));

  admin.callbackQuery("adm:sup:pending", async (ctx) => {
    if (!(await guardCatalogAdmin(ctx))) return;
    await ctx.answerCallbackQuery();
    await presentPendingList(ctx, "PENDING", 0);
  });

  admin.callbackQuery(/^adm:sup:pend:list:(PENDING|REJECTED):(\d+)$/, async (ctx) => {
    if (!(await guardCatalogAdmin(ctx))) return;
    await ctx.answerCallbackQuery();
    const { filter, page } = parseListCallback(ctx.callbackQuery.data);
    await presentPendingList(ctx, filter, page);
  });

  admin.callbackQuery(/^adm:sup:pend:v:(\d+)$/, async (ctx) => {
    if (!(await guardCatalogAdmin(ctx))) return;
    await ctx.answerCallbackQuery();
    const pendingId = Number(ctx.match![1]);
    const row = await prisma.supplierPendingImport.findUnique({ where: { id: pendingId } });
    if (!row) {
      await safeEdit(ctx, "⚠️ درخواست یافت نشد.", adminSuppliersKeyboard());
      return;
    }
    const summary = await buildPendingImportSummaryHtml(row);
    await safeEdit(ctx, summary, {
      parse_mode: "HTML",
      reply_markup: pendingImportActionKeyboard(row.id, row.status),
    });
  });

  admin.callbackQuery(/^adm:sup:pend:reject:(\d+)$/, async (ctx) => {
    if (!(await guardCatalogAdmin(ctx))) return;
    const pendingId = Number(ctx.match![1]);
    const result = await supplierPendingImportService.rejectPending(
      pendingId,
      BigInt(ctx.from!.id),
    );
    await ctx.answerCallbackQuery({ text: result.message, show_alert: !result.ok });
    const row = await prisma.supplierPendingImport.findUnique({ where: { id: pendingId } });
    if (row) {
      const summary = await buildPendingImportSummaryHtml(row);
      await safeEdit(ctx, summary, {
        parse_mode: "HTML",
        reply_markup: pendingImportActionKeyboard(row.id, row.status),
      });
    }
  });

  admin.callbackQuery(/^adm:sup:pend:reopen:(\d+)$/, async (ctx) => {
    if (!(await guardCatalogAdmin(ctx))) return;
    const pendingId = Number(ctx.match![1]);
    const result = await supplierPendingImportService.reopenPending(pendingId);
    await ctx.answerCallbackQuery({ text: result.message, show_alert: !result.ok });
    if (result.ok) {
      await presentPendingList(ctx, "PENDING", 0);
      return;
    }
    const row = await prisma.supplierPendingImport.findUnique({ where: { id: pendingId } });
    if (row) {
      const summary = await buildPendingImportSummaryHtml(row);
      await safeEdit(ctx, summary, {
        parse_mode: "HTML",
        reply_markup: pendingImportActionKeyboard(row.id, row.status),
      });
    }
  });

  admin.callbackQuery(/^adm:sup:pend:margin:(\d+)$/, async (ctx) => {
    if (!(await guardCatalogAdmin(ctx))) return;
    await ctx.answerCallbackQuery();
    const pendingId = Number(ctx.match![1]);
    ctx.session.adminTargetId = pendingId;
    try {
      await ctx.conversation.exitAll();
    } catch {
      /* ignore */
    }
    await ctx.conversation.enter("setPendingImportMargin", pendingId);
  });

  admin.callbackQuery(/^adm:sup:pend:accept:(\d+)$/, async (ctx) => {
    if (!(await guardCatalogAdmin(ctx))) return;
    await ctx.answerCallbackQuery();
    const pendingId = Number(ctx.match![1]);
    const row = await prisma.supplierPendingImport.findUnique({ where: { id: pendingId } });
    if (!row || row.status !== SupplierPendingImportStatus.PENDING) {
      await safeEdit(ctx, "⚠️ این درخواست قبلاً بررسی شده است.", adminSuppliersKeyboard());
      return;
    }

    const categories = await catalogService.listActiveCategories();
    await safeEdit(
      ctx,
      [
        "📂 <b>انتخاب دسته‌بندی</b>",
        "",
        `محصول: <b>${formatPendingDisplayName(row.displayName).replace(/</g, "&lt;")}</b>`,
        "",
        "دسته‌بندی فروشگاه را انتخاب کنید:",
      ].join("\n"),
      {
        parse_mode: "HTML",
        reply_markup: pendingCategoryKeyboard(pendingId, categories),
      },
    );
  });

  admin.callbackQuery(/^adm:sup:pend:cat:(\d+):(\d+)$/, async (ctx) => {
    if (!(await guardCatalogAdmin(ctx))) return;
    await ctx.answerCallbackQuery();
    const pendingId = Number(ctx.match![1]);
    const categoryId = Number(ctx.match![2]);

    const subs = await catalogService.listSubCategoriesByCategory(categoryId, true);
    if (subs.length === 0) {
      const draft = await supplierPendingImportService.savePlacementDraft(
        pendingId,
        categoryId,
        null,
      );
      if (!draft.ok) {
        await ctx.answerCallbackQuery({ text: draft.message, show_alert: true });
        return;
      }
      await presentPlacementConfirm(ctx, pendingId);
      return;
    }

    await presentSubCategoryPicker(ctx, pendingId, categoryId);
  });

  admin.callbackQuery(/^adm:sup:pend:catadd:(\d+)$/, async (ctx) => {
    if (!(await guardCatalogAdmin(ctx))) return;
    await ctx.answerCallbackQuery();
    const pendingId = Number(ctx.match![1]);
    ctx.session.adminTargetId = pendingId;
    try {
      await ctx.conversation.exitAll();
    } catch {
      /* ignore */
    }
    await ctx.conversation.enter("pendingImportAddCategory", pendingId);
  });

  admin.callbackQuery(/^adm:sup:pend:subadd:(\d+):(\d+)$/, async (ctx) => {
    if (!(await guardCatalogAdmin(ctx))) return;
    await ctx.answerCallbackQuery();
    const pendingId = Number(ctx.match![1]);
    const categoryId = Number(ctx.match![2]);
    ctx.session.adminTargetId = pendingId;
    ctx.session.adminCmsCategoryId = categoryId;
    try {
      await ctx.conversation.exitAll();
    } catch {
      /* ignore */
    }
    await ctx.conversation.enter("pendingImportAddSubCategory", pendingId, categoryId);
  });

  admin.callbackQuery(/^adm:sup:pend:subbrand:(\d+):(\d+)$/, async (ctx) => {
    if (!(await guardCatalogAdmin(ctx))) return;
    await ctx.answerCallbackQuery();
    const pendingId = Number(ctx.match![1]);
    const categoryId = Number(ctx.match![2]);
    const row = await prisma.supplierPendingImport.findUnique({ where: { id: pendingId } });
    const suggested = row ? suggestPendingImportSubCategoryName(row) : null;
    if (!suggested) {
      await ctx.answerCallbackQuery({ text: "پیشنهادی موجود نیست.", show_alert: true });
      return;
    }

    const sub = await catalogService.createSubCategory({
      name: suggested,
      categoryId,
      isAdminManaged: true,
    });
    const draft = await supplierPendingImportService.savePlacementDraft(
      pendingId,
      categoryId,
      sub.id,
    );
    if (!draft.ok) {
      await ctx.answerCallbackQuery({ text: draft.message, show_alert: true });
      return;
    }
    await presentPlacementConfirm(ctx, pendingId);
  });

  admin.callbackQuery(/^adm:sup:pend:sub:(\d+):(\d+)$/, async (ctx) => {
    if (!(await guardCatalogAdmin(ctx))) return;
    await ctx.answerCallbackQuery();
    const pendingId = Number(ctx.match![1]);
    const subCategoryId = Number(ctx.match![2]);

    const sub = await prisma.subCategory.findUnique({
      where: { id: subCategoryId },
      select: { categoryId: true },
    });
    if (!sub) {
      await ctx.answerCallbackQuery({ text: "زیردسته نامعتبر است.", show_alert: true });
      return;
    }

    const draft = await supplierPendingImportService.savePlacementDraft(
      pendingId,
      sub.categoryId,
      subCategoryId,
    );
    if (!draft.ok) {
      await ctx.answerCallbackQuery({ text: draft.message, show_alert: true });
      return;
    }

    await presentPlacementConfirm(ctx, pendingId);
  });

  admin.callbackQuery(/^adm:sup:pend:confirm:(\d+)$/, async (ctx) => {
    if (!(await guardCatalogAdmin(ctx))) return;
    const pendingId = Number(ctx.match![1]);

    const result = await supplierPendingImportService.approveAndCreateProduct(
      pendingId,
      BigInt(ctx.from!.id),
    );
    await ctx.answerCallbackQuery({ text: result.message, show_alert: !result.ok });
    if (result.ok && result.productId) {
      await safeEdit(
        ctx,
        [
          "✅ <b>محصول به فروشگاه اضافه شد</b>",
          "",
          `شناسه محصول: <code>${result.productId}</code>`,
        ].join("\n"),
        { parse_mode: "HTML", reply_markup: adminSuppliersKeyboard() },
      );
    } else if (!result.ok) {
      await presentPlacementConfirm(ctx, pendingId);
    }
  });

  registerSupplierNameSyncAdmin(admin);
  bot.use(admin);
}
