import test from "node:test";
import assert from "node:assert/strict";
import { DeliveryType } from "@prisma/client";
import { buildProductDetailPayload } from "../../../bot/utils/productDetailMessage";
import { customerTextLeaksSupplier, stripSupplierNames } from "../../../bot/utils/customerSupplierText";
import { formatCustomerDeliveryMessage } from "../../fulfillment/customerDeliveryMessage";
import { InvoiceService } from "../../invoices/InvoiceService";

const DIRTY = "پلن Canboso و QuantumVault و Quantum و کوانتوم";

test("customer catalog, product detail, invoice, and delivery never name a supplier", () => {
  const cleaned = stripSupplierNames(DIRTY);
  assert.equal(customerTextLeaksSupplier(cleaned), false);
  assert.match(cleaned, /اشتراکینو/);

  const detail = buildProductDetailPayload({
    product: { name: "ChatGPT Plus از Canboso", deliveryType: DeliveryType.SUPPLIER_AUTO },
    description: "توضیح QuantumVault برای پوشه Quantum. لینک https://example.com",
    effectivePrice: 250000,
  });
  assert.equal(customerTextLeaksSupplier(detail.captionHtml), false);
  assert.equal(customerTextLeaksSupplier(detail.fullDescription), false);
  assert.match(detail.captionHtml, /example\.com/);

  const delivery = formatCustomerDeliveryMessage({
    productName: "Outlook از Quantum",
    invoiceId: 18,
    deliveryContentHtml: "<code>user@example.com</code>",
  });
  assert.equal(customerTextLeaksSupplier(delivery), false);
  assert.match(delivery, /user@example\.com/);
  assert.doesNotMatch(delivery, /Canboso|Quantum|کوانتوم/);

  const invoiceLabel = new InvoiceService().invoiceLabel({
    isWalletTopUp: false,
    product: { name: "Capcut — QuantumVault" },
  });
  assert.equal(customerTextLeaksSupplier(invoiceLabel), false);
  assert.match(invoiceLabel, /اشتراکینو/);
});
