import test from "node:test";
import assert from "node:assert/strict";
import { formatShopProductInlineLabel } from "./shopProductButtonLabel";

test("formatShopProductInlineLabel keeps Muse AI quantity readable", () => {
  const label = formatShopProductInlineLabel(
    "⭐ حساب Muse AI — ۱ میلیارد توکن",
    "۱۲۳,۰۰۰",
  );
  assert.ok(label.includes("Muse AI") || /Muse\s*AI/i.test(label));
  assert.match(label, /Muse\s*AI/i);
  assert.ok(label.length <= 64);
});

test("Telegram Premium plans keep Persian word durations and readable titles", () => {
  const three = formatShopProductInlineLabel("تلگرام پریمیوم سه ماهه", "3,042,000");
  assert.match(three, /پریمیوم/);
  assert.match(three, /۳ ماهه · 3,042,000$/);
  assert.ok(!/^پریم…/.test(three));

  assert.match(
    formatShopProductInlineLabel("تلگرام پریمیوم شش ماهه", "4,117,000"),
    /پریمیوم ۶ ماهه · 4,117,000$/,
  );
  assert.match(
    formatShopProductInlineLabel("تلگرام پریموم یک ساله", "7,320,000"),
    /پریمیوم ۱ ساله · 7,320,000$/,
  );
});

test("Coursera and FreePik keep duration before price with readable brand", () => {
  const coursera = formatShopProductInlineLabel("Coursera پرمیوم (NW) ۱۲ ماهه", "822,000");
  assert.match(coursera, /Coursera/);
  assert.match(coursera, /۱۲ ماهه · 822,000$/);
  assert.ok(!/^Cour…/.test(coursera));

  const freepik = formatShopProductInlineLabel("FreePik premium 1 month", "9,324,000");
  assert.match(freepik, /FreePik/);
  assert.match(freepik, /۱ ماهه · 9,324,000$/);
  assert.ok(!/^Free…/.test(freepik));
});

test("products #146 and #120 always show price and preserve identity tokens", () => {
  const fam = formatShopProductInlineLabel(
    "مدیر کامل FAM VEO 3 x20 اعتبار ۱ ماه گارانتی کامل",
    "29,080,000",
  );
  assert.match(fam, / · 29,080,000$/);
  assert.match(fam, /VEO 3 x20|FAM VEO 3 x20/);
  assert.ok(!/VEO\s+۱ ماه/.test(fam));

  const kling = formatShopProductInlineLabel("KLING 660-850 کره 1 ماه", "1,897,000");
  assert.match(kling, / · 1,897,000$/);
  assert.match(kling, /660-850/);
  assert.ok(kling.length <= 64);
});

test("formatShopProductInlineLabel ends with single ellipsis when truncated", () => {
  const long =
    "Quilbot پریمیوم ۱ ماهه (گارانتی بازخرید) با توضیح اضافی بسیار طولانی برای تست";
  const label = formatShopProductInlineLabel(long, "۵۰,۰۰۰");
  assert.match(label, / · ۵۰,۰۰۰$/);
  if (label.endsWith("…")) {
    assert.ok(!label.includes("……"));
  }
});
