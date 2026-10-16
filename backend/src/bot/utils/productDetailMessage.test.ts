import test from "node:test";
import assert from "node:assert/strict";
import { truncateCatalogText } from "./productDetailMessage";

test("truncateCatalogText uses single ellipsis without trailing period", () => {
  const paragraph =
    "این یک توضیح طولانی است. جمله دوم با نقطه پایان می‌یابد. جمله سوم ادامه دارد و باید بریده شود.";
  const { text, truncated } = truncateCatalogText(paragraph, 45);
  assert.equal(truncated, true);
  assert.ok(text.endsWith("…"));
  assert.ok(!text.endsWith("…."));
  assert.ok(!text.endsWith("….") && !text.includes("……"));
});
