import {
  DeliveryType,
  Prisma,
  SupplierPendingImportStatus,
  type SupplierPendingImport,
} from "@prisma/client";
import type { Api } from "grammy";
import { prisma } from "../../lib/prisma";
import { getCatalogAdminTelegramIds } from "../../lib/catalogAdminNotify";
import { polishCustomerProductTitle } from "../catalog/productTitlePolish";
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
import { InlineKeyboard } from "grammy";

export type PendingImportNotifyContext = {
  api: Api;
};

function escapeHtml(text: string): string {
  return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function buildPendingImportSummaryHtml(
  row: SupplierPendingImport,
): Promise<string> {
  const margin =
    row.profitMarginPercent ??
    (await getDefaultProfitMarginPercent());
  const sellingUsd = computeSellingUsd(row.supplierCostUsd, margin);
  const usdRate = await exchangeRateService.getUsdToTomanRate();
  const sellingToman = convertUsdToToman(sellingUsd, usdRate);
  const safeName = escapeHtml(row.displayName);
  const statusLabel =
    row.status === SupplierPendingImportStatus.PENDING
      ? "⏳ در انتظار بررسی"
      : row.status === SupplierPendingImportStatus.REJECTED
        ? "🚫 رد شده"
        : "✅ تایید شده";

  return [
    "🆕 <b>محصول جدید از تامین‌کننده (Canboso)</b>",
    "",
    `📦 نام: <b>${safeName}</b>`,
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
  kb.text("🔙 بازگشت", `adm:sup:pend:list`).row();
  return kb;
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
        if (
          existingPending.status === SupplierPendingImportStatus.PENDING &&
          existingPending.notifiedAt == null &&
          notify
        ) {
          await this.notifyAdminsOfPending(notify.api, existingPending.id);
        }
        continue;
      }

      const supplierCostUsd = supplierCostUsdFromRemote(remote, usdRate);
      const displayName = polishCustomerProductTitle(remote.brandName ?? remote.name);
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
          supplierCostUsd,
          description,
          requiredFields: remote.requiredFields,
          stock: remote.stock,
          isAvailable: remote.isAvailable,
          remoteSnapshot: remote.raw as object,
        },
      });

      queued += 1;
      if (notify) {
        await this.notifyAdminsOfPending(notify.api, created.id);
      }
    }

    return queued;
  }

  async refreshPendingFromRemote(
    pendingId: number,
    remote: CanbosoCatalogProduct,
    usdRate: number,
  ): Promise<void> {
    const supplierCostUsd = supplierCostUsdFromRemote(remote, usdRate);
    const displayName = polishCustomerProductTitle(remote.brandName ?? remote.name);
    await prisma.supplierPendingImport.update({
      where: { id: pendingId },
      data: {
        displayName,
        brandName: remote.brandName ?? null,
        supplierCostUsd,
        stock: remote.stock,
        isAvailable: remote.isAvailable,
        remoteSnapshot: remote.raw as object,
      },
    });
  }

  async notifyAdminsOfPending(api: Api, pendingId: number): Promise<void> {
    const row = await prisma.supplierPendingImport.findUnique({ where: { id: pendingId } });
    if (!row || row.status !== SupplierPendingImportStatus.PENDING) return;

    const text = await buildPendingImportSummaryHtml(row);
    const reply_markup = pendingImportActionKeyboard(row.id, row.status);

    const adminIds = await getCatalogAdminTelegramIds();
    for (const adminId of adminIds) {
      try {
        await api.sendMessage(adminId, text, {
          parse_mode: "HTML",
          reply_markup,
        });
      } catch {
        /* ignore blocked admins */
      }
    }

    await prisma.supplierPendingImport.update({
      where: { id: pendingId },
      data: { notifiedAt: new Date() },
    });
  }

  async updatePendingMargin(pendingId: number, profitMarginPercent: number): Promise<SupplierPendingImport> {
    return prisma.supplierPendingImport.update({
      where: { id: pendingId },
      data: { profitMarginPercent },
    });
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
    categoryId: number,
    subCategoryId: number | null,
    reviewerTelegramId: bigint,
  ): Promise<{ ok: boolean; message: string; productId?: number }> {
    const pending = await prisma.supplierPendingImport.findUnique({
      where: { id: pendingId },
    });
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
          categoryId,
          subCategoryId,
        },
      });
      if (claim.count === 0) {
        return null;
      }

      const product = await tx.product.create({
        data: {
          name: pending.displayName,
          price: convertUsdToToman(pending.supplierCostUsd, usdRate),
          currency: "USD",
          usdPrice: pending.supplierCostUsd,
          supplierCostUsd: pending.supplierCostUsd,
          profitMarginPercent: pending.profitMarginPercent,
          categoryId,
          subCategoryId,
          deliveryType: DeliveryType.SUPPLIER_AUTO,
          isActive: pending.stock > 0 && pending.isAvailable,
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

export const supplierPendingImportService = new SupplierPendingImportService();
