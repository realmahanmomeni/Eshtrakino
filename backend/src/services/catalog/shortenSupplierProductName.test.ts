import test from "node:test";
import assert from "node:assert/strict";
import { shortenSupplierProductName } from "./shortenSupplierProductName";

test("shortenSupplierProductName distinguishes LinkedIn plans", () => {
  const sales = shortenSupplierProductName("Sales Navigator Core 1 month premium", {
    brandName: "LinkedIn",
  });
  assert.match(sales, /سیلز\s*ناویگیتور/);

  const career = shortenSupplierProductName("LinkedIn Career Premium 12 month", {
    brandName: "LinkedIn",
  });
  assert.match(career, /کریر/);
  assert.notEqual(sales, career);
});

test("shortenSupplierProductName strips guarantee clutter", () => {
  const name = shortenSupplierProductName(
    "FreePik (magnific) پیش + ۴۵ هزار اعتبار ۱ ماه (گارانتی ۵ روزه)",
    { brandName: "Freepik" },
  );
  assert.ok(name.length <= 32);
  assert.ok(!name.includes("گارانتی"));
  assert.match(name, /۴۵\s*هزار/i);
});

test("shortenSupplierProductName keeps Quilbot premium duration complete", () => {
  const name = shortenSupplierProductName(
    "Quilbot پریمیوم ۱ ماهه (گارانتی بازخرید)",
    { brandName: "Quilbot" },
  );
  assert.ok(name.length <= 32);
  assert.match(name, /Quilbot/i);
  assert.match(name, /۱\s*ماه/);
});

test("shortenSupplierProductName includes Muse AI token quantity", () => {
  const name = shortenSupplierProductName("⭐ حساب Muse AI — ۱ میلیارد توکن", {
    brandName: "Muse AI",
  });
  assert.match(name, /Muse\s*AI/i);
  assert.match(name, /۱\s*میلیارد/);
});
