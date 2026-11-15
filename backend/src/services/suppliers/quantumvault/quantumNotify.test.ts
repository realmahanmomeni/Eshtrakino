import test from "node:test";
import assert from "node:assert/strict";
import {
  QUANTUM_NOTIFY_NAME_LIMIT,
  QUANTUM_PENDING_REVIEW_CALLBACK,
  buildQuantumBatchNotice,
  buildQuantumFirstSyncSummary,
  quantumPendingReviewKeyboard,
} from "./quantumNotify";

test("the first sync summary is one message with folder counts", () => {
  const text = buildQuantumFirstSyncSummary({
    total: 1005,
    folders: ["ChatGPT Plus", "ChatGPT Plus", "Claude API", null, "ChatGPT Plus"],
  });

  assert.match(text, /همگام‌سازی اول Quantum/);
  assert.match(text, /۱٬۰۰۵|1005|۱۰۰۵/);
  assert.match(text, /ChatGPT Plus/);
  assert.match(text, /Claude API/);
  assert.match(text, /بدون پوشه/);
  assert.equal(text.split("همگام‌سازی اول").length - 1, 1);
  assert.doesNotMatch(text, /• Outlook/);
});

test("later syncs batch new items and truncate the list", () => {
  const items = Array.from({ length: QUANTUM_NOTIFY_NAME_LIMIT + 5 }, (_, index) => ({
    name: `Product ${index + 1}`,
    folder: index % 2 === 0 ? "Capcut" : null,
  }));
  const text = buildQuantumBatchNotice(items);
  assert.match(text, /محصولات جدید Quantum/);
  assert.match(text, /Product 1/);
  assert.match(text, /Product 20/);
  assert.doesNotMatch(text, /Product 21/);
  assert.match(text, /مورد دیگر/);
  assert.equal(text.split("محصولات جدید Quantum").length - 1, 1);

  const keyboard = quantumPendingReviewKeyboard();
  const data = JSON.stringify(keyboard);
  assert.match(data, new RegExp(QUANTUM_PENDING_REVIEW_CALLBACK));
});
