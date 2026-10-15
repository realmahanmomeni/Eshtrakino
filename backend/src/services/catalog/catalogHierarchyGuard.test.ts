import test from "node:test";
import assert from "node:assert/strict";
import { isAutomaticHierarchyBlocked } from "./catalogHierarchyGuard";

test("isAutomaticHierarchyBlocked respects flags", () => {
  assert.equal(
    isAutomaticHierarchyBlocked({
      hierarchyLocked: true,
      categoryId: 1,
      subCategoryId: 1,
      category: { isAdminManaged: false } as never,
      subCategory: null,
    }),
    true,
  );
  assert.equal(
    isAutomaticHierarchyBlocked({
      hierarchyLocked: false,
      categoryId: 1,
      subCategoryId: 1,
      category: null,
      subCategory: { isAdminManaged: true } as never,
    }),
    true,
  );
});
