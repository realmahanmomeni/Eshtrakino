import test from "node:test";
import assert from "node:assert/strict";
import { truncateInlineButtonLabel } from "./telegramLabel";

test("truncateInlineButtonLabel uses word boundary", () => {
  const long = "⏳ حساب Muse AI — ۱ میلیارد توکن اضافی برای تست طولانی";
  const out = truncateInlineButtonLabel(long, 40);
  assert.ok(out.endsWith("…"));
  assert.ok(out.length <= 40);
});
