import test from "node:test";
import assert from "node:assert/strict";
import { parseProfitMarginPercentInput } from "./profitMarginInput";

test("parseProfitMarginPercentInput accepts decimals", () => {
  const r = parseProfitMarginPercentInput("12.5");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value, 12.5);
});

test("parseProfitMarginPercentInput rejects zero and negative", () => {
  assert.equal(parseProfitMarginPercentInput("0").ok, false);
  assert.equal(parseProfitMarginPercentInput("-5").ok, false);
});

test("parseProfitMarginPercentInput rejects huge values", () => {
  assert.equal(parseProfitMarginPercentInput("1001").ok, false);
});
