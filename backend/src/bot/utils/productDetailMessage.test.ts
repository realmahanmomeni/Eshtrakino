import test from "node:test";
import assert from "node:assert/strict";
import { splitDescriptionIntoChunks, truncateCatalogText } from "./productDetailMessage";

test("splitDescriptionIntoChunks skips leading period on continuation", () => {
  const body = "Sentence one ends here. Second sentence continues with more detail about the product.";
  const { text: head, truncated } = truncateCatalogText(body, 28);
  assert.equal(truncated, true);
  const remainder = body.slice(head.endsWith("…") ? head.slice(0, -1).length : head.length);
  const chunks = splitDescriptionIntoChunks(remainder.trim());
  assert.ok(chunks.length > 0);
  assert.ok(!chunks[0]!.startsWith("."));
});

test("truncateCatalogText uses single ellipsis without trailing period", () => {
  const paragraph =
    "این یک توضیح طولانی است. جمله دوم با نقطه پایان می‌یابد. جمله سوم ادامه دارد و باید بریده شود.";
  const { text, truncated } = truncateCatalogText(paragraph, 45);
  assert.equal(truncated, true);
  assert.ok(text.endsWith("…"));
  assert.ok(!text.endsWith("…."));
  assert.ok(!text.endsWith("….") && !text.includes("……"));
});
