import test from "node:test";
import assert from "node:assert/strict";
import { formatShopProductInlineLabel } from "./shopProductButtonLabel";

function assertNoListPriceSuffix(label: string): void {
  assert.ok(!/ · [\d,۰-۹]+/.test(label), `unexpected price suffix in list label: ${label}`);
  assert.ok(!/تومان/.test(label));
}

test("formatShopProductInlineLabel keeps Muse AI quantity readable without price", () => {
  const label = formatShopProductInlineLabel(
    "⭐ حساب Muse AI — ۱ میلیارد توکن",
    "۱۲۳,۰۰۰",
  );
  assertNoListPriceSuffix(label);
  assert.match(label, /Muse\s*AI/i);
  assert.ok(label.length <= 64);
});

test("Telegram Premium plans show duration without price", () => {
  const three = formatShopProductInlineLabel("تلگرام پریمیوم سه ماهه", "3,042,000");
  assertNoListPriceSuffix(three);
  assert.match(three, /پریمیوم ۳ ماهه$/);

  assert.match(
    formatShopProductInlineLabel("تلگرام پریمیوم شش ماهه", "4,117,000"),
    /پریمیوم ۶ ماهه$/,
  );
  assert.match(
    formatShopProductInlineLabel("تلگرام پریموم یک ساله", "7,320,000"),
    /پریمیوم ۱ ساله$/,
  );
});

test("Coursera and FreePik list labels omit price", () => {
  const coursera = formatShopProductInlineLabel("Coursera پرمیوم (NW) ۱۲ ماهه", "822,000");
  assertNoListPriceSuffix(coursera);
  assert.match(coursera, /Coursera/);
  assert.match(coursera, /۱۲ ماهه$/);

  const freepik = formatShopProductInlineLabel("FreePik premium 1 month", "9,324,000");
  assertNoListPriceSuffix(freepik);
  assert.match(freepik, /FreePik/);
  assert.match(freepik, /۱ ماهه$/);
});

test("products #146 and #120 render name+duration without price", () => {
  const fam = formatShopProductInlineLabel(
    "مدیر کامل FAM VEO 3 x20 اعتبار ۱ ماه گارانتی کامل",
    "29,080,000",
  );
  assertNoListPriceSuffix(fam);
  assert.match(fam, /VEO 3 x20|FAM VEO 3 x20/);
  assert.match(fam, /۱ ماه$/);

  const kling = formatShopProductInlineLabel("KLING 660-850 کره 1 ماه", "1,897,000");
  assertNoListPriceSuffix(kling);
  assert.match(kling, /660-850/);
  assert.match(kling, /1 ماه|۱ ماه/);
});

test("long list label truncates only when above target, never adds price", () => {
  const long =
    "Quilbot پریمیوم ۱ ماهه (گارانتی بازخرید) با توضیح اضافی بسیار طولانی برای تست";
  const label = formatShopProductInlineLabel(long, "۵۰,۰۰۰");
  assertNoListPriceSuffix(label);
  assert.match(label, /۱ ماهه/);
});
