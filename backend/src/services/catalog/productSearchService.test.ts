import test from "node:test";
import assert from "node:assert/strict";
import {
  expandSearchTerms,
  shouldSearchIncludeInactiveProducts,
} from "./productSearchService";

test("expandSearchTerms adds LinkedIn and Persian alias", () => {
  const terms = expandSearchTerms("LinkedIn");
  const joined = terms.join(" ").toLowerCase();
  assert.ok(joined.includes("linkedin"));
  assert.ok(terms.some((t) => /لینکدین/.test(t)));
});

test("shouldSearchIncludeInactiveProducts matches admin OOS toggle", () => {
  assert.equal(shouldSearchIncludeInactiveProducts(true, true), true);
  assert.equal(shouldSearchIncludeInactiveProducts(true, false), false);
  assert.equal(shouldSearchIncludeInactiveProducts(false, true), false);
});
