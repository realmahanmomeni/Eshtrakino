import test from "node:test";
import assert from "node:assert/strict";
import {
  formatShopNavButtonLabel,
  formatShopProductButtonWithPrice,
} from "./shopNavButtonLabel";

test("formatShopNavButtonLabel prefers first part before pipe", () => {
  const label = formatShopNavButtonLabel("پریمیوم تلگرام | Telegram Premium", 30);
  assert.ok(!label.includes("…") || label.endsWith("…"));
  assert.ok(!/Telegram\s*Prem…/.test(label));
});

test("formatShopProductButtonWithPrice keeps price suffix visible", () => {
  const label = formatShopProductButtonWithPrice(
    "FreePik magnific + ۴۵ هزار اعتبار ۱ ماه",
    "9,330,000 تومان",
    30,
  );
  assert.match(label, /9,330,000\s*تومان/);
  assert.ok(label.indexOf("…") === -1 || label.indexOf("…") < label.indexOf("9,330"));
});
