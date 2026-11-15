import type { Api } from "grammy";
import { SupplierOrderStatus } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { getCatalogAdminTelegramIds } from "../../../lib/catalogAdminNotify";
import { sendMessageThrottled } from "../../../lib/telegramSend";
import { isQuantumSupplierName } from "./quantumCatalog";

/**
 * Phase 1–2 must not call POST /purchase. A paid Quantum invoice is held for
 * an admin instead of falling through to SupplierManager.processAutoPurchase.
 */
export async function holdPaidQuantumInvoiceForAdmin(
  api: Api,
  invoiceId: number,
  productId: number,
): Promise<boolean> {
  const mapping = await prisma.supplierProductMapping.findUnique({
    where: { productId },
    include: { supplier: true },
  });
  if (!mapping || !isQuantumSupplierName(mapping.supplier.name)) return false;

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { user: true, product: true },
  });
  if (!invoice) return true;

  const apiKey = await prisma.supplierApiKey.findFirst({
    where: { supplierId: mapping.supplierId, isActive: true },
    orderBy: { id: "asc" },
  });

  if (apiKey) {
    const existing = await prisma.supplierOrder.findUnique({
      where: { internalInvoiceId: invoiceId },
    });
    const alreadyDelivered =
      existing?.status === SupplierOrderStatus.SUCCESS ||
      existing?.status === SupplierOrderStatus.COMPLETED;
    if (!alreadyDelivered) {
      await prisma.supplierOrder.upsert({
        where: { internalInvoiceId: invoiceId },
        create: {
          internalInvoiceId: invoiceId,
          supplierId: mapping.supplierId,
          apiKeyId: apiKey.id,
          status: SupplierOrderStatus.PENDING_MANUAL_DELIVERY,
          errorMessage: "Quantum auto-purchase is not enabled yet",
        },
        update: {
          supplierId: mapping.supplierId,
          apiKeyId: apiKey.id,
          status: SupplierOrderStatus.PENDING_MANUAL_DELIVERY,
          errorMessage: "Quantum auto-purchase is not enabled yet",
        },
      });
    }
  }

  await api.sendMessage(
    invoice.user.telegramId.toString(),
    [
      "✅ پرداخت شما تایید شد.",
      "",
      "📦 سفارش شما ثبت شد.",
      "تحویل توسط تیم اشتراکینو انجام می‌شود و به زودی اطلاعات محصول برای شما ارسال خواهد شد.",
    ].join("\n"),
  );

  const adminText = [
    "🚨 سفارش Quantum در انتظار تحویل دستی",
    "",
    "خرید خودکار Quantum هنوز فعال نیست.",
    `فاکتور: #${invoice.id}`,
    `محصول: ${invoice.product?.name ?? mapping.supplierProductKey}`,
    `کاربر: ${invoice.user.telegramId.toString()}`,
  ].join("\n");

  for (const adminId of await getCatalogAdminTelegramIds()) {
    await sendMessageThrottled(api, adminId, adminText).catch((error) => {
      console.error("[Quantum] admin hold notify failed:", error);
    });
  }

  return true;
}
