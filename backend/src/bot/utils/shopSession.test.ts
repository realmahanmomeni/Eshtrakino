import test from "node:test";
import assert from "node:assert/strict";
import { readShopShowOutOfStock } from "./shopSession";
import { createInitialSession } from "../context";

test("readShopShowOutOfStock defaults false when session missing", () => {
  assert.equal(readShopShowOutOfStock(undefined), false);
  assert.equal(readShopShowOutOfStock(null), false);
});

test("readShopShowOutOfStock reads session flag", () => {
  const session = createInitialSession();
  session.shopShowOutOfStock = true;
  assert.equal(readShopShowOutOfStock(session), true);
});
