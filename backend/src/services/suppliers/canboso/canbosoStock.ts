/**
 * Canboso stock normalization.
 *
 * A missing or JSON `null` stock must stay unknown. Do not invent `1` when the
 * supplier only sent an availability flag — that is what made the admin card
 * show «موجودی ۱» while sync logged `stock=null`.
 */

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pickNumber(...values: unknown[]): number | undefined {
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v.replace(/,/g, "").trim());
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

function pickBool(...values: unknown[]): boolean | undefined {
  for (const v of values) {
    if (typeof v === "boolean") return v;
    if (v === 1 || v === "1" || v === "true" || v === "yes") return true;
    if (v === 0 || v === "0" || v === "false" || v === "no") return false;
  }
  return undefined;
}

export function resolveCanbosoStockAndAvailability(row: Record<string, unknown>): {
  stock: number | null;
  isAvailable: boolean;
} {
  const availability = asRecord(row.availability);
  const explicit = pickNumber(
    availability?.available,
    row.stock,
    row.stock_count,
    row.inventory_count,
    row.count,
    row.qty,
    row.quantity,
  );

  if (explicit != null) {
    const stock = Math.max(0, Math.round(explicit));
    return { stock, isAvailable: stock > 0 };
  }

  const isActiveFlag = pickBool(row.is_active, row.isActive, row.active);
  const availableFlag = pickBool(
    row.available,
    row.is_available,
    row.isAvailable,
    row.in_stock,
    row.inStock,
  );

  if (isActiveFlag === false || availableFlag === false) {
    return { stock: null, isAvailable: false };
  }
  if (isActiveFlag === true || availableFlag === true) {
    return { stock: null, isAvailable: true };
  }

  return { stock: null, isAvailable: false };
}

/** Purchasable when the supplier says available, even if it did not send a count. */
export function isCanbosoRemoteInStock(remote: {
  stock: number | null;
  isAvailable: boolean;
}): boolean {
  if (!remote.isAvailable) return false;
  if (remote.stock == null) return true;
  return remote.stock > 0;
}

/** Admin product card: unknown quantity is «نامشخص», including a reported 0. */
export function formatAdminSupplierStockLabel(stock: number | null | undefined): string {
  if (stock == null || !Number.isFinite(stock)) return "نامشخص";
  return String(Math.round(stock));
}
