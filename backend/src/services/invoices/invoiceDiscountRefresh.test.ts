import test from "node:test";
import assert from "node:assert/strict";
import {
  computeDiscountBreakdownForBasePrice,
  computeDiscountedPayableAmount,
  invoiceHasAppliedDiscount,
} from "./InvoiceService";

const discountedInvoice16 = {
  amount: 529_280,
  discountCode: "PROMO36",
  discountPercent: 36,
  discountAmount: 297_720,
  originalAmount: 827_000,
};

test("36% discount on 827,000 base yields payable 529,280", () => {
  assert.equal(
    computeDiscountedPayableAmount(827_000, discountedInvoice16),
    529_280,
  );
});

test("unchanged FX base with discount does not require amount update", () => {
  const expected = computeDiscountedPayableAmount(827_000, discountedInvoice16);
  assert.equal(expected, Math.round(Number(discountedInvoice16.amount)));
});

test("invoiceHasAppliedDiscount detects applied code", () => {
  assert.equal(invoiceHasAppliedDiscount(discountedInvoice16), true);
  assert.equal(
    invoiceHasAppliedDiscount({
      amount: 827_000,
      discountCode: null,
      discountPercent: null,
      discountAmount: 0,
      originalAmount: null,
    }),
    false,
  );
});

test("FX base increase keeps discount percent on recalculation", () => {
  const breakdown = computeDiscountBreakdownForBasePrice(850_000, discountedInvoice16);
  assert.equal(breakdown.originalAmount, 850_000);
  assert.equal(breakdown.discountAmount, 306_000);
  assert.equal(breakdown.payableAmount, 544_000);
});

test("structuredClone-safe discount math inputs (regression guard)", () => {
  const payload = {
    base: 827_000,
    expected: computeDiscountedPayableAmount(827_000, discountedInvoice16),
    invoiceAmount: discountedInvoice16.amount,
  };
  assert.doesNotThrow(() => structuredClone(payload));
  assert.equal(payload.expected, payload.invoiceAmount);
});
