import test from "node:test";
import assert from "node:assert/strict";
import { InlineKeyboard } from "grammy";
import { formatShopProductInlineLabel } from "./shopProductButtonLabel";
import {
  appendProductButtonRows,
  isLongProductButtonLabel,
  planProductButtonRows,
  PRODUCT_BUTTON_PAIR_MAX_VISIBLE_LENGTH,
} from "./productButtonRows";
import type { KeyboardButton } from "./grid";

function btn(text: string, data = "prod:1"): KeyboardButton {
  return { text, data };
}

test("threshold is 24 visible characters", () => {
  assert.equal(PRODUCT_BUTTON_PAIR_MAX_VISIBLE_LENGTH, 24);
  assert.equal(isLongProductButtonLabel("x".repeat(24)), false);
  assert.equal(isLongProductButtonLabel("x".repeat(25)), true);
});

test("short + short stays two per row", () => {
  const rows = planProductButtonRows([btn("Alpha"), btn("Beta"), btn("Gamma"), btn("Delta")]);
  assert.deepEqual(
    rows.map((r) => r.map((b) => b.text)),
    [
      ["Alpha", "Beta"],
      ["Gamma", "Delta"],
    ],
  );
});

test("long + anything uses one per row", () => {
  const long = "y".repeat(30);
  const rows = planProductButtonRows([btn("short"), btn(long), btn("other")]);
  assert.deepEqual(
    rows.map((r) => r.map((b) => b.text)),
    [["short"], [long], ["other"]],
  );
});

test("odd count of short labels leaves last row single", () => {
  const rows = planProductButtonRows([btn("A"), btn("B"), btn("C")]);
  assert.deepEqual(
    rows.map((r) => r.length),
    [2, 1],
  );
});

test("FAM VEO and KLING shop labels are long and plan as separate rows", () => {
  const fam = formatShopProductInlineLabel(
    "مدیر کامل FAM VEO 3 x20 اعتبار ۱ ماه گارانتی کامل",
    "29,080,000",
  );
  const kling = formatShopProductInlineLabel("KLING 660-850 کره 1 ماه", "1,897,000");
  assert.ok(isLongProductButtonLabel(fam));
  assert.ok(isLongProductButtonLabel(kling));
  const rows = planProductButtonRows([btn(fam, "1"), btn(kling, "2")]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.length, 1);
  assert.equal(rows[1]!.length, 1);
  assert.match(rows[0]![0]!.text, /29,080,000/);
  assert.match(rows[1]![0]!.text, /1,897,000/);
});

test("appendProductButtonRows lays short pair as one two-column row", () => {
  const kb = new InlineKeyboard();
  appendProductButtonRows(kb, [btn("A"), btn("B")]);
  assert.equal(kb.inline_keyboard[0]?.length, 2);
});
