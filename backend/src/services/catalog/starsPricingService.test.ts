import test from "node:test";
import assert from "node:assert/strict";
import { effectiveStarsUnitToman } from "./starsPricingService";

test("effectiveStarsUnitToman matches 1000-star pack per-star price", () => {
  const unitUsd = 0.0171;
  const rate = 228_500;
  const packToman = Math.round((unitUsd * 1000 * rate) / 1000) * 1000;
  const expectedPerStar = Math.round(packToman / 1000);
  const header = effectiveStarsUnitToman(unitUsd, rate, 1000);
  assert.equal(header, expectedPerStar);
  const naiveHeader = Math.round(unitUsd * rate);
  if (naiveHeader !== expectedPerStar) {
    assert.notEqual(header, naiveHeader);
  }
});
