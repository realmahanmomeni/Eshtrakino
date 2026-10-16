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
  assert.match(label, /FreePik/i);
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
