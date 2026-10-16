import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProductDetailPayload,
  splitDescriptionIntoChunks,
  TELEGRAM_PHOTO_CAPTION_MAX,
  TELEGRAM_TEXT_MESSAGE_MAX,
  truncateCatalogText,
} from "./productDetailMessage";
import { clipShopMessageText, TELEGRAM_SHOP_TEXT_MAX } from "./safeEdit";

test("splitDescriptionIntoChunks skips leading period on continuation", () => {
  const body = "Sentence one ends here. Second sentence continues with more detail about the product.";
  const { text: head, truncated } = truncateCatalogText(body, 28);
  assert.equal(truncated, true);
  const remainder = body.slice(head.endsWith("…") ? head.slice(0, -1).length : head.length);
  const chunks = splitDescriptionIntoChunks(remainder.trim());
  assert.ok(chunks.length > 0);
  assert.ok(!chunks[0]!.startsWith("."));
});

test("buildProductDetailPayload uses 4096 text budget by default", () => {
  const longDesc = "بخش ".repeat(900).trim();
  const payload = buildProductDetailPayload({
    product: { name: "Premium Test", deliveryType: "MANUAL" },
    description: longDesc,
    effectivePrice: 100_000,
  });
  assert.equal(payload.descriptionTruncated, false);
  assert.ok(payload.captionHtml.length <= TELEGRAM_TEXT_MESSAGE_MAX);
  assert.ok(payload.captionHtml.includes(longDesc.slice(0, 80)));
});

test("buildProductDetailPayload still respects explicit caption limit", () => {
  const longDesc = "word ".repeat(400).trim();
  const payload = buildProductDetailPayload({
    product: { name: "Stars", deliveryType: "AUTO" },
    description: longDesc,
    effectivePrice: 50_000,
    maxCaptionLen: TELEGRAM_PHOTO_CAPTION_MAX,
  });
  assert.equal(payload.descriptionTruncated, true);
  assert.ok(payload.captionHtml.length <= TELEGRAM_PHOTO_CAPTION_MAX);
});

test("clipShopMessageText clips at Telegram text limit", () => {
  const long = "x".repeat(TELEGRAM_SHOP_TEXT_MAX + 50);
  const clipped = clipShopMessageText(long);
  assert.equal(clipped.length, TELEGRAM_SHOP_TEXT_MAX);
  assert.ok(clipped.endsWith("…"));
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
