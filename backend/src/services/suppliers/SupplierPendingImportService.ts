import {
  DeliveryType,
  Prisma,
  SupplierPendingImportStatus,
  type SupplierPendingImport,
} from "@prisma/client";
import type { Api } from "grammy";
import { prisma } from "../../lib/prisma";
import { getCatalogAdminTelegramIds } from "../../lib/catalogAdminNotify";
import { shortenSupplierProductName } from "../catalog/shortenSupplierProductName";
import { convertUsdToToman } from "../exchangeRateService";
import { exchangeRateService } from "../exchangeRateService";
import {
  applyMarginPricingToProduct,
  computeSellingUsd,
  getDefaultProfitMarginPercent,
} from "../catalog/profitMarginService";
import { sanitizeCustomerCatalogText } from "../../bot/utils/catalogUi";
import type { CanbosoCatalogProduct } from "./adapters/CanbosoAdapter";
import {
  requiresAdminApprovalBeforeImport,
  supplierKeysFromRemote,
} from "./supplierImportClassification";
import { supplierCostUsdFromRemote } from "./canbosoCost";
import { QUANTUM_SUPPLIER_NAME } from "./quantumvault/quantumCatalog";
import { InlineKeyboard } from "grammy";
import { sendMessageThrottled } from "../../lib/telegramSend";
import {
  isolateEmbeddedLatin,
  normalizeArabicToPersianChars,
} from "../../lib/telegramLabel";

export type PendingImportNotifyContext = {
  api: Api;
};

function escapeHtml(text: string): string {
  return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function formatPendingDisplayName(name: string): string {
  return isolateEmbeddedLatin(normalizeArabicToPersianChars(name));
}

function parseNotifiedAdminIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export const PENDING_LIST_PAGE_SIZE = 8;

export async function buildPendingImportSummaryHtml(
  row: SupplierPendingImport,
): Promise<string> {
  const margin =
    row.profitMarginPercent ??
    (await getDefaultProfitMarginPercent());
  const sellingUsd = computeSellingUsd(row.supplierCostUsd, margin);
  const usdRate = await exchangeRateService.getUsdToTomanRate();
  const sellingToman = convertUsdToToman(sellingUsd, usdRate);
  const safeName = escapeHtml(formatPendingDisplayName(row.displayName));
  const supplier = await prisma.supplier.findUnique({
    where: { id: row.supplierId },
    select: { name: true },
  });
  const supplierName = escapeHtml(supplier?.name ?? "تامین‌کننده");
  const folderLine = row.remoteFolder?.trim()
    ? [`📁 پوشه تامین‌کننده: <b>${escapeHtml(row.remoteFolder.trim())}</b>`]
    : [];
  const statusLabel =
    row.status === SupplierPendingImportStatus.PENDING
      ? "⏳ در انتظار بررسی"
      : row.status === SupplierPendingImportStatus.REJECTED
        ? "🚫 رد شده"
        : "✅ تایید شده";

  return [
    `🆕 <b>محصول جدید از تامین‌کننده (${supplierName})</b>`,
    "",
    `📦 نام: <b>${safeName}</b>`,
    `🏭 تامین‌کننده: <b>${supplierName}</b>`,
    ...folderLine,
    `💵 قیمت خرید: <b>$${row.supplierCostUsd.toFixed(4)}</b>`,
    `📈 درصد سود: <b>${margin}%</b>`,
    `🏷 قیمت فروش: <b>$${sellingUsd.toFixed(4)}</b> — <b>${Math.round(sellingToman).toLocaleString("fa-IR")}</b> تومان`,
    `📊 وضعیت: ${statusLabel}`,
  ].join("\n");
}

export function pendingImportActionKeyboard(
  pendingId: number,
  status: SupplierPendingImportStatus,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (status === SupplierPendingImportStatus.PENDING) {
    kb.text("✅ افزودن به فروشگاه", `adm:sup:pend:accept:${pendingId}`).row();
    kb.text("✏️ ویرایش قیمت", `adm:sup:pend:margin:${pendingId}`).row();
    kb.text("❌ نادیده گرفتن", `adm:sup:pend:reject:${pendingId}`).row();
  }
  if (status === SupplierPendingImportStatus.REJECTED) {
    kb.text("↩️ بازگرداندن به انتظار", `adm:sup:pend:reopen:${pendingId}`).row();
  }
  const listFilter =
    status === SupplierPendingImportStatus.REJECTED ? "REJECTED" : "PENDING";
  kb.text("🔙 بازگشت", `adm:sup:pend:list:${listFilter}:0`).row();
  return kb;
}

export function pendingImportConfirmKeyboard(pendingId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ تایید", `adm:sup:pend:confirm:${pendingId}`)
    .row()
    .text("✏️ ویرایش قیمت", `adm:sup:pend:margin:${pendingId}`)
    .row()
    .text("🔙 بازگشت", `adm:sup:pend:accept:${pendingId}`)
    .row();
}

export async function buildPendingPlacementConfirmHtml(
  row: SupplierPendingImport,
): Promise<string | null> {
  if (row.categoryId == null) return null;

  const category = await prisma.category.findUnique({ where: { id: row.categoryId } });
  if (!category) return null;

  let subName: string | null = null;
  if (row.subCategoryId != null) {
    const sub = await prisma.subCategory.findUnique({ where: { id: row.subCategoryId } });
    subName = sub?.name ?? null;
  }

  const margin =
    row.profitMarginPercent ?? (await getDefaultProfitMarginPercent());
  const sellingUsd = computeSellingUsd(row.supplierCostUsd, margin);
  const usdRate = await exchangeRateService.getUsdToTomanRate();
  const sellingToman = convertUsdToToman(sellingUsd, usdRate);
  const safeName = escapeHtml(formatPendingDisplayName(row.displayName));
  const path = subName
    ? `${escapeHtml(category.name)} › ${escapeHtml(subName)}`
    : escapeHtml(category.name);

  const brandHint =
    row.brandName?.trim() ||
    row.displayName.split(/[|—–\-]/)[0]?.trim() ||
    "";
  const brandNorm = brandHint.replace(/\s+/g, " ").toLowerCase();
  const subNorm = (subName ?? "").replace(/\s+/g, " ").toLowerCase();
  const brandMismatch =
    brandNorm.length >= 3 && subName != null && !subNorm.includes(brandNorm.slice(0, Math.min(brandNorm.length, 8)));

  return [
    "📋 <b>تایید افزودن به فروشگاه</b>",
    "",
    `📦 محصول: <b>${safeName}</b>`,
    `📂 محل قرارگیری:`,
    `<b>${path}</b>`,
    ...(brandMismatch
      ? [
          "",
          "⚠️ <b>هشدار:</b> نام زیردسته با برند محصول هم‌خوانی ندارد. قبل از تایید، محل قرارگیری را دوباره بررسی کنید.",
        ]
      : []),
    `💵 قیمت خرید: <b>$${row.supplierCostUsd.toFixed(4)}</b>`,
    `📈 درصد سود: <b>${margin}%</b>`,
    `🏷 قیمت فروش: <b>$${sellingUsd.toFixed(4)}</b> — <b>${Math.round(sellingToman).toLocaleString("fa-IR")}</b> تومان`,
    "",
    "آیا محصول در فروشگاه منتشر شود؟",
  ].join("\n");
}

export class SupplierPendingImportService {
  /**
   * Queue brand-new supplier SKUs for admin review instead of auto-creating Product rows.
   */
  async queueNewSupplierProductsForReview(
    supplierId: number,
    remoteProducts: CanbosoCatalogProduct[],
    mappedKeys: ReadonlySet<string>,
    usdRate: number,
    notify?: PendingImportNotifyContext,
  ): Promise<number> {
    const mappedParentKeys = new Set(mappedKeys);
    let queued = 0;

    for (const remote of remoteProducts) {
      if (!requiresAdminApprovalBeforeImport(remote, mappedParentKeys)) {
        continue;
      }

      const { supplierProductKey, supplierVariantKey } = supplierKeysFromRemote(remote);

      const existingPending = await prisma.supplierPendingImport.findUnique({
        where: {
          supplierId_supplierProductKey_supplierVariantKey: {
            supplierId,
            supplierProductKey,
            supplierVariantKey,
          },
        },
      });

      if (existingPending) {
        if (
          existingPending.status === SupplierPendingImportStatus.PENDING ||
          existingPending.status === SupplierPendingImportStatus.REJECTED
        ) {
          await this.refreshPendingFromRemote(existingPending.id, remote, usdRate);
        }
        continue;
      }

      const supplierCostUsd = supplierCostUsdFromRemote(remote, usdRate);
      const displayName = shortenSupplierProductName(remote.name, {
        brandName: remote.brandName,
      });
      const description = remote.description?.trim()
        ? sanitizeCustomerCatalogText(remote.description).trim()
        : "تحویل دیجیتال از طریق اشتراکینو";

      const created = await prisma.supplierPendingImport.create({
        data: {
          supplierId,
          supplierProductKey,
          supplierVariantKey,
          displayName,
          brandName: remote.brandName ?? null,
          remoteFolder: remoteFolderFromCatalog(remote),
          supplierCostUsd,
          description,
          requiredFields: remote.requiredFields,
          stock: remote.stock ?? 0,
          isAvailable: remote.isAvailable,
          remoteSnapshot: remote.raw as object,
        },
      });

      queued += 1;
    }

    if (notify) {
      await this.flushPendingAdminNotifications(notify.api);
    }

    return queued;
  }

  async refreshPendingFromRemote(
    pendingId: number,
    remote: CanbosoCatalogProduct,
    usdRate: number,
  ): Promise<void> {
    const supplierCostUsd = supplierCostUsdFromRemote(remote, usdRate);
    const displayName = shortenSupplierProductName(remote.name, {
      brandName: remote.brandName,
    });
    await prisma.supplierPendingImport.update({
      where: { id: pendingId },
      data: {
        displayName,
        brandName: remote.brandName ?? null,
        remoteFolder: remoteFolderFromCatalog(remote),
        supplierCostUsd,
        stock: remote.stock ?? 0,
        isAvailable: remote.isAvailable,
        remoteSnapshot: remote.raw as object,
      },
    });
  }

  /** Deliver DMs for all PENDING imports missing any catalog admin recipient. */
  async flushPendingAdminNotifications(api: Api): Promise<void> {
    const rows = await prisma.supplierPendingImport.findMany({
      where: { status: SupplierPendingImportStatus.PENDING },
      include: { supplier: { select: { name: true } } },
      orderBy: { id: "asc" },
    });
    const adminIds = await getCatalogAdminTelegramIds();
    if (adminIds.length === 0) return;

    for (const row of rows) {
      // Quantum sends one summary or one batched message per sync, never one DM per SKU.
      if (row.supplier.name === QUANTUM_SUPPLIER_NAME) continue;
      await this.deliverPendingNotificationsToAdmins(api, row.id, adminIds);
    }
  }

  async deliverPendingNotificationsToAdmins(
    api: Api,
    pendingId: number,
    catalogAdminIds?: number[],
  ): Promise<void> {
    const row = await prisma.supplierPendingImport.findUnique({ where: { id: pendingId } });
    if (!row || row.status !== SupplierPendingImportStatus.PENDING) return;

    const targetAdmins = catalogAdminIds ?? (await getCatalogAdminTelegramIds());
    if (targetAdmins.length === 0) return;

    const already = new Set(parseNotifiedAdminIds(row.notifiedAdminIds));
    const text = await buildPendingImportSummaryHtml(row);
    const reply_markup = pendingImportActionKeyboard(row.id, row.status);

    const delivered = new Set(already);
    for (const adminId of targetAdmins) {
      if (delivered.has(adminId)) continue;
      const msg = await sendMessageThrottled(api, adminId, text, {
        parse_mode: "HTML",
        reply_markup,
      });
      if (msg) {
        delivered.add(adminId);
      }
    }

    const deliveredList = [...delivered];
    const allDone = targetAdmins.every((id) => delivered.has(id));

    await prisma.supplierPendingImport.update({
      where: { id: pendingId },
      data: {
        notifiedAdminIds: deliveredList,
        notifiedAt: allDone ? new Date() : null,
      },
    });
  }

  async savePlacementDraft(
    pendingId: number,
    categoryId: number,
    subCategoryId: number | null,
  ): Promise<{ ok: boolean; message: string }> {
    const pending = await prisma.supplierPendingImport.findUnique({ where: { id: pendingId } });
    if (!pending || pending.status !== SupplierPendingImportStatus.PENDING) {
      return { ok: false, message: "این درخواست قبلاً بررسی شده است." };
    }

    const category = await prisma.category.findFirst({
      where: { id: categoryId, isActive: true },
    });
    if (!category) {
      return { ok: false, message: "دسته‌بندی انتخاب‌شده معتبر نیست." };
    }

    if (subCategoryId != null) {
      const sub = await prisma.subCategory.findFirst({
        where: { id: subCategoryId, categoryId, isActive: true },
      });
      if (!sub) {
        return { ok: false, message: "زیردسته انتخاب‌شده معتبر نیست." };
      }
    } else {
      const subCount = await prisma.subCategory.count({
        where: { categoryId, isActive: true },
      });
      if (subCount > 0) {
        return { ok: false, message: "لطفاً یک زیردسته انتخاب کنید." };
      }
    }

    await prisma.supplierPendingImport.update({
      where: { id: pendingId },
      data: { categoryId, subCategoryId },
    });

    return { ok: true, message: "ok" };
  }

  async updatePendingMargin(pendingId: number, profitMarginPercent: number): Promise<SupplierPendingImport> {
    return prisma.supplierPendingImport.update({
      where: { id: pendingId },
      data: { profitMarginPercent },
    });
  }

  async reopenPending(
    pendingId: number,
  ): Promise<{ ok: boolean; message: string }> {
    const updated = await prisma.supplierPendingImport.updateMany({
      where: { id: pendingId, status: SupplierPendingImportStatus.REJECTED },
      data: {
        status: SupplierPendingImportStatus.PENDING,
        reviewedAt: null,
        reviewedByTelegramId: null,
      },
    });
    if (updated.count === 0) {
      return { ok: false, message: "فقط درخواست‌های رد‌شده قابل بازگردانی هستند." };
    }
    return { ok: true, message: "درخواست دوباره در صف انتظار قرار گرفت." };
  }

  async rejectPending(
    pendingId: number,
    reviewerTelegramId: bigint,
  ): Promise<{ ok: boolean; message: string }> {
    const updated = await prisma.supplierPendingImport.updateMany({
      where: { id: pendingId, status: SupplierPendingImportStatus.PENDING },
      data: {
        status: SupplierPendingImportStatus.REJECTED,
        reviewedAt: new Date(),
        reviewedByTelegramId: reviewerTelegramId,
      },
    });
    if (updated.count === 0) {
      return { ok: false, message: "این درخواست قبلاً بررسی شده است." };
    }
    return { ok: true, message: "محصول جدید نادیده گرفته شد." };
  }

  async approveAndCreateProduct(
    pendingId: number,
    reviewerTelegramId: bigint,
  ): Promise<{ ok: boolean; message: string; productId?: number }> {
    const pending = await prisma.supplierPendingImport.findUnique({
      where: { id: pendingId },
    });
    if (!pending || pending.status !== SupplierPendingImportStatus.PENDING) {
      return { ok: false, message: "این درخواست قبلاً بررسی شده است." };
    }

    if (pending.categoryId == null) {
      return { ok: false, message: "ابتدا دسته‌بندی و زیردسته را انتخاب کنید." };
    }

    const placement = {
      categoryId: pending.categoryId,
      subCategoryId: pending.subCategoryId,
    };

    const draft = await this.savePlacementDraft(
      pendingId,
      placement.categoryId,
      placement.subCategoryId,
    );
    if (!draft.ok) {
      return { ok: false, message: draft.message };
    }

    const usdRate = await exchangeRateService.getUsdToTomanRate();
    const margin =
      pending.profitMarginPercent ?? (await getDefaultProfitMarginPercent());

    const result = await prisma.$transaction(async (tx) => {
      const claim = await tx.supplierPendingImport.updateMany({
        where: { id: pendingId, status: SupplierPendingImportStatus.PENDING },
        data: {
          status: SupplierPendingImportStatus.APPROVED,
          reviewedAt: new Date(),
          reviewedByTelegramId: reviewerTelegramId,
          categoryId: placement.categoryId,
          subCategoryId: placement.subCategoryId,
        },
      });
      if (claim.count === 0) {
        return null;
      }

      const fresh = await tx.supplierPendingImport.findUnique({ where: { id: pendingId } });
      const displayName = shortenSupplierProductName(fresh?.displayName ?? pending.displayName, {
        brandName: fresh?.brandName ?? pending.brandName,
      });

      const product = await tx.product.create({
        data: {
          name: formatPendingDisplayName(displayName),
          price: convertUsdToToman(pending.supplierCostUsd, usdRate),
          currency: "USD",
          usdPrice: pending.supplierCostUsd,
          supplierCostUsd: pending.supplierCostUsd,
          profitMarginPercent: pending.profitMarginPercent,
          categoryId: placement.categoryId,
          subCategoryId: placement.subCategoryId,
          deliveryType: DeliveryType.SUPPLIER_AUTO,
          // `stock` is 0 both for a real zero and for an omitted count.
          // `isAvailable` is the supplier flag, so unknown-but-listed SKUs stay active.
          isActive: pending.isAvailable,
          hierarchyLocked: true,
          description: pending.description,
          requiredFields: pending.requiredFields as Prisma.InputJsonValue,
        },
      });

      await tx.supplierProductMapping.create({
        data: {
          productId: product.id,
          supplierId: pending.supplierId,
          supplierProductKey: pending.supplierProductKey,
          supplierVariantKey: pending.supplierVariantKey || null,
          supplierOfferGroup: offerGroupFromSnapshot(pending.remoteSnapshot),
          isAutoPurchase: true,
        },
      });

      await tx.supplierPendingImport.update({
        where: { id: pendingId },
        data: { productId: product.id },
      });

      return product.id;
    });

    if (result == null) {
      return { ok: false, message: "این درخواست قبلاً بررسی شده است." };
    }

    await applyMarginPricingToProduct(result);
    return {
      ok: true,
      message: "محصول با موفقیت به فروشگاه اضافه شد.",
      productId: result,
    };
  }

  /**
   * Approve every pending Quantum (or other) SKU in one remote folder into the
   * category stored on SupplierCategoryMapping.
   */
  async approvePendingFolder(
    mappingId: number,
    reviewerTelegramId: bigint,
  ): Promise<{ ok: boolean; message: string; approved: number }> {
    const mapping = await prisma.supplierCategoryMapping.findUnique({
      where: { id: mappingId },
      include: { category: true, subCategory: true },
    });
    if (!mapping || !mapping.category.isActive) {
      return { ok: false, message: "پیشنهاد دسته‌بندی این پوشه پیدا نشد.", approved: 0 };
    }

    if (mapping.subCategoryId == null) {
      const subCount = await prisma.subCategory.count({
        where: { categoryId: mapping.categoryId, isActive: true },
      });
      if (subCount > 0) {
        return {
          ok: false,
          message: "برای این پوشه زیردسته در جدول پیشنهاد ثبت نشده است.",
          approved: 0,
        };
      }
    }

    const rows = await prisma.supplierPendingImport.findMany({
      where: {
        supplierId: mapping.supplierId,
        status: SupplierPendingImportStatus.PENDING,
        remoteFolder: { equals: mapping.remoteFolder, mode: "insensitive" },
      },
      orderBy: { id: "asc" },
    });
    if (rows.length === 0) {
      return { ok: false, message: "محصول در انتظاری برای این پوشه نیست.", approved: 0 };
    }

    let approved = 0;
    for (const row of rows) {
      await prisma.supplierPendingImport.update({
        where: { id: row.id },
        data: {
          categoryId: mapping.categoryId,
          subCategoryId: mapping.subCategoryId,
        },
      });
      const result = await this.approveAndCreateProduct(row.id, reviewerTelegramId);
      if (result.ok) approved += 1;
    }

    return {
      ok: approved > 0,
      approved,
      message:
        approved > 0
          ? `${approved} محصول از پوشه «${mapping.remoteFolder}» به فروشگاه اضافه شد.`
          : "هیچ محصولی تایید نشد.",
    };
  }

  async getPendingMarginPercent(row: SupplierPendingImport): Promise<number> {
    if (
      row.profitMarginPercent != null &&
      Number.isFinite(row.profitMarginPercent) &&
      row.profitMarginPercent > 0
    ) {
      return row.profitMarginPercent;
    }
    return getDefaultProfitMarginPercent();
  }
}

function remoteFolderFromCatalog(remote: CanbosoCatalogProduct): string | null {
  if (!remote.raw || typeof remote.raw !== "object" || Array.isArray(remote.raw)) return null;
  const folder = (remote.raw as { folder?: unknown }).folder;
  if (typeof folder !== "string") return null;
  const trimmed = folder.trim();
  return trimmed ? trimmed.slice(0, 200) : null;
}

function offerGroupFromSnapshot(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const value = (snapshot as { offerGroup?: unknown }).offerGroup;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export const supplierPendingImportService = new SupplierPendingImportService();
