import type { Api } from "grammy";
import { InlineKeyboard } from "grammy";
import { InvoiceStatus, SupplierOrderStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { formatToman } from "../../lib/money";
import { groupLogger } from "../logger/GroupLogger";
import { walletService } from "../wallet/WalletService";
import { canbosoAdapter } from "./adapters/CanbosoAdapter";
import { CANBOSO_SUPPLIER_NAME, canbosoSyncService } from "./CanbosoSyncService";
import { Callbacks } from "../../bot/keyboards/callbacks";
import { SupplierError } from "./SupplierAdapter";
import { SupplierManager } from "./SupplierManager";
import { isInternalEshtrakinoFulfillment } from "../catalog/catalogAvailability";

function isCanbosoSupplierName(name: string): boolean {
  return /canboso|کنبوسو/i.test(name);
}

export function formatCanbosoDeliveryText(deliveryPayload: string): string {
  try {
    const parsed = JSON.parse(deliveryPayload) as unknown;
    if (typeof parsed === "string") return parsed;
    const record =
      parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    if (record?.text && typeof record.text === "string") return record.text;
    if (record?.credentials && typeof record.credentials === "string") {
      return record.credentials;
    }
  } catch {
    /* plain text payload */
  }
  return deliveryPayload;
}

export class CanbosoDispatchService {
  async isCanbosoMappedProduct(productId: number): Promise<boolean> {
    const mapping = await prisma.supplierProductMapping.findUnique({
      where: { productId },
      include: { supplier: true, product: { include: { category: true, subCategory: true } } },
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
        product: { include: { category: true, subCategory: true } },
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

    const kb = new InlineKeyboard()
      .text("🚀 تایید شارژ و ارسال خودکار", Callbacks.adminDispatchOrder(invoiceId))
      .row()
      .text("❌ لغو و بازگشت به کیف پول", Callbacks.adminCancelSupplierOrder(invoiceId));

    const text = [
      "📦 *سفارش جدید تامین‌کننده (اشتراکینو)*",
      "",
      `▫️ شناسه سفارش: \`#INV-${invoiceId}\``,
      `▫️ محصول: *${invoice.product.name}*`,
      `▫️ هزینه تامین: *${supplierCost}*`,
      `▫️ موجودی فعلی تامین‌کننده: *${currentBalance}*`,
      `▫️ کاربر: \`${invoice.user.telegramId.toString()}\``,
      "",
      "⚠️ در صورت نیاز کیف‌پول تامین‌کننده را شارژ کرده و سپس دکمه ارسال را بزنید.",
    ].join("\n");

    await groupLogger.logCanbosoDispatchRequest(api, text, kb);
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

      const credentials = formatCanbosoDeliveryText(result.deliveryPayload);
      await api.sendMessage(
        order.invoice.user.telegramId.toString(),
        ["✅ *سفارش شما تحویل داده شد:*", "", credentials].join("\n"),
        { parse_mode: "Markdown" },
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
