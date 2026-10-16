import test from "node:test";
import assert from "node:assert/strict";
import { pickShopRefreshRerenderTarget } from "./shopRefreshRerender";

test("pickShopRefreshRerenderTarget prefers explicit category id", () => {
  assert.deepEqual(
    pickShopRefreshRerenderTarget({ lastCategoryId: 1, lastShopSubCategoryId: 9 }, 42),
    { kind: "category", categoryId: 42 },
  );
});

test("pickShopRefreshRerenderTarget uses subcategory when set", () => {
  assert.deepEqual(pickShopRefreshRerenderTarget({ lastCategoryId: 1, lastShopSubCategoryId: 9 }), {
    kind: "subcategory",
    subCategoryId: 9,
  });
});

test("pickShopRefreshRerenderTarget falls back to category then root", () => {
  assert.deepEqual(pickShopRefreshRerenderTarget({ lastCategoryId: 3 }), {
    kind: "category",
    categoryId: 3,
  });
  assert.deepEqual(pickShopRefreshRerenderTarget({}), { kind: "root" });
});
