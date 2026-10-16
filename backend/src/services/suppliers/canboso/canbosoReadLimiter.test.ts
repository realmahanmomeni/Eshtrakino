import test from "node:test";
import assert from "node:assert/strict";
import {
  acquireCanbosoReadSlot,
  CANBOSO_READ_LIMIT_PER_WINDOW,
  getCanbosoReadCountInWindow,
  resetCanbosoReadLimiterForTests,
} from "./canbosoReadLimiter";
import { SupplierRateLimitError } from "../SupplierAdapter";

test("read limiter allows up to cap then throws", async () => {
  resetCanbosoReadLimiterForTests();
  for (let i = 0; i < CANBOSO_READ_LIMIT_PER_WINDOW; i++) {
    await acquireCanbosoReadSlot();
  }
  assert.equal(getCanbosoReadCountInWindow(), CANBOSO_READ_LIMIT_PER_WINDOW);
  await assert.rejects(() => acquireCanbosoReadSlot(), SupplierRateLimitError);
});
