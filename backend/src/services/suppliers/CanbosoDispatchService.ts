import type { Api } from "grammy";
import { InvoiceStatus, SupplierOrderStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { formatToman } from "../../lib/money";
import { supplierOrderAlertService } from "./SupplierOrderAlertService";
import { walletService } from "../wallet/WalletService";
import { canbosoAdapter } from "./adapters/CanbosoAdapter";
import { CANBOSO_SUPPLIER_NAME, canbosoSyncService } from "./CanbosoSyncService";
import { SupplierError } from "./SupplierAdapter";
import { SupplierManager } from "./SupplierManager";
import { isInternalEshtrakinoFulfillment } from "../catalog/catalogAvailability";
import { resolveStoredCanbosoDeliveryHtml } from "../fulfillment/canbosoDeliveryFormat";
import { deliverProductToCustomer } from "../fulfillment/customerDeliveryMessage";

function isCanbosoSupplierName(name: string): boolean {
  return /canboso|کنبوسو/i.test(name);
}

/** @deprecated Use resolveStoredCanbosoDeliveryHtml + VIP template instead. */
export function formatCanbosoDeliveryText(deliveryPayload: string): string {
  return resolveStoredCanbosoDeliveryHtml(deliveryPayload);
}

export class CanbosoDispatchService {
  async isCanbosoMappedProduct(productId: number): Promise<boolean> {
    const mapping = await prisma.supplierProductMapping.findUnique({
      where: { productId },
      include: {
        supplier: true,
        product: {
          include: {
            category: true,
            subCategory: true,
            supplierProductMapping: true,
          },
        },
      },
    });
    if (!mapping?.product) return false;
    if (isInternalEshtrakinoFulfillment(mapping.product)) return false;
    return Boolean(
      mapping.isAutoPurchase &&
        mapping.supplier.isActive &&
        isCanbosoSupplierName(mapping.supplier.name),
    );
  }

  async queueAdminDispatch(api: Api, invoiceId: number, productId: number): Promise<boolean> {
    const mapping = await prisma.supplierProductMapping.findUnique({
      where: { productId },
      include: { supplier: true, product: true },
    });

    if (!mapping?.isAutoPurchase || !mapping.supplier.isActive) {
      return false;
    }

    if (!isCanbosoSupplierName(mapping.supplier.name)) {
      return false;
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        user: true,
        product: {
          include: {
            category: true,
            subCategory: true,
            supplierProductMapping: true,
          },
        },
      },
    });
    if (!invoice || !invoice.product) return false;
    if (isInternalEshtrakinoFulfillment(invoice.product)) return false;

    const { supplierId, apiKeyId } = await canbosoSyncService.ensureSupplierAndKey();

    const existing = await prisma.supplierOrder.findUnique({
      where: { internalInvoiceId: invoiceId },
    });
    if (existing) {
      if (
        existing.status === SupplierOrderStatus.COMPLETED ||
        existing.status === SupplierOrderStatus.SUCCESS
      ) {
        return true;
      }
      if (existing.status === SupplierOrderStatus.PENDING_ADMIN_DISPATCH) {
        await this.sendDispatchRequest(api, invoiceId);
        return true;
      }
      if (existing.status === SupplierOrderStatus.PENDING_MANUAL_DELIVERY) {
        return true;
      }
    }

    await prisma.supplierOrder.upsert({
      where: { internalInvoiceId: invoiceId },
      create: {
        internalInvoiceId: invoiceId,
        supplierId,
        apiKeyId,
        status: SupplierOrderStatus.PENDING_ADMIN_DISPATCH,
      },
      update: {
        status: SupplierOrderStatus.PENDING_ADMIN_DISPATCH,
        errorMessage: null,
      },
    });

    await api.sendMessage(
      invoice.user.telegramId.toString(),
      [
        "✅ پرداخت شما تایید شد.",
        "",
        "📦 سفارش شما در صف تحویل اشتراکینو قرار گرفت.",
        "پس از تایید مدیر، اطلاعات محصول برای شما ارسال می‌شود.",
      ].join("\n"),
    );

    await this.sendDispatchRequest(api, invoiceId);
    return true;
  }

  private async sendDispatchRequest(api: Api, invoiceId: number): Promise<void> {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { user: true, product: true, supplierOrder: true },
    });
    if (!invoice?.product) return;

    const mapping = await prisma.supplierProductMapping.findUnique({
      where: { productId: invoice.productId! },
      include: { supplier: true },
    });
    if (!mapping) return;

    let supplierCost = "—";
    let currentBalance = "—";
    try {
      const remote = await canbosoAdapter.getProductDetails(
        canbosoAdapter.resolveApiKey(),
        mapping.supplierProductKey,
      );
      if (remote?.variants[0]?.price != null) {
        supplierCost = formatToman(remote.variants[0].price);
      }
      const bal = await canbosoAdapter.getBalance();
      currentBalance = `${Math.round(bal.balance).toLocaleString("en-US")} تومان`;
    } catch (err) {
      console.warn("[CanbosoDispatch] Could not fetch live cost/balance:", err);
    }

    const priorError = invoice.supplierOrder?.errorMessage?.trim();
    const textLines = [
      "📦 *سفارش جدید تامین‌کننده (اشتراکینو)*",
      "",
      `▫️ شناسه سفارش: \`#INV-${invoiceId}\``,
      `▫️ محصول: *${invoice.product.name}*`,
      `▫️ هزینه تامین: *${supplierCost}*`,
      `▫️ موجودی فعلی تامین‌کننده: *${currentBalance}*`,
      `▫️ کاربر: \`${invoice.user.telegramId.toString()}\``,
    ];
    if (priorError) {
      textLines.push("", `❌ *آخرین خطای Canboso:* ${priorError}`);
    }
    textLines.push(
      "",
      "⚠️ در صورت نیاز کیف‌پول تامین‌کننده را شارژ کرده و سپس دکمه ارسال را بزنید.",
    );
    const text = textLines.join("\n");

    await supplierOrderAlertService.publishOpenOrderAlert(api, invoiceId, text);
  }

  async executeDispatch(
    api: Api,
    invoiceId: number,
    editAdminMessage?: (text: string) => Promise<void>,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const order = await prisma.supplierOrder.findUnique({
      where: { internalInvoiceId: invoiceId },
      include: {
        invoice: { include: { user: true, product: true } },
        apiKey: true,
        supplier: true,
      },
    });

    if (!order?.invoice?.product) {
      return { ok: false, message: "سفارش یا فاکتور یافت نشد." };
    }

    if (
      order.status === SupplierOrderStatus.COMPLETED ||
      order.status === SupplierOrderStatus.SUCCESS
    ) {
      return { ok: false, message: "این سفارش قبلاً پردازش شده است." };
    }

    if (order.status === SupplierOrderStatus.PENDING_MANUAL_DELIVERY) {
      return {
        ok: false,
        message: "این سفارش در صف تحویل دستی است. از دکمه «ارسال لینک / اکانت» استفاده کنید.",
      };
    }

    const claim = await prisma.supplierOrder.updateMany({
      where: {
        id: order.id,
        status: SupplierOrderStatus.PENDING_ADMIN_DISPATCH,
      },
      data: { status: SupplierOrderStatus.PENDING },
    });

    if (claim.count === 0) {
      return { ok: false, message: "سفارش در حال پردازش است یا قبلاً ارسال شده." };
    }

    const mapping = await prisma.supplierProductMapping.findUnique({
      where: { productId: order.invoice.productId! },
    });
    if (!mapping) {
      await this.reopenDispatch(order.id, "نگاشت محصول یافت نشد.");
      return { ok: false, message: "نگاشت تامین‌کننده برای محصول یافت نشد." };
    }

    try {
      const userInputData =
        order.invoice.userInputData && typeof order.invoice.userInputData === "object"
          ? (order.invoice.userInputData as Record<string, string>)
          : undefined;

      const plainKey = SupplierManager.decryptKey(order.apiKey.encryptedKey);
      const result = await canbosoAdapter.purchase(plainKey, mapping, undefined, {
        internalInvoiceId: order.internalInvoiceId,
        userInputData,
      });

      if (result.isProcessing) {
        await prisma.supplierOrder.update({
          where: { id: order.id },
          data: {
            status: SupplierOrderStatus.PENDING,
            supplierOrderId: result.supplierOrderId,
            costAmount: result.costAmount,
            deliveryPayload: result.deliveryPayload,
            errorMessage: result.status ?? "processing",
          },
        });

        await api.sendMessage(
          order.invoice.user.telegramId.toString(),
          [
            "⏳ *سفارش شما ثبت شد*",
            "",
            "تامین‌کننده در حال پردازش سفارش است. پس از آماده شدن، اطلاعات برای شما ارسال می‌شود.",
          ].join("\n"),
          { parse_mode: "Markdown" },
        );

        const processingText = "⏳ سفارش در صف پردازش تامین‌کننده است.";
        if (editAdminMessage) {
          await editAdminMessage(processingText);
        }
        return { ok: true };
      }

      await prisma.supplierOrder.update({
        where: { id: order.id },
        data: {
          status: SupplierOrderStatus.COMPLETED,
          supplierOrderId: result.supplierOrderId,
          costAmount: result.costAmount,
          deliveryPayload: result.deliveryPayload,
          errorMessage: null,
        },
      });

      const deliveryContentHtml = resolveStoredCanbosoDeliveryHtml(result.deliveryPayload);
      await deliverProductToCustomer(
        api,
        order.invoice.user.telegramId.toString(),
        {
          productName: order.invoice.product.name,
          invoiceId: order.internalInvoiceId,
          durationDays: order.invoice.product.durationDays,
          deliveryContentHtml,
        },
      );

      const successText = "✅ با موفقیت خریداری و به مشتری تحویل شد.";
      if (editAdminMessage) {
        await editAdminMessage(successText);
      }

      return { ok: true };
    } catch (err: unknown) {
      const message =
        err instanceof SupplierError
          ? err.message
          : err instanceof Error
            ? err.message
            : "خطای ناشناخته در خرید از تامین‌کننده";

      await this.reopenDispatch(order.id, message);
      return { ok: false, message };
    }
  }

  async cancelAndRefundWallet(
    api: Api,
    invoiceId: number,
    editAdminMessage?: (text: string) => Promise<void>,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { user: true, product: true, supplierOrder: true },
    });

    if (!invoice) {
      return { ok: false, message: "فاکتور یافت نشد." };
    }

    if (invoice.status !== InvoiceStatus.PAID) {
      return { ok: false, message: "فقط فاکتورهای پرداخت‌شده قابل لغو هستند." };
    }

    const order = invoice.supplierOrder;
    if (
      order &&
      (order.status === SupplierOrderStatus.COMPLETED ||
        order.status === SupplierOrderStatus.SUCCESS)
    ) {
      return { ok: false, message: "سفارش قبلاً تحویل داده شده و قابل لغو نیست." };
    }

    if (order?.status === SupplierOrderStatus.PENDING_MANUAL_DELIVERY) {
      await walletService.creditTopUp(
        invoice.userId,
        invoice.amount,
        `بازگشت وجه لغو تحویل دستی — فاکتور #${invoiceId}`,
      );
      await prisma.supplierOrder.update({
        where: { id: order.id },
        data: {
          status: SupplierOrderStatus.FAILED,
          errorMessage: "Cancelled by admin — manual delivery refunded",
        },
      });
      await api.sendMessage(
        invoice.user.telegramId.toString(),
        [
          "❌ *سفارش لغو شد*",
          "",
          `مبلغ *${formatToman(invoice.amount)}* به کیف پول شما بازگردانده شد.`,
        ].join("\n"),
        { parse_mode: "Markdown" },
      );
      if (editAdminMessage) {
        await editAdminMessage("❌ تحویل دستی لغو شد و مبلغ به کیف پول کاربر بازگشت.");
      }
      return { ok: true };
    }

    await walletService.creditTopUp(
      invoice.userId,
      invoice.amount,
      `بازگشت وجه لغو سفارش تامین‌کننده — فاکتور #${invoiceId}`,
    );

    if (order) {
      await prisma.supplierOrder.update({
        where: { id: order.id },
        data: {
          status: SupplierOrderStatus.FAILED,
          errorMessage: "Cancelled by admin — refunded to wallet",
        },
      });
    }

    await api.sendMessage(
      invoice.user.telegramId.toString(),
      [
        "❌ *سفارش لغو شد*",
        "",
        `مبلغ *${formatToman(invoice.amount)}* به کیف پول شما بازگردانده شد.`,
        "",
        "در صورت نیاز می‌توانید مجدداً از فروشگاه خرید کنید.",
      ].join("\n"),
      { parse_mode: "Markdown" },
    );

    if (editAdminMessage) {
      await editAdminMessage("❌ سفارش لغو شد و مبلغ به کیف پول کاربر بازگشت.");
    }

    return { ok: true };
  }

  private async reopenDispatch(orderId: number, errorMessage: string): Promise<void> {
    await prisma.supplierOrder.update({
      where: { id: orderId },
      data: {
        status: SupplierOrderStatus.PENDING_ADMIN_DISPATCH,
        errorMessage,
      },
    });
  }
}

export const canbosoDispatchService = new CanbosoDispatchService();
