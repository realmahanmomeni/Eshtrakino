import test from "node:test";
import assert from "node:assert/strict";
import { pickShopRefreshRerenderTarget } from "./shopRefreshRerender";

test("pickShopRefreshRerenderTarget uses explicit category id from callback", () => {
  assert.deepEqual(pickShopRefreshRerenderTarget(42), {
    kind: "category",
    categoryId: 42,
  });
});

test("pickShopRefreshRerenderTarget shop:refresh always root (ignores stale session)", () => {
  assert.deepEqual(pickShopRefreshRerenderTarget(), { kind: "root" });
  assert.deepEqual(pickShopRefreshRerenderTarget(undefined), { kind: "root" });
});
