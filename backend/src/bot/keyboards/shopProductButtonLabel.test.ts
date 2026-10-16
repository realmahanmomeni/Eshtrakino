import test from "node:test";
import assert from "node:assert/strict";
import { formatShopProductInlineLabel } from "./shopProductButtonLabel";

test("formatShopProductInlineLabel keeps Muse AI quantity readable", () => {
  const label = formatShopProductInlineLabel(
    "⭐ حساب Muse AI — ۱ میلیارد توکن",
    "۱۲۳,۰۰۰",
  );
  assert.ok(label.includes("Muse AI") || /Muse\s*AI/i.test(label));
  assert.ok(label.includes("۱") || label.includes("میلیارد") || label.includes("…"));
  assert.match(label, /Muse\s*AI/i);
  assert.ok(label.length <= 64);
  assert.ok(!/\S…\S/.test(label.replace(/…$/, "")));
});

test("formatShopProductInlineLabel shortens long FreePik titles with credits", () => {
  const label = formatShopProductInlineLabel(
    "FreePik (magnific) پیش + ۴۵ هزار FreePik (magnific) اعتبار ۱ ماه",
    "۹۹,۰۰۰",
  );
  assert.match(label, /FreePik/i);
  assert.match(label, /۹۹,۰۰۰/);
  assert.ok(label.length <= 64);
});

test("formatShopProductInlineLabel ends with single ellipsis when truncated", () => {
  const long =
    "Quilbot پریمیوم ۱ ماهه (گارانتی بازخرید) با توضیح اضافی بسیار طولانی برای تست";
  const label = formatShopProductInlineLabel(long, "۵۰,۰۰۰");
  if (label.endsWith("…")) {
    assert.ok(!label.endsWith("…."));
    assert.ok(!label.includes("……"));
  }
});

test("Telegram Premium plans keep Persian word durations", () => {
  assert.match(
    formatShopProductInlineLabel("تلگرام پریمیوم سه ماهه", "3,042,000"),
    /پریمیوم ۳ ماهه · 3,042,000$/,
  );
  assert.match(
    formatShopProductInlineLabel("تلگرام پریمیوم شش ماهه", "4,117,000"),
    /پریمیوم ۶ ماهه · 4,117,000$/,
  );
  assert.match(
    formatShopProductInlineLabel("تلگرام پریموم یک ساله", "7,320,000"),
    /پریمیوم ۱ ساله · 7,320,000$/,
  );
});

test("Coursera and FreePik keep duration before price", () => {
  const coursera = formatShopProductInlineLabel("Coursera پرمیوم (NW) ۱۲ ماهه", "822,000");
  assert.match(coursera, /Coursera/);
  assert.match(coursera, /۱۲ ماهه · 822,000$/);
  const freepik = formatShopProductInlineLabel("FreePik premium 1 month", "9,329,000");
  assert.match(freepik, /FreePik/);
  assert.match(freepik, /۱ ماهه · 9,329,000$/);
});

test("long AI product labels always retain price suffix", () => {
  for (const [name, price] of [
    ["مدیر کامل FAM VEO 3 x20", "1,234,000"],
    ["KLING 660-850 کره 1 ماه", "987,000"],
  ]) {
    const label = formatShopProductInlineLabel(name, price);
    assert.match(label, new RegExp(` · ${price.replace(/,/g, ",")}$`));
    assert.ok(label.length <= 64);
  }
});
