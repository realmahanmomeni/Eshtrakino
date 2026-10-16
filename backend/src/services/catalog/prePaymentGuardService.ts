import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "../../lib/prisma";
import { formatToman } from "../../lib/money";
import { isInternalEshtrakinoFulfillment, isProductOutOfStock } from "./catalogAvailability";
import { isStarsCatalog } from "./starsPricingService";
import {
  applyMarginPricingToProduct,
  fetchLiveSupplierCostUsd,
  fetchLiveSupplierStock,
  isMarginPricedProduct,
  getEffectiveTomanFromMargin,
} from "./profitMarginService";
import { lazyCacheService } from "./LazyCacheService";
import { invoiceService } from "../invoices/InvoiceService";

const COST_EPS_USD = 0.0005;

export type PrePaymentGuardResult =
  | { status: "OK" }
  | { status: "OUT_OF_STOCK" }
  | {
      status: "PRICE_CHANGED";
      oldPriceToman: number;
      newPriceToman: number;
      invoiceId?: number;
      productId?: number;
      message: string;
    }
  | { status: "SKIP" };

function needsSupplierLiveCheck(product: {
  name: string;
  supplierProductMapping?: { id: number } | null;
  category?: { name: string } | null;
  subCategory?: { name: string } | null;
}): boolean {
  if (isStarsCatalog(product.name)) return false;
  if (product.category && isStarsCatalog(product.category.name)) return false;
  if (isInternalEshtrakinoFulfillment(product as Parameters<typeof isInternalEshtrakinoFulfillment>[0])) {
    return false;
  }
  return Boolean(product.supplierProductMapping);
}

export async function verifyBeforeCheckout(productId: number): Promise<PrePaymentGuardResult> {
  await lazyCacheService.refreshCatalogIfStale(false);
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      category: true,
      subCategory: true,
      supplierProductMapping: true,
    },
  });
  if (!product) return { status: "OUT_OF_STOCK" };

  if (!needsSupplierLiveCheck(product)) {
    if (await isProductOutOfStock(product)) return { status: "OUT_OF_STOCK" };
    return { status: "SKIP" };
  }

  return runLiveSupplierVerification(product.id, undefined);
}

export async function verifyBeforePayment(invoiceId: number): Promise<PrePaymentGuardResult> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      product: {
        include: {
          category: true,
          subCategory: true,
          supplierProductMapping: true,
        },
      },
    },
  });

  if (!invoice?.product) return { status: "OK" };

  if (!needsSupplierLiveCheck(invoice.product)) {
    if (await isProductOutOfStock(invoice.product)) return { status: "OUT_OF_STOCK" };
    return { status: "SKIP" };
  }

  const oldPriceToman = Math.round(Number(invoice.amount));
  const result = await runLiveSupplierVerification(invoice.product.id, invoiceId);
  if (result.status === "PRICE_CHANGED") {
    return result;
  }
  if (result.status === "OK") {
    const refreshed = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    const newAmt = refreshed ? Math.round(Number(refreshed.amount)) : oldPriceToman;
    if (newAmt !== oldPriceToman) {
      return {
        status: "PRICE_CHANGED",
        oldPriceToman,
        newPriceToman: newAmt,
        invoiceId,
        message: buildPriceChangedMessage(newAmt),
      };
    }
  }
  return result;
}

async function runLiveSupplierVerification(
  productId: number,
  invoiceId: number | undefined,
): Promise<PrePaymentGuardResult> {
  const stock = await fetchLiveSupplierStock(productId);
  if (stock != null && stock <= 0) {
    await prisma.product.update({
      where: { id: productId },
      data: { isActive: false },
    });
    return { status: "OUT_OF_STOCK" };
  }

  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { category: true, subCategory: true },
  });
  if (!product) return { status: "OUT_OF_STOCK" };

  const liveCost = await fetchLiveSupplierCostUsd(productId);
  if (liveCost == null || liveCost <= 0) {
    await lazyCacheService.markBothSynced();
    return { status: "OK" };
  }

  const previousCost = product.supplierCostUsd ?? 0;
  const costChanged =
    previousCost <= 0 || Math.abs(liveCost - previousCost) > COST_EPS_USD;

  if (costChanged) {
    await prisma.product.update({
      where: { id: productId },
      data: { supplierCostUsd: liveCost },
    });
    await applyMarginPricingToProduct(productId);
  }

  await lazyCacheService.markBothSynced();

  const updated = await prisma.product.findUnique({
    where: { id: productId },
    include: { category: true, subCategory: true },
  });
  if (!updated) return { status: "OK" };

  let newPriceToman: number;
  if (isMarginPricedProduct(updated)) {
    newPriceToman = (await getEffectiveTomanFromMargin(updated)) ?? Math.round(Number(updated.price));
  } else if (updated.usdPrice != null && updated.usdPrice > 0) {
    newPriceToman = Math.round(Number(updated.price));
  } else {
    newPriceToman = Math.round(Number(updated.price));
  }

  if (invoiceId != null && costChanged) {
    const inv = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    const oldPriceToman = inv ? Math.round(Number(inv.amount)) : newPriceToman;

    if (newPriceToman !== oldPriceToman) {
      await prisma.invoice.update({
        where: { id: invoiceId },
        data: { amount: new Decimal(newPriceToman) },
      });

      return {
        status: "PRICE_CHANGED",
        oldPriceToman,
        newPriceToman,
        invoiceId,
        message: buildPriceChangedMessage(newPriceToman),
      };
    }
  }

  if (invoiceId == null && costChanged) {
    return {
      status: "PRICE_CHANGED",
      oldPriceToman: Math.round(Number(product.price)),
      newPriceToman,
      productId,
      message: buildPriceChangedMessage(newPriceToman),
    };
  }

  return { status: "OK" };
}

function buildPriceChangedMessage(newPriceToman: number): string {
  return [
    "⚠️ قیمت این محصول توسط تامین‌کننده تغییر کرده است.",
    "",
    `مبلغ جدید: ${formatToman(newPriceToman)}`,
    "آیا مایل به ادامه پرداخت هستید؟",
  ].join("\n");
}

export async function cancelCheckoutState(userId: number, telegramSession?: {
  checkoutProductId?: number;
}): Promise<void> {
  if (telegramSession) {
    telegramSession.checkoutProductId = undefined;
  }
  try {
    await invoiceService.cancelInvoice(userId);
  } catch {
    /* no open invoice */
  }
}
