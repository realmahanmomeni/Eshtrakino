import test from "node:test";
import assert from "node:assert/strict";
import { DeliveryType } from "@prisma/client";
import { isInternalEshtrakinoFulfillment } from "./catalogAvailability";

const educationCategory = { name: "🎓 آموزش و یادگیری" };
const telegramCategory = { name: "📱 خدمات تلگرام" };
const telegramSub = { name: "Telegram Premium" };

test("Quilbot premium in education category is supplier-connected (not internal)", () => {
  assert.equal(
    isInternalEshtrakinoFulfillment({
      name: "Quilbot پریمیوم ۱ ماهه",
      deliveryType: DeliveryType.SUPPLIER_AUTO,
      category: educationCategory,
      subCategory: { name: "Quilbot" },
      supplierProductMapping: { id: 1 },
    }),
    false,
  );
});

test("mapped Coursera premium NW is not internal fulfillment", () => {
  assert.equal(
    isInternalEshtrakinoFulfillment({
      name: "کورسرا پرمیوم (NW)",
      deliveryType: DeliveryType.SUPPLIER_AUTO,
      category: educationCategory,
      supplierProductMapping: { id: 2 },
    }),
    false,
  );
});

test("Telegram premium in Telegram services category is internal", () => {
  assert.equal(
    isInternalEshtrakinoFulfillment({
      name: "تلگرام پریمیوم سه ماهه",
      deliveryType: DeliveryType.MANUAL,
      category: telegramCategory,
    }),
    true,
  );
});

test("Telegram Stars in Telegram category is internal", () => {
  assert.equal(
    isInternalEshtrakinoFulfillment({
      name: "۵۰ استارز",
      deliveryType: DeliveryType.MANUAL,
      category: telegramCategory,
      subCategory: telegramSub,
    }),
    true,
  );
});

test("YouTube premium outside Telegram category is not internal even without mapping", () => {
  assert.equal(
    isInternalEshtrakinoFulfillment({
      name: "یوتیوب پرمیوم ۱ ماهه",
      deliveryType: DeliveryType.MANUAL,
      category: { name: "🎬 فیلم و موسیقی" },
    }),
    false,
  );
});

test("LinkedIn premium with mapping is supplier-connected", () => {
  assert.equal(
    isInternalEshtrakinoFulfillment({
      name: "لینکدین پریمیوم کریر",
      deliveryType: DeliveryType.SUPPLIER_AUTO,
      category: { name: "💼 شبکه‌های اجتماعی" },
      supplierProductMapping: { id: 99 },
    }),
    false,
  );
});
