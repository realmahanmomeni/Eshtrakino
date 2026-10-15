import { InlineKeyboard } from "grammy";
import type { BotContext } from "../context";
import { safeEdit } from "../utils/safeEdit";
import { adminSuppliersKeyboard } from "./keyboards";
import { catalogService } from "../../services/catalog/CatalogService";
import { prisma } from "../../lib/prisma";
import {
  buildPendingPlacementConfirmHtml,
  formatPendingDisplayName,
  pendingImportConfirmKeyboard,
  supplierPendingImportService,
} from "../../services/suppliers/SupplierPendingImportService";
import { SupplierPendingImportStatus } from "@prisma/client";
import { emojiForLabel } from "../keyboards/grid";
import { truncateInlineButtonLabel } from "../../lib/telegramLabel";
import { suggestPendingImportSubCategoryName } from "../../services/suppliers/pendingImportBrandName";

export function pendingCategoryKeyboard(
  pendingId: number,
  categories: Array<{ id: number; name: string }>,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const c of categories) {
    const label = truncateInlineButtonLabel(`${emojiForLabel(c.name)} ${c.name}`);
    kb.text(label, `adm:sup:pend:cat:${pendingId}:${c.id}`).row();
  }
  kb.text("➕ دسته جدید", `adm:sup:pend:catadd:${pendingId}`).row();
  kb.text("🔙 بازگشت", `adm:sup:pend:v:${pendingId}`).row();
  return kb;
}

export function pendingSubCategoryKeyboard(
  pendingId: number,
  categoryId: number,
  subs: Array<{ id: number; name: string }>,
  brandSuggestion: string | null,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (brandSuggestion) {
    const label = truncateInlineButtonLabel(`✨ ${brandSuggestion}`);
    kb.text(label, `adm:sup:pend:subbrand:${pendingId}:${categoryId}`).row();
  }
  for (const s of subs) {
    const label = truncateInlineButtonLabel(`🔹 ${s.name}`);
    kb.text(label, `adm:sup:pend:sub:${pendingId}:${s.id}`).row();
  }
  kb.text("➕ زیردسته جدید", `adm:sup:pend:subadd:${pendingId}:${categoryId}`).row();
  kb.text("🔙 بازگشت", `adm:sup:pend:accept:${pendingId}`).row();
  return kb;
}

export async function presentPlacementConfirm(ctx: BotContext, pendingId: number): Promise<void> {
  const row = await prisma.supplierPendingImport.findUnique({ where: { id: pendingId } });
  if (!row || row.status !== SupplierPendingImportStatus.PENDING) {
    await safeEdit(ctx, "⚠️ این درخواست قبلاً بررسی شده است.", adminSuppliersKeyboard());
    return;
  }
  const summary = await buildPendingPlacementConfirmHtml(row);
  if (!summary) {
    await safeEdit(ctx, "⚠️ ابتدا دسته‌بندی را انتخاب کنید.", adminSuppliersKeyboard());
    return;
  }
  await safeEdit(ctx, summary, {
    parse_mode: "HTML",
    reply_markup: pendingImportConfirmKeyboard(pendingId),
  });
}

export async function presentSubCategoryPicker(
  ctx: BotContext,
  pendingId: number,
  categoryId: number,
): Promise<void> {
  const row = await prisma.supplierPendingImport.findUnique({ where: { id: pendingId } });
  const subs = await catalogService.listSubCategoriesByCategory(categoryId, true);
  const brandSuggestion = row ? suggestPendingImportSubCategoryName(row) : null;

  await safeEdit(
    ctx,
    [
      "📁 <b>انتخاب زیردسته / سرویس</b>",
      "",
      brandSuggestion
        ? `پیشنهاد: <b>${formatPendingDisplayName(brandSuggestion).replace(/</g, "&lt;")}</b>`
        : "زیردسته مناسب را انتخاب کنید:",
    ].join("\n"),
    {
      parse_mode: "HTML",
      reply_markup: pendingSubCategoryKeyboard(pendingId, categoryId, subs, brandSuggestion),
    },
  );
}
