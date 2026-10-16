import { Composer } from "grammy";
import type { BotContext } from "../context";
import { safeEdit } from "../utils/safeEdit";
import { adminSuppliersKeyboard } from "./keyboards";
import { guardCatalogAdmin } from "./supplierPendingAdmin";
import { InlineKeyboard } from "grammy";
import {
  applySupplierNameSyncProposals,
  buildSupplierNameSyncProposals,
  type SupplierNameSyncProposal,
} from "../../services/suppliers/supplierNameSyncService";

const PREVIEW_LIMIT = 25;

function formatPreview(proposals: SupplierNameSyncProposal[]): string {
  const lines = proposals.slice(0, PREVIEW_LIMIT).map(
    (p, i) =>
      `${i + 1}. <b>#${p.productId}</b>\n   ${escapeHtml(p.currentName)} → <b>${escapeHtml(p.proposedName)}</b>`,
  );
  const more =
    proposals.length > PREVIEW_LIMIT
      ? `\n… و ${proposals.length - PREVIEW_LIMIT} مورد دیگر`
      : "";
  return lines.join("\n") + more;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function registerSupplierNameSyncAdmin(admin: Composer<BotContext>): void {
  admin.callbackQuery("adm:sup:syncnames", async (ctx) => {
    if (!(await guardCatalogAdmin(ctx))) return;
    await ctx.answerCallbackQuery({ text: "در حال دریافت از کنبوسo…" });

    const { proposals, error } = await buildSupplierNameSyncProposals();
    if (error) {
      await safeEdit(ctx, `⚠️ ${error}`, adminSuppliersKeyboard());
      return;
    }

    ctx.session.supplierNameSyncIds = proposals.map((p) => p.productId);

    if (proposals.length === 0) {
      await safeEdit(
        ctx,
        "✅ همه نام‌های نگاشت‌شده با پیشنهاد کوتاه فعلی هم‌خوان هستند؛ تغییری لازم نیست.",
        adminSuppliersKeyboard(),
      );
      return;
    }

    const kb = new InlineKeyboard()
      .text("✅ اعمال تغییرات", "adm:sup:syncnames:apply")
      .row()
      .text("❌ انصراف", "adm:sup:syncnames:cancel")
      .row()
      .text("🔙 بازگشت", "adm:suppliers");

    await safeEdit(
      ctx,
      [
        "🏷 <b>همگام‌سازی نام‌ها از کنبوسo</b>",
        "",
        `تعداد پیشنهاد: <b>${proposals.length}</b>`,
        "",
        formatPreview(proposals),
        "",
        "نام کامل تامین‌کننده در توضیحات محصول باقی می‌ماند. فقط عنوان نمایشی فروشگاه به‌روز می‌شود.",
      ].join("\n"),
      { parse_mode: "HTML", reply_markup: kb },
    );
  });

  admin.callbackQuery("adm:sup:syncnames:cancel", async (ctx) => {
    if (!(await guardCatalogAdmin(ctx))) return;
    await ctx.answerCallbackQuery();
    ctx.session.supplierNameSyncIds = undefined;
    await safeEdit(
      ctx,
      "🔗 *مدیریت تامین‌کنندگان*\n\nیکی از گزینه‌های زیر را انتخاب کنید:",
      adminSuppliersKeyboard(),
    );
  });

  admin.callbackQuery("adm:sup:syncnames:apply", async (ctx) => {
    if (!(await guardCatalogAdmin(ctx))) return;
    await ctx.answerCallbackQuery({ text: "در حال اعمال…" });

    const { proposals, error } = await buildSupplierNameSyncProposals();
    if (error) {
      await safeEdit(ctx, `⚠️ ${error}`, adminSuppliersKeyboard());
      return;
    }

    const allowedIds = new Set(ctx.session.supplierNameSyncIds ?? []);
    const toApply =
      allowedIds.size > 0
        ? proposals.filter((p) => allowedIds.has(p.productId))
        : proposals;

    const updated = await applySupplierNameSyncProposals(toApply);
    ctx.session.supplierNameSyncIds = undefined;

    await safeEdit(
      ctx,
      [
        "✅ <b>همگام‌سازی نام‌ها انجام شد</b>",
        "",
        `تعداد به‌روزرسانی: <b>${updated}</b> از <b>${toApply.length}</b> پیشنهاد`,
      ].join("\n"),
      { parse_mode: "HTML", reply_markup: adminSuppliersKeyboard() },
    );
  });
}
