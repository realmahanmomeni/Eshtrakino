import test from "node:test";
import assert from "node:assert/strict";
import { searchResultsKeyboard } from "./builders";

function buttonTexts(kb: ReturnType<typeof searchResultsKeyboard>): string[] {
  const rows = kb.inline_keyboard;
  const texts: string[] = [];
  for (const row of rows) {
    for (const btn of row) {
      if ("text" in btn && btn.callback_data?.startsWith("prod:view:")) {
        texts.push(btn.text);
      }
    }
  }
  return texts;
}

test("searchResultsKeyboard uses list-style labels without price (not 35-char clip)", () => {
  const kb = searchResultsKeyboard(
    [
      {
        id: 1,
        name: "FreePik (magnific) ۴۵ هزار + پیشنهاد ویژه ۱ ماهه",
        outOfStock: false,
      },
      {
        id: 2,
        name: "مدیر کامل FAM VEO 3 x20 اعتبار ۱ ماه گارانتی کامل",
        outOfStock: false,
      },
      {
        id: 3,
        name: "ماوس Cursor pro یک ماه و ده روز اشتراک",
        outOfStock: true,
      },
    ],
    "test",
  );
  const labels = buttonTexts(kb);
  assert.equal(labels.length, 3);

  assert.match(labels[0]!, /FreePik/i);
  assert.match(labels[0]!, /۱ ماهه$/);
  assert.ok(!labels[0]!.includes("۴۵ هزار"));
  assert.ok(!labels[0]!.endsWith("پیش…"));

  assert.match(labels[1]!, /FAM VEO 3 x20|VEO 3 x20/i);
  assert.match(labels[1]!, /۱ ماه(ه)?$/);
  assert.ok(!labels[1]!.includes("اعتبار ا…"));

  assert.match(labels[2]!, /^❌\s*/);
  assert.match(labels[2]!, /Cursor/i);
  assert.ok(!/ · [\d,]+/.test(labels[2]!));

  for (const label of labels) {
    assert.ok(label.length <= 64, `label too long: ${label}`);
  }
});
