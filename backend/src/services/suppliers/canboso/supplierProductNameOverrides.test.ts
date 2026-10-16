import test from "node:test";
import assert from "node:assert/strict";
import { polishCustomerProductTitle } from "../../catalog/productTitlePolish";
import {
  getSupplierProductNameOverride,
  hasSupplierProductNameOverride,
  resolveAutomaticLocalProductName,
} from "./supplierProductNameOverrides";

const SUNO_KEY = "6ac4077a8931359f49e454fe";
const REMOTE_SUNO = "اعتبارات Suno Pro 2.5k 1 میلیون";

test("override wins over polished Canboso remote title", () => {
  const polished = polishCustomerProductTitle(REMOTE_SUNO);
  assert.notEqual(polished, "Suno Pro 2.5k credit");
  const resolved = resolveAutomaticLocalProductName(SUNO_KEY, REMOTE_SUNO, polishCustomerProductTitle);
  assert.equal(resolved, "Suno Pro 2.5k credit");
});

test("products without override use polished remote title", () => {
  const resolved = resolveAutomaticLocalProductName(
    "unknown-sku-key",
    REMOTE_SUNO,
    polishCustomerProductTitle,
  );
  assert.equal(resolved, polishCustomerProductTitle(REMOTE_SUNO));
});

test("hasSupplierProductNameOverride identifies pinned keys only", () => {
  assert.equal(hasSupplierProductNameOverride(SUNO_KEY), true);
  assert.equal(hasSupplierProductNameOverride("other-key"), false);
  assert.equal(getSupplierProductNameOverride(SUNO_KEY), "Suno Pro 2.5k credit");
});

test("name-sync must not revert overridden name (override differs from remote proposal)", () => {
  const override = getSupplierProductNameOverride(SUNO_KEY)!;
  const remoteShort = "Suno Pro 2.5k";
  assert.notEqual(remoteShort, override);
  assert.ok(hasSupplierProductNameOverride(SUNO_KEY));
});
