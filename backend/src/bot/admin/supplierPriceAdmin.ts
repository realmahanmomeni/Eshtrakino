import { InlineKeyboard } from "grammy";
import type { BotContext, EshtrakinoConversation, SessionContext } from "../context";
import { formatToman } from "../../lib/money";
import { Callbacks } from "../keyboards/callbacks";
import { safeEdit } from "../utils/safeEdit";
import { adminCatalogKeyboard } from "./keyboards";
import {
  applyMarginPricingToProduct,
  buildMarginPriceBreakdown,
  updateProductProfitMargin,
} from "../../services/catalog/profitMarginService";
import { canbosoSyncService } from "../../services/suppliers/CanbosoSyncService";
import { ensurePanel, panelFromCtx, waitTextOnPanel, type PanelRef } from "../conversations/wait";
import { prisma } from "../../lib/prisma";

export function supplierMarginPriceKeyboard(productId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("✏️ تغییر درصد سود", Callbacks.adminMarginEdit(productId))
    .row()
    .text("🔄 استعلام زنده تامین‌کننده", Callbacks.adminMarginLive(productId))
    .row()
    .text("🔙 بازگشت به محصول", Callbacks.adminViewProduct(productId));
}

export function marginSavedKeyboard(productId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("✏️ تغییر درصد سود", Callbacks.adminMarginEdit(productId))
    .row()
    .text("🔄 استعلام زنده تامین‌کننده", Callbacks.adminMarginLive(productId))
    .row()
    .text("🔙 بازگشت به تنظیمات محصول", Callbacks.adminViewProduct(productId));
}

export async function buildSupplierMarginSummaryHtml(productId: number): Promise<string | null> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { category: true, subCategory: true },
  });
  if (!product) return null;

  await applyMarginPricingToProduct(productId);

  const working =
    (await prisma.product.findUnique({
      where: { id: productId },
      include: { category: true, subCategory: true },
    })) ?? product;

  const breakdown = await buildMarginPriceBreakdown(working);
  const safeName = working.name.replace(/</g, "&lt;").replace(/>/g, "&gt;");

  if (!breakdown || breakdown.supplierCostUsd <= 0) {
    return [
      "📊 <b>تنظیم قیمت و حاشیه سود</b>",
      "",
      `📦 محصول: <b>${safeName}</b>`,
      "",
      "⚠️ هنوز قیمت خرید تامین‌کننده ثبت نشده است.",
      "از «استعلام زنده تامین‌کننده» استفاده کنید.",
    ].join("\n");
  }

  return [
    "📊 <b>تنظیم قیمت و حاشیه سود</b>",
    "",
    `📦 محصول: <b>${safeName}</b>`,
    `💵 قیمت خرید از تامین‌کننده: <b>$${breakdown.supplierCostUsd.toFixed(4)}</b>`,
    `📈 درصد سود فعلی: <b>${breakdown.marginPercent}%</b>`,
    `🏷 قیمت فروش دلاری: <b>$${breakdown.sellingUsd.toFixed(4)}</b>`,
    `💳 قیمت فروش تومانی: <b>${formatToman(breakdown.sellingToman)}</b>`,
    `🔄 نرخ روز تتر: <b>${Math.round(breakdown.usdRateIrt).toLocaleString("en-US")}</b> تومان`,
  ].join("\n");
}

/** @deprecated Use buildSupplierMarginSummaryHtml */
export async function buildSupplierMarginSummary(productId: number): Promise<string | null> {
  const html = await buildSupplierMarginSummaryHtml(productId);
  if (!html) return null;
  return html
    .replace(/<b>/g, "*")
    .replace(/<\/b>/g, "*")
    .replace(/<[^>]+>/g, "");
}

export async function presentSupplierMarginPricePanel(
  ctx: BotContext,
  productId: number,
): Promise<void> {
  const summary = await buildSupplierMarginSummaryHtml(productId);
  if (!summary) {
    await safeEdit(ctx, "⚠️ محصول یافت نشد.", adminCatalogKeyboard());
    return;
  }

  await safeEdit(ctx, summary, {
    parse_mode: "HTML",
    reply_markup: supplierMarginPriceKeyboard(productId),
  });
}

/**
 * Bulk sync (one HTTP call) → re-read DB → re-edit admin message.
 */
export async function refreshSupplierMarginAndPresentPanel(
  ctx: BotContext,
  productId: number,
): Promise<{ ok: boolean }> {
  await canbosoSyncService.syncAllSupplierProductsBulk({ forceRefresh: true });

  const updatedProduct = await prisma.product.findUnique({
    where: { id: productId },
    include: { category: true, subCategory: true },
  });
  if (!updatedProduct) {
    return { ok: false };
  }

  await applyMarginPricingToProduct(productId);

  const summary = await buildSupplierMarginSummaryHtml(productId);
  if (!summary) {
    return { ok: false };
  }

  await safeEdit(ctx, summary, {
    parse_mode: "HTML",
    reply_markup: supplierMarginPriceKeyboard(productId),
  });

  const hasCost =
    updatedProduct.supplierCostUsd != null && updatedProduct.supplierCostUsd > 0;
  return { ok: hasCost };
}

export async function setProductProfitMarginConversation(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
  productIdFromEnter?: number,
): Promise<void> {
  const productId =
    productIdFromEnter ??
    (await conversation.external((c) => c.session?.adminTargetId));

  if (!productId || !Number.isFinite(productId)) {
    await ctx.reply("⚠️ محصولی انتخاب نشده است. لطفاً از کارت محصول دوباره تلاش کنید.");
    return;
  }

  let panel: PanelRef | null = panelFromCtx(ctx);
  let prompt = [
    "✏️ <b>تغییر درصد سود</b>",
    "",
    "لطفاً درصد سود جدید را فقط به صورت عدد انگلیسی وارد کنید (مثال: 20 برای ۲۰٪ سود):",
    "",
    "▫️ برای انصراف /cancel را ارسال کنید.",
  ].join("\n");

  while (true) {
    const input = await waitTextOnPanel(
      conversation,
      ctx,
      prompt,
      panel,
      { parse_mode: "HTML" },
    );
    panel = input.panel;

    if (!input.text) {
      await presentMarginPanelOnRef(conversation, ctx, productId, panel);
      return;
    }

    const normalized = input.text.replace(/[۰-۹]/g, (d) =>
      String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)),
    );
    const value = Number(normalized.replace(/,/g, "."));
    if (!Number.isFinite(value) || value <= 0) {
      prompt = [
        "⚠️ عدد نامعتبر.",
        "",
        "لطفاً درصد سود جدید را فقط به صورت عدد انگلیسی وارد کنید (مثال: 20):",
        "",
        "▫️ برای انصراف /cancel را ارسال کنید.",
      ].join("\n");
      continue;
    }

    await conversation.external(async () => {
      await updateProductProfitMargin(productId, value);
    });

    const confirmation = await conversation.external(async () => {
      const updated = await prisma.product.findUnique({
        where: { id: productId },
        include: { subCategory: true, category: true },
      });
      if (!updated) return null;
      await applyMarginPricingToProduct(productId);
      const breakdown = await buildMarginPriceBreakdown(updated);
      if (!breakdown) return null;
      return {
        margin: value,
        breakdown,
        costUsd: updated.supplierCostUsd ?? breakdown.supplierCostUsd,
      };
    });

    if (confirmation) {
      const { breakdown, margin, costUsd } = confirmation;
      const card = [
        `✅ درصد سود با موفقیت به <b>${margin}%</b> تغییر یافت.`,
        "",
        `💵 قیمت خرید: <b>$${costUsd.toFixed(4)}</b>`,
        `🏷 قیمت فروش دلاری: <b>$${breakdown.sellingUsd.toFixed(4)}</b>`,
        `💳 قیمت فروش تومانی: <b>${Math.round(breakdown.sellingToman).toLocaleString("fa-IR")}</b> تومان`,
      ].join("\n");

      panel = await ensurePanel(
        ctx,
        card,
        marginSavedKeyboard(productId),
        panel,
        { parse_mode: "HTML" },
      );
    }
    return;
  }
}

async function presentMarginPanelOnRef(
  conversation: EshtrakinoConversation,
  ctx: SessionContext,
  productId: number,
  panel: PanelRef | null,
): Promise<void> {
  const summary = await conversation.external(() => buildSupplierMarginSummaryHtml(productId));
  if (summary) {
    await ensurePanel(
      ctx,
      summary,
      supplierMarginPriceKeyboard(productId),
      panel,
      { parse_mode: "HTML" },
    );
  }
}
