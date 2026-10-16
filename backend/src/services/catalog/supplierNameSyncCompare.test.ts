import test from "node:test";
import assert from "node:assert/strict";
import { namesAreEquivalentForSync } from "./supplierNameSyncCompare";

test("namesAreEquivalentForSync ignores bidi isolates", () => {
  const a = "Coursera ۱۲ ماهه";
  const b = `\u2068Coursera\u2069 ۱۲ ماهه`;
  assert.ok(namesAreEquivalentForSync(a, b));
});
