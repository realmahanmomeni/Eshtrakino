/**
 * E2E dry-run for Manual Fulfillment Fallback — no Canboso purchases, no persistent test rows.
 * Set E2E_MOCK_SUPPLIER_STOCK (0 / 5 / null) to simulate supplier inventory without HTTP.
 */
import type { Api } from "grammy";
import { InlineKeyboard } from "grammy";
import {
  DeliveryType,
  InvoiceStatus,
  SupplierOrderStatus,
  type Product,
} from "@prisma/client";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import {
  isProductOutOfStock,
  withOutOfStockPrefix,
} from "../services/catalog/catalogAvailability";
import { mapProductsAvailability } from "../services/catalog/shopAvailability";
import { verifyBeforeCheckout } from "../services/catalog/prePaymentGuardService";
import { fulfillmentService } from "../services/fulfillment/FulfillmentService";
import {
  manualFulfillmentService,
  shouldRoutePaidInvoiceToManualDelivery,
} from "../services/fulfillment/ManualFulfillmentService";
import { groupLogger } from "../services/logger/GroupLogger";
import { Callbacks } from "../bot/keyboards/callbacks";

const TEST_DELIVERY_LINK = "https://gemini.google.com/test-invite-link-e2e";

type StepOutcome = "SUCCESS" | "FAILED";

type CapturedMessage = {
  chatId: string;
  text: string;
  replyMarkup?: unknown;
};

const stepLines: Array<{ outcome: StepOutcome; label: string }> = [];

function recordStep(outcome: StepOutcome, label: string): void {
  stepLines.push({ outcome, label });
}

function callbackDataFromButton(btn: unknown): string | undefined {
  if (btn && typeof btn === "object" && "callback_data" in btn) {
    const data = (btn as { callback_data?: unknown }).callback_data;
    return typeof data === "string" ? data : undefined;
  }
  return undefined;
}

function extractManualDeliverCallback(markup: unknown): string | null {
  if (!markup) return null;
  let rows: unknown[][] | undefined;
  if (markup instanceof InlineKeyboard) {
    rows = markup.inline_keyboard as unknown[][];
  } else if (typeof markup === "object" && markup !== null && "inline_keyboard" in markup) {
    const raw = (markup as { inline_keyboard: unknown }).inline_keyboard;
    rows = Array.isArray(raw) ? (raw as unknown[][]) : undefined;
  }
  if (!rows) return null;
  for (const buttons of rows) {
    if (!Array.isArray(buttons)) continue;
    for (const btn of buttons) {
      const callbackData = callbackDataFromButton(btn);
      if (callbackData?.startsWith("adm:manual_deliver:")) {
        return callbackData;
      }
    }
  }
  return null;
}

function createCaptureApi(store: CapturedMessage[]): Api {
  return {
    sendMessage: async (
      chatId: string | number,
      text: string,
      extra?: { reply_markup?: unknown },
    ) => {
      store.push({
        chatId: String(chatId),
        text,
        replyMarkup: extra?.reply_markup,
      });
      return { message_id: Date.now() };
    },
  } as unknown as Api;
}

async function findTargetProduct(): Promise<
  Product & {
    supplierProductMapping: { id: number } | null;
    category: { name: string };
    subCategory: { name: string } | null;
  }
> {
  const gemini = await prisma.product.findFirst({
    where: {
      deliveryType: DeliveryType.SUPPLIER_AUTO,
      supplierProductMapping: { isNot: null },
      OR: [
        { name: { contains: "gemini", mode: "insensitive" } },
        { name: { contains: "جمینی", mode: "insensitive" } },
      ],
    },
    include: {
      supplierProductMapping: true,
      category: true,
      subCategory: true,
    },
  });
  if (gemini) return gemini;

  const anyMapped = await prisma.product.findFirst({
    where: {
      deliveryType: DeliveryType.SUPPLIER_AUTO,
      supplierProductMapping: { isNot: null },
    },
    include: {
      supplierProductMapping: true,
      category: true,
      subCategory: true,
    },
    orderBy: { id: "asc" },
  });
  if (!anyMapped) {
    throw new Error(
      "No SUPPLIER_AUTO product with supplier mapping found. Map a product first.",
    );
  }
  return anyMapped;
}

async function resolveTestUserId(): Promise<number> {
  for (const adminTgId of env.adminIds) {
    const user = await prisma.user.findFirst({
      where: { telegramId: BigInt(adminTgId) },
      select: { id: true },
    });
    if (user) return user.id;
  }
  const fallback = await prisma.user.findFirst({
    orderBy: { id: "asc" },
    select: { id: true },
  });
  if (!fallback) {
    throw new Error("No users in database — need at least one user for test invoice.");
  }
  return fallback.id;
}

async function run(): Promise<number> {
  process.env.E2E_MOCK_SUPPLIER_STOCK = "0";

  let testInvoiceId: number | null = null;
  let productId: number | null = null;
  let originalFallback: boolean | null = null;
  let originalIsActive: boolean | null = null;
  let cleanupDone = false;

  const telegramMessages: CapturedMessage[] = [];
  const adminAlertCaptures: Array<{ text: string; replyMarkup?: InlineKeyboard }> = [];

  const mockApi = createCaptureApi(telegramMessages);
  const origManualLog = groupLogger.logManualDeliveryRequest.bind(groupLogger);
  groupLogger.logManualDeliveryRequest = async (_api, text, replyMarkup) => {
    adminAlertCaptures.push({ text, replyMarkup });
  };

  try {
    // —— STEP 1 ——
    const product = await findTargetProduct();
    productId = product.id;
    originalFallback = product.forceManualFallback;
    originalIsActive = product.isActive;

    await prisma.product.update({
      where: { id: product.id },
      data: {
        forceManualFallback: true,
        isActive: false,
      },
    });

    const productForShop = await prisma.product.findUnique({ where: { id: product.id } });
    if (!productForShop) {
      throw new Error("Product missing after update");
    }

    const oos = await isProductOutOfStock(productForShop);
    const shopRows = await mapProductsAvailability([productForShop]);
    const shopRow = shopRows[0];
    const buttonLabel = withOutOfStockPrefix(productForShop.name, shopRow?.outOfStock ?? true);

    const step1Ok =
      oos === false &&
      shopRow?.outOfStock === false &&
      !buttonLabel.startsWith("❌");
    recordStep(
      step1Ok ? "SUCCESS" : "FAILED",
      "Step 1: Shop Visibility Override (OOS product shown as Active)",
    );
    if (!step1Ok) {
      throw new Error(
        `Shop still treats product as OOS (oos=${oos}, row=${JSON.stringify(shopRow)}, label=${buttonLabel})`,
      );
    }

    // —— STEP 2 ——
    const guard = await verifyBeforeCheckout(product.id);
    const step2Ok = guard.status !== "OUT_OF_STOCK";
    recordStep(
      step2Ok ? "SUCCESS" : "FAILED",
      "Step 2: Pre-Payment Guard Bypass Verified",
    );
    if (!step2Ok) {
      throw new Error(`Pre-payment guard blocked checkout: ${guard.status}`);
    }

    // —— STEP 3 ——
    const userId = await resolveTestUserId();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const invoice = await prisma.invoice.create({
      data: {
        userId,
        productId: product.id,
        status: InvoiceStatus.PAID,
        amount: product.price,
        expiresAt,
      },
    });
    testInvoiceId = invoice.id;

    telegramMessages.length = 0;
    adminAlertCaptures.length = 0;

    await fulfillmentService.processApprovedInvoice(mockApi, invoice.id);

    const step3Ok = telegramMessages.some((m) => m.text.includes("پرداخت شما تایید شد"));
    recordStep(
      step3Ok ? "SUCCESS" : "FAILED",
      "Step 3: Paid Invoice Triggered Fulfillment Engine",
    );
    if (!step3Ok) {
      throw new Error("Customer payment confirmation message was not sent");
    }

    // —— STEP 4 ——
    const supplierOrder = await prisma.supplierOrder.findUnique({
      where: { internalInvoiceId: invoice.id },
    });
    const expectedCb = Callbacks.adminManualDeliver(invoice.id);
    const adminCb =
      adminAlertCaptures.map((cap) => extractManualDeliverCallback(cap.replyMarkup)).find(Boolean) ??
      null;

    const step4Ok =
      supplierOrder?.status === SupplierOrderStatus.PENDING_MANUAL_DELIVERY &&
      adminCb === expectedCb;

    recordStep(
      step4Ok ? "SUCCESS" : "FAILED",
      "Step 4: Routed to PENDING_MANUAL_DELIVERY (Admin Alert Ready)",
    );
    if (!step4Ok) {
      throw new Error(
        `Routing mismatch order=${supplierOrder?.status} adminCb=${adminCb} expected=${expectedCb}`,
      );
    }

    // —— STEP 5 ——
    telegramMessages.length = 0;
    const deliveryResult = await manualFulfillmentService.completeManualDelivery(
      mockApi,
      invoice.id,
      TEST_DELIVERY_LINK,
    );
    const orderAfter = await prisma.supplierOrder.findUnique({
      where: { internalInvoiceId: invoice.id },
    });
    const customerMsg = telegramMessages.find((m) =>
      m.text.includes("محصول شما آماده"),
    );
    const step5Ok =
      deliveryResult.ok === true &&
      orderAfter?.status === SupplierOrderStatus.COMPLETED &&
      customerMsg != null &&
      customerMsg.text.includes(TEST_DELIVERY_LINK);

    recordStep(
      step5Ok ? "SUCCESS" : "FAILED",
      "Step 5: Admin Manual Link Delivered & Order Completed",
    );
    if (!step5Ok) {
      throw new Error("Manual delivery completion or customer payload failed");
    }

    // —— STEP 6 ——
    process.env.E2E_MOCK_SUPPLIER_STOCK = "5";
    const routeAfterRestock = await shouldRoutePaidInvoiceToManualDelivery(product.id);
    const step6Ok = routeAfterRestock === false;
    recordStep(
      step6Ok ? "SUCCESS" : "FAILED",
      "Step 6: Auto-Recovery on Restock Verified",
    );
    if (!step6Ok) {
      throw new Error("Expected auto SUPPLIER_AUTO routing after restock mock");
    }
  } catch (err) {
    if (stepLines.length < 6) {
      const labels = [
        "Step 1: Shop Visibility Override (OOS product shown as Active)",
        "Step 2: Pre-Payment Guard Bypass Verified",
        "Step 3: Paid Invoice Triggered Fulfillment Engine",
        "Step 4: Routed to PENDING_MANUAL_DELIVERY (Admin Alert Ready)",
        "Step 5: Admin Manual Link Delivered & Order Completed",
        "Step 6: Auto-Recovery on Restock Verified",
      ];
      for (let i = stepLines.length; i < 6; i++) {
        recordStep(
          "FAILED",
          labels[i] ?? `Step ${i + 1}`,
        );
      }
    }
    console.error(err instanceof Error ? err.message : err);
  } finally {
    groupLogger.logManualDeliveryRequest = origManualLog;
    delete process.env.E2E_MOCK_SUPPLIER_STOCK;

    if (testInvoiceId != null) {
      await prisma.productItem.deleteMany({ where: { invoiceId: testInvoiceId } }).catch(() => {});
      await prisma.supplierOrder
        .deleteMany({ where: { internalInvoiceId: testInvoiceId } })
        .catch(() => {});
      await prisma.invoice.delete({ where: { id: testInvoiceId } }).catch(() => {});
    }

    if (productId != null && originalFallback != null && originalIsActive != null) {
      await prisma.product
        .update({
          where: { id: productId },
          data: {
            forceManualFallback: originalFallback,
            isActive: originalIsActive,
          },
        })
        .catch(() => {});
    }

    cleanupDone = true;
  }

  console.log("\n==================================================");
  console.log("🚀 E2E MANUAL FALLBACK PIPELINE DIAGNOSTIC REPORT");
  console.log("==================================================");
  for (const line of stepLines) {
    console.log(`[${line.outcome}] ${line.label}`);
  }
  if (cleanupDone) {
    console.log("[CLEANUP] Temporary test invoice & order removed from DB.");
  }
  console.log("==================================================");

  const failed = stepLines.some((s) => s.outcome === "FAILED");
  if (!failed) {
    console.log("✅ OVERALL STATUS: E2E MANUAL FALLBACK FLOW IS 100% FUNCTIONAL");
  } else {
    console.log("❌ OVERALL STATUS: E2E MANUAL FALLBACK FLOW NEEDS ATTENTION");
  }
  console.log("==================================================\n");

  await prisma.$disconnect().catch(() => undefined);
  return failed ? 1 : 0;
}

run()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
