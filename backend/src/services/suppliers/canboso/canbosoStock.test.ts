import test from "node:test";
import assert from "node:assert/strict";
import {
  formatAdminSupplierStockLabel,
  isCanbosoRemoteInStock,
  resolveCanbosoStockAndAvailability,
} from "./canbosoStock";

test("null stock with an available flag stays unknown instead of 1", () => {
  const resolved = resolveCanbosoStockAndAvailability({
    stock: null,
    is_active: true,
  });
  assert.equal(resolved.stock, null);
  assert.equal(resolved.isAvailable, true);
  assert.equal(formatAdminSupplierStockLabel(resolved.stock), "نامشخص");
  assert.equal(isCanbosoRemoteInStock(resolved), true);
});

test("a reported zero stays zero", () => {
  const resolved = resolveCanbosoStockAndAvailability({
    stock: 0,
    is_active: true,
  });
  assert.deepEqual(resolved, { stock: 0, isAvailable: false });
  assert.equal(formatAdminSupplierStockLabel(resolved.stock), "0");
  assert.equal(isCanbosoRemoteInStock(resolved), false);
});

test("a reported positive count is kept", () => {
  const resolved = resolveCanbosoStockAndAvailability({
    qty: "12",
    is_active: false,
  });
  assert.deepEqual(resolved, { stock: 12, isAvailable: true });
  assert.equal(formatAdminSupplierStockLabel(resolved.stock), "12");
});

test("availability flag without a count does not invent stock", () => {
  const resolved = resolveCanbosoStockAndAvailability({ in_stock: true });
  assert.equal(resolved.stock, null);
  assert.equal(resolved.isAvailable, true);
});
