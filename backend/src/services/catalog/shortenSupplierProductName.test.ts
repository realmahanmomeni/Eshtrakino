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
});
