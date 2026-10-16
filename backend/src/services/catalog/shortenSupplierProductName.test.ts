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
  assert.match(name, /FreePik/i);
  assert.ok(name.length <= 32);
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

test("shortenSupplierProductName keeps Cursor Ultra plan and duration", () => {
  const name = shortenSupplierProductName("Cursor Ultra یک ماه (۷ روز گارانتی)", {
    brandName: "Cursor",
  });
  assert.match(name, /Cursor/i);
  assert.match(name, /Ultra/i);
  assert.match(name, /۱\s*ماه|یک\s*ماه/);
  assert.notEqual(name.trim(), "Cursor");
});

test("shortenSupplierProductName does not append stray suffix to Adobe Express", () => {
  const name = shortenSupplierProductName("ادوبی اکسپرس ۱۲ ماهه", { brandName: "Adobe" });
  assert.match(name, /۱۲\s*ماه/);
  assert.ok(!/\s۲$/.test(name));
});

test("shortenSupplierProductName keeps GROK Super duration", () => {
  const name = shortenSupplierProductName("⚡ GROK سوپر ۱۰ روزه (۷ روز گارانتی)", {
    brandName: "GROK",
  });
  assert.match(name, /GROK/i);
  assert.match(name, /Super|سوپر/i);
  assert.match(name, /۱۰\s*روز/);
  assert.ok(!hasUnclosedParen(name));
});

function hasUnclosedParen(s: string): boolean {
  let d = 0;
  for (const c of s) {
    if (c === "(") d++;
    if (c === ")") d--;
  }
  return d !== 0;
}
