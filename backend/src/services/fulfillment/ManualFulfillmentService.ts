import type { Api } from "grammy";
import { DeliveryType, SupplierOrderStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { supplierOrderAlertService } from "../suppliers/SupplierOrderAlertService";
import {
  isInternalEshtrakinoFulfillment,
} from "../catalog/catalogAvailability";
import { fetchLiveSupplierStock } from "../catalog/profitMarginService";
import { canbosoSyncService } from "../suppliers/CanbosoSyncService";
import {
  deliverProductToCustomer,
  formatPlainTextDeliveryContentHtml,
  type CustomerDeliveryCopySource,
} from "./customerDeliveryMessage";

function formatTehranDate(date: Date): string {
  return date.toLocaleString("fa-IR", { timeZone: "Asia/Tehran" });
}

export async function isSupplierManualFallbackProduct(productId: number): Promise<boolean> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { forceManualFallback: true },
  });
  return product?.forceManualFallback === true;
}

export async function shouldRoutePaidInvoiceToManualDelivery(
  productId: number,
): Promise<boolean> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      category: true,
      subCategory: true,
      supplierProductMapping: true,
    },
  });
  if (!product?.supplierProductMapping) return false;
  if (product.deliveryType !== DeliveryType.SUPPLIER_AUTO) return false;
  if (isInternalEshtrakinoFulfillment(product)) return false;

  const stock = await fetchLiveSupplierStock(productId);
  if (stock != null && stock > 0) return false;
  if (stock == null && !product.forceManualFallback) return false;
  return true;
}

export class ManualFulfillmentService {
  async queuePendingManualDelivery(api: Api, invoiceId: number): Promise<boolean> {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        user: true,
        product: true,
        supplierOrder: true,
      },
    });
    if (!invoice?.product) return false;

    const { supplierId, apiKeyId } = await canbosoSyncService.ensureSupplierAndKey();

    const existing = invoice.supplierOrder;
    if (
      existing &&
      (existing.status === SupplierOrderStatus.COMPLETED ||
        existing.status === SupplierOrderStatus.SUCCESS)
    ) {
      return true;
    }

    if (existing?.status === SupplierOrderStatus.PENDING_MANUAL_DELIVERY) {
      await this.notifyAdminsManualDelivery(api, invoiceId);
      return true;
    }

    await prisma.supplierOrder.upsert({
      where: { internalInvoiceId: invoiceId },
      create: {
        internalInvoiceId: invoiceId,
        supplierId,
        apiKeyId,
        status: SupplierOrderStatus.PENDING_MANUAL_DELIVERY,
        errorMessage: "Supplier out of stock — awaiting admin manual delivery",
      },
      update: {
        status: SupplierOrderStatus.PENDING_MANUAL_DELIVERY,
        errorMessage: "Supplier out of stock — awaiting admin manual delivery",
      },
    });

    await api.sendMessage(
      invoice.user.telegramId.toString(),
      [
        "✅ پرداخت شما تایید شد.",
        "",
        "📦 سفارش شما ثبت شد.",
        "به دلیل محدودیت موقت تامین‌کننده، تحویل توسط تیم اشتراکینو انجام می‌شود و به زودی اطلاعات محصول برای شما ارسال خواهد شد.",
      ].join("\n"),
    );

    await this.notifyAdminsManualDelivery(api, invoiceId);
    return true;
  }

  async notifyAdminsManualDelivery(api: Api, invoiceId: number): Promise<void> {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { user: true, product: true },
    });
    if (!invoice?.product) return;

    const text = [
      "🚨 *سفارش نیازمند تحویل دستی (تامین‌کننده ناموجود)*",
      "",
      `👤 کاربر: \`${invoice.user.telegramId.toString()}\``,
      `📦 محصول: *${invoice.product.name}*`,
      `🧾 شماره فاکتور: \`#${invoice.id}\``,
      `⏰ تاریخ: ${formatTehranDate(invoice.createdAt)}`,
      "",
      "لطفاً محصول را از منبع دیگر تهیه کرده و لینک/اطلاعات تحویل را ارسال کنید.",
    ].join("\n");

    await supplierOrderAlertService.publishOpenOrderAlert(api, invoiceId, text);
  }

  async completeManualDelivery(
    api: Api,
    invoiceId: number,
    deliveryText: string,
    options?: {
      editAdminMessage?: (text: string) => Promise<void>;
      copyMessageFrom?: CustomerDeliveryCopySource;
    },
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const trimmed = deliveryText.trim();
    if (!trimmed) {
      return { ok: false, message: "متن تحویل خالی است." };
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { user: true, product: true, supplierOrder: true, productItem: true },
    });

    if (!invoice?.product) {
      return { ok: false, message: "فاکتور یا محصول یافت نشد." };
    }

    const order = invoice.supplierOrder;
    if (
      order &&
      (order.status === SupplierOrderStatus.COMPLETED ||
        order.status === SupplierOrderStatus.SUCCESS)
    ) {
      return { ok: false, message: "این سفارش قبلاً تحویل داده شده است." };
    }

    if (!invoice.productItem) {
      await prisma.productItem.create({
        data: {
          productId: invoice.productId!,
          content: trimmed,
          isSold: true,
          invoiceId: invoice.id,
        },
      });
    } else {
      await prisma.productItem.update({
        where: { id: invoice.productItem.id },
        data: { content: trimmed, isSold: true },
      });
    }

    if (order) {
      await prisma.supplierOrder.update({
        where: { id: order.id },
        data: {
          status: SupplierOrderStatus.COMPLETED,
          deliveryPayload: trimmed,
          errorMessage: null,
        },
      });
    }

    const deliveryContentHtml = formatPlainTextDeliveryContentHtml(trimmed);
    await deliverProductToCustomer(
      api,
      invoice.user.telegramId.toString(),
      {
        productName: invoice.product.name,
        invoiceId: invoice.id,
        durationDays: invoice.product.durationDays,
        deliveryContentHtml,
      },
      options?.copyMessageFrom ? { copyMessageFrom: options.copyMessageFrom } : undefined,
    );

    if (options?.editAdminMessage) {
      await options.editAdminMessage("✅ تحویل دستی انجام شد توسط ادمین.");
    }

    return { ok: true };
  }

  /**
   * Close the supplier order when the customer was already fulfilled outside the bot
   * (e.g. support DM). Does not message the customer.
   */
  async markAsDeliveredWithoutCustomerMessage(
    invoiceId: number,
    options?: { editAdminMessage?: (text: string) => Promise<void> },
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { product: true, supplierOrder: true, productItem: true },
    });

    if (!invoice?.product) {
      return { ok: false, message: "فاکتور یا محصول یافت نشد." };
    }

    const order = invoice.supplierOrder;
    if (
      order &&
      (order.status === SupplierOrderStatus.COMPLETED ||
        order.status === SupplierOrderStatus.SUCCESS)
    ) {
      return { ok: false, message: "این سفارش قبلاً تحویل داده شده است." };
    }

    const note = "تحویل خارج از ربات — ثبت شده توسط ادمین (بدون پیام مجدد به مشتری)";

    if (!invoice.productItem) {
      await prisma.productItem.create({
        data: {
          productId: invoice.productId!,
          content: note,
          isSold: true,
          invoiceId: invoice.id,
        },
      });
    }

    if (order) {
      await prisma.supplierOrder.update({
        where: { id: order.id },
        data: {
          status: SupplierOrderStatus.COMPLETED,
          deliveryPayload: note,
          errorMessage: null,
        },
      });
    }

    if (options?.editAdminMessage) {
      await options.editAdminMessage("✅ سفارش به‌عنوان تحویل‌شده ثبت شد (بدون پیام به مشتری).");
    }

    return { ok: true };
  }

  /**
   * Toggle forceManualFallback.
   * ON  → keep product active (sellable; OOS orders go to manual delivery).
   * OFF → re-check live supplier stock; if OOS/unavailable, deactivate immediately
   *       so the product is hidden from customer lists until restocked.
   */
  async toggleProductManualFallback(productId: number): Promise<boolean> {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { supplierProductMapping: true },
    });
    if (!product?.supplierProductMapping) {
      throw new Error("Only supplier-mapped products support manual fallback.");
    }

    const next = !product.forceManualFallback;
    if (next) {
      await prisma.product.update({
        where: { id: productId },
        data: { forceManualFallback: true, isActive: true },
      });
      console.log(
        `[ManualFallback] Product #${productId} fallback ON — kept/forced active`,
      );
      return true;
    }

    const stock = await fetchLiveSupplierStock(productId);
    const inStock = stock != null && stock > 0;
    await prisma.product.update({
      where: { id: productId },
      data: {
        forceManualFallback: false,
        isActive: inStock,
      },
    });
    console.log(
      `[ManualFallback] Product #${productId} fallback OFF — ` +
        (inStock
          ? `supplier stock=${stock}, left active`
          : `supplier OOS/unavailable (stock=${stock ?? "null"}), deactivated`),
    );
    return false;
  }
}

export const manualFulfillmentService = new ManualFulfillmentService();
