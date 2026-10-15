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
  buildPendingImportSummaryHtml,
  pendingImportActionKeyboard,
  supplierPendingImportService,
} from "../../services/suppliers/SupplierPendingImportService";
import { emojiForLabel } from "../keyboards/grid";
import { ensurePanel, panelFromCtx, waitTextOnPanel, type PanelRef } from "../conversations/wait";
async function guardCatalogAdmin(ctx: BotContext): Promise<boolean> {
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

function pendingCategoryKeyboard(pendingId: number, categories: Array<{ id: number; name: string }>): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const c of categories) {
    const label = `${emojiForLabel(c.name)} ${c.name}`;
    kb.text(label.length > 64 ? `${label.slice(0, 61)}…` : label, `adm:sup:pend:cat:${pendingId}:${c.id}`).row();
  }
  kb.text("🔙 بازگشت", `adm:sup:pend:v:${pendingId}`).row();
  return kb;
}

function pendingSubCategoryKeyboard(
  pendingId: number,
  categoryId: number,
  subs: Array<{ id: number; name: string }>,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const s of subs) {
    const label = `🔹 ${s.name}`;
    kb.text(label.length > 64 ? `${label.slice(0, 61)}…` : label, `adm:sup:pend:sub:${pendingId}:${s.id}`).row();
  }
  kb.text("🔙 بازگشت", `adm:sup:pend:accept:${pendingId}`).row();
  return kb;
}

async function presentPendingList(ctx: BotContext): Promise<void> {
  const rows = await prisma.supplierPendingImport.findMany({
    where: {
      status: { in: [SupplierPendingImportStatus.PENDING, SupplierPendingImportStatus.REJECTED] },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  if (rows.length === 0) {
    await safeEdit(
      ctx,
      [
        "📥 *محصولات جدید تامین‌کننده*",
        "",
        "در حال حاضر مورد در انتظار یا رد‌شده‌ای وجود ندارد.",
      ].join("\n"),
      adminSuppliersKeyboard(),
    );
    return;
  }

  const kb = new InlineKeyboard();
  for (const row of rows) {
    const icon =
      row.status === SupplierPendingImportStatus.PENDING ? "⏳" : "🚫";
    const label = `${icon} ${row.displayName}`.slice(0, 60);
    kb.text(label, `adm:sup:pend:v:${row.id}`).row();
  }
  kb.text("🔙 بازگشت", "adm:suppliers").row();

  await safeEdit(
    ctx,
    [
      "📥 *محصولات جدید تامین‌کننده*",
      "",
      "موارد زیر از سینک Canboso آمده‌اند و هنوز در فروشگاه نیستند:",
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
    "درصد سود را به صورت عدد انگلیسی وارد کنید (مثال: 20):",
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

    const normalized = input.text.replace(/[۰-۹]/g, (d) =>
      String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)),
    );
    const value = Number(normalized.replace(/,/g, "."));
    if (!Number.isFinite(value) || value <= 0) {
      prompt = "⚠️ عدد نامعتبر. لطفاً درصد سود مثبت وارد کنید:";
      continue;
    }

    const row = await conversation.external(async () => {
      await supplierPendingImportService.updatePendingMargin(pendingId, value);
      return prisma.supplierPendingImport.findUnique({ where: { id: pendingId } });
    });

    if (!row) {
      await ctx.reply("⚠️ درخواست یافت نشد.");
      return;
    }

    const summary = await conversation.external(() => buildPendingImportSummaryHtml(row));
    await ensurePanel(
      ctx,
      [`✅ درصد سود به <b>${value}%</b> تنظیم شد.`, "", summary].join("\n"),
      pendingImportActionKeyboard(row.id, row.status),
      panel,
      { parse_mode: "HTML" },
    );
    return;
  }
}

export function registerSupplierPendingImportAdmin(bot: Bot<BotContext>): void {
  const admin = new Composer<BotContext>();
  bot.use(createConversation(setPendingImportMarginConversation, "setPendingImportMargin"));

  admin.callbackQuery("adm:sup:pending", async (ctx) => {
    if (!(await guardCatalogAdmin(ctx))) return;
    await ctx.answerCallbackQuery();
    await presentPendingList(ctx);
  });

  admin.callbackQuery("adm:sup:pend:list", async (ctx) => {
    if (!(await guardCatalogAdmin(ctx))) return;
    await ctx.answerCallbackQuery();
    await presentPendingList(ctx);
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
        `محصول: <b>${row.displayName.replace(/</g, "&lt;")}</b>`,
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
      const result = await supplierPendingImportService.approveAndCreateProduct(
        pendingId,
        categoryId,
        null,
        BigInt(ctx.from!.id),
      );
      await ctx.answerCallbackQuery({ text: result.message, show_alert: true });
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
      }
      return;
    }

    await safeEdit(
      ctx,
      [
        "📁 <b>انتخاب زیردسته / سرویس</b>",
        "",
        "زیردسته مناسب را انتخاب کنید:",
      ].join("\n"),
      {
        parse_mode: "HTML",
        reply_markup: pendingSubCategoryKeyboard(pendingId, categoryId, subs),
      },
    );
  });

  admin.callbackQuery(/^adm:sup:pend:sub:(\d+):(\d+)$/, async (ctx) => {
    if (!(await guardCatalogAdmin(ctx))) return;
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

    const result = await supplierPendingImportService.approveAndCreateProduct(
      pendingId,
      sub.categoryId,
      subCategoryId,
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
    }
  });

  bot.use(admin);
}
