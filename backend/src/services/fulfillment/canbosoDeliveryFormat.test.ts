import test from "node:test";
import assert from "node:assert/strict";
import {
  assertCustomerDeliveryMessageSafe,
  formatCanbosoAccountDeliveryHtml,
  formatCanbosoDeliveryContentHtml,
  serializeCanbosoDeliveryPayload,
} from "./canbosoDeliveryFormat";
import { formatCustomerDeliveryMessage } from "./customerDeliveryMessage";

export const GEMINI_PRO_CANBOSO_PURCHASE_SAMPLE = {
  success: true,
  lang: "fa",
  order: {
    orderCode: "ORDERO7QWTWVZV0",
    status: "completed",
    productId: "6acfaafc45252652925c2cde",
    productName: "🔥 لینک - جیمنی AI پرو ۱۸ ماه",
    productType: "account",
    quantity: 1,
    bonusQuantity: 0,
    finalQuantity: 1,
  },
  payment: {
    amount: 1.5,
    amountText: "$۱٫۵۰",
    originalAmount: 1.5,
    originalAmountText: "$۱٫۵۰",
    discountPercent: 0,
    discountAmount: 0,
    discountAmountText: "$۰٫۰۰",
    currency: "USD",
    balance: 0.1,
    balanceText: "$۰٫۱۰",
  },
  delivery: {
    accounts: [
      {
        user: "[https://giminion.cc/new/gm/AQCpiIGN](https://giminion.cc/new/gm/AQCpiIGN)...",
        password: "",
        verifyEmail: null,
        expiryText: null,
        otherInfo: null,
      },
    ],
  },
} as const;

test("Gemini Pro Canboso JSON — VIP template, link only, zero payment leak", () => {
  const contentHtml = formatCanbosoDeliveryContentHtml(GEMINI_PRO_CANBOSO_PURCHASE_SAMPLE);
  const message = formatCustomerDeliveryMessage({
    productName: "🔥 لینک - جیمنی AI پرو ۱۸ ماه",
    invoiceId: 42,
    deliveryContentHtml: contentHtml,
  });

  assert.match(contentHtml, /giminion\.cc\/new\/gm\/AQCpiIGN/);
  assert.match(message, /سفارش شما با موفقیت آماده/);
  assert.match(message, /#42/);

  for (const forbidden of [
    "1.5",
    "$۱٫۵۰",
    "balance",
    "payment",
    "ORDERO7QWTWVZV0",
    "null",
    '{"success"',
    "orderCode",
    "amountText",
  ]) {
    assert.equal(
      message.includes(forbidden),
      false,
      `message must not contain "${forbidden}"`,
    );
  }

  assert.doesNotThrow(() => assertCustomerDeliveryMessageSafe(message));
});

test("serializeCanbosoDeliveryPayload stores sanitized html only", () => {
  const stored = serializeCanbosoDeliveryPayload(GEMINI_PRO_CANBOSO_PURCHASE_SAMPLE);
  const parsed = JSON.parse(stored) as { version: number; contentHtml: string };
  assert.equal(parsed.version, 1);
  assert.match(parsed.contentHtml, /giminion\.cc/);
  assert.equal(parsed.contentHtml.includes("payment"), false);
  assert.equal(stored.includes("ORDERO7QWTWVZV0"), false);
});

test("account credentials — renders fields and omits null/empty", () => {
  const html = formatCanbosoAccountDeliveryHtml({
    user: "test@gmail.com",
    password: "123",
    verifyEmail: null,
    expiryText: "30 days",
    otherInfo: null,
  });

  assert.match(html, /test@gmail\.com/);
  assert.match(html, /123/);
  assert.match(html, /30 days/);
  assert.equal(html.includes("null"), false);
  assert.equal(html.includes("verifyEmail"), false);
  assert.equal(html.includes("otherInfo"), false);
  assert.doesNotThrow(() => assertCustomerDeliveryMessageSafe(html));
});
