import type { Api } from "grammy";
import { DeliveryType } from "@prisma/client";
import { invoiceService } from "../invoices/InvoiceService";
import { inventoryService } from "../inventory/InventoryService";
import { groupLogger } from "../logger/GroupLogger";
import { prisma } from "../../lib/prisma";
import { formatToman } from "../../lib/money";
import { provideCredentialsKeyboard } from "../../bot/keyboards/builders";
import { discountService } from "../discount/DiscountService";

function resolveFulfillmentType(
  productDeliveryType: DeliveryType,
  deliveryPreference: string | null | undefined,
): "READY" | "MANUAL" | "CREDENTIALS_REQUIRED" {
  if (productDeliveryType !== DeliveryType.USER_CHOICE) {
    return productDeliveryType as "READY" | "MANUAL" | "CREDENTIALS_REQUIRED";
  }

  if (deliveryPreference === "READY") return DeliveryType.READY;
  if (deliveryPreference === "CREDENTIALS_REQUIRED") {
    return DeliveryType.CREDENTIALS_REQUIRED;
  }
  return DeliveryType.MANUAL;
}

export class FulfillmentService {
  async processApprovedInvoice(api: Api, invoiceId: number): Promise<void> {
    const invoice = await invoiceService.getById(invoiceId);
    if (!invoice || invoice.isWalletTopUp || !invoice.product) {
      return;
    }

    if ((invoice as any).discountCode) {
      await discountService.consumeDiscountCode((invoice as any).discountCode);
    }

    if (invoice.product.durationDays && invoice.product.durationDays > 0) {
      const subscriptionExpiresAt = new Date(
        Date.now() + invoice.product.durationDays * 24 * 60 * 60 * 1000,
      );
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          expiresAt: subscriptionExpiresAt,
          reminded5Days: false,
          remindedLastDay: false,
        },
      });
    }

    const tgId = invoice.user.telegramId.toString();
    const deliveryType = resolveFulfillmentType(
      invoice.product.deliveryType,
      invoice.deliveryPreference,
    );

    if (deliveryType === DeliveryType.READY) {
      const item = await inventoryService.claimForInvoice(invoice.productId!, invoice.id);

      if (item) {
        const remaining = await inventoryService.countAvailable(invoice.productId!);
        const threshold = invoice.product.lowStockThreshold;
        if (remaining === threshold) {
          await groupLogger
            .logLowStock(api, invoice.product.name, remaining)
            .catch(console.error);
        }

        await api.sendMessage(
          tgId,
          [
            "✅ پرداخت شما تایید شد.",
            "",
            "🔑 *اطلاعات محصول شما:*",
            "",
            `\`${item.content}\``,
          ].join("\n"),
          { parse_mode: "Markdown" },
        );
      } else {
        await api.sendMessage(
          tgId,
          "✅ پرداخت شما تایید شد اما متاسفانه موجودی انبار در این لحظه تمام شده است. ادمین به زودی سفارش شما را تحویل خواهد داد.",
        );
        await groupLogger
          .logOutOfStock(api, invoice.product.name, invoice.id)
          .catch(console.error);
      }
      return;
    }

    if (deliveryType === DeliveryType.CREDENTIALS_REQUIRED) {
      await api.sendMessage(
        tgId,
        [
          "✅ پرداخت شما تایید شد.",
          "",
          "⚠️ برای تکمیل سفارش، لطفاً روی دکمه زیر کلیک کنید و اطلاعات اکانت خود را وارد کنید.",
        ].join("\n"),
        {
          parse_mode: "Markdown",
          reply_markup: provideCredentialsKeyboard(invoice.id),
        },
      );
      return;
    }

    await api.sendMessage(
      tgId,
      [
        "✅ *پرداخت موفق*",
        "",
        `🧾 فاکتور: *#${invoice.id}*`,
        `📦 محصول: *${invoice.product.name}*`,
        `💵 مبلغ: *${formatToman(invoice.amount)}*`,
        `📊 وضعیت: *PAID*`,
        "",
        "پرداخت شما تایید شد و محصول آماده است.",
        "پشتیبانی به زودی برای تحویل با شما تماس می گیرد.",
      ].join("\n"),
      { parse_mode: "Markdown" },
    );
  }
}

export const fulfillmentService = new FulfillmentService();
