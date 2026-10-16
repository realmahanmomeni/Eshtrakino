import test from "node:test";
import assert from "node:assert/strict";
import { answerShopRefreshCallbackOnce, peekShopRefreshToast } from "./shopRefreshCallback";
import { canFetchCanbosoCatalogFromNetwork } from "../../services/suppliers/canboso/canbosoManualRefreshGate";
import { MANUAL_CANBOSO_REFRESH_TOAST } from "../../services/suppliers/canboso/canbosoManualRefreshGate";

test("peekShopRefreshToast matches 60s gate and always returns non-empty text", () => {
  const now = Date.now();
  const toast = peekShopRefreshToast(now);
  assert.ok(toast.text.trim().length > 0);
  if (canFetchCanbosoCatalogFromNetwork(now)) {
    assert.match(toast.text, /به‌روزرسانی شد/);
  } else {
    assert.equal(toast.text, MANUAL_CANBOSO_REFRESH_TOAST);
  }
});

test("answerShopRefreshCallbackOnce uses fallback when toast text is blank", async () => {
  let answered: { text?: string } | undefined;
  const ctx = {
    answerCallbackQuery: async (opts: { text?: string }) => {
      answered = opts;
    },
  };
  await answerShopRefreshCallbackOnce(ctx as never, { text: "   " });
  assert.ok(answered?.text?.trim().length);
});

test("answerShopRefreshCallbackOnce passes explicit toast text", async () => {
  let answered: { text?: string } | undefined;
  const ctx = {
    answerCallbackQuery: async (opts: { text?: string }) => {
      answered = opts;
    },
  };
  await answerShopRefreshCallbackOnce(ctx as never, { text: "✅ تست" });
  assert.equal(answered?.text, "✅ تست");
});
