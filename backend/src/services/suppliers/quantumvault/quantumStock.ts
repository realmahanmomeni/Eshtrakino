/**
 * Quantum stock normalization.
 *
 * null stock + unlimited=true → unlimited (never runs out).
 * null stock otherwise → unknown (the shop already shows «موجودی: نامشخص»).
 * A numeric stock, including 0, stays a count.
 */

export type QuantumStockState =
  | { kind: "unlimited" }
  | { kind: "unknown" }
  | { kind: "count"; stock: number };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function mapQuantumStock(input: {
  unlimited?: boolean | null;
  stock?: number | null;
}): QuantumStockState {
  const stock = input.stock;
  if (input.unlimited === true && (stock == null || Number.isNaN(stock))) {
    return { kind: "unlimited" };
  }
  if (stock == null || Number.isNaN(stock)) {
    return { kind: "unknown" };
  }
  if (typeof stock === "number" && Number.isFinite(stock)) {
    return { kind: "count", stock: Math.max(0, Math.round(stock)) };
  }
  return { kind: "unknown" };
}

export function readQuantumStockFields(row: Record<string, unknown>): {
  unlimited: boolean;
  stock: number | null;
  inStock: boolean | null;
  onDemand: boolean;
} {
  const unlimited = row.unlimited === true;
  let stock: number | null = null;
  if (typeof row.stock === "number" && Number.isFinite(row.stock)) {
    stock = row.stock;
  } else if (row.stock == null) {
    stock = null;
  }

  const inStock = typeof row.inStock === "boolean" ? row.inStock : null;
  const onDemand = row.onDemand === true;
  return { unlimited, stock, inStock, onDemand };
}

/**
 * Purchasable when Quantum says so. Unknown stock (null, not unlimited) stays
 * purchasable unless inStock is explicitly false — same idea as Canboso.
 * onDemand with stock 0 is still buyable when inStock is true.
 */
export function isQuantumRemoteInStock(input: {
  unlimited?: boolean | null;
  stock: number | null;
  inStock?: boolean | null;
  onDemand?: boolean | null;
}): boolean {
  if (input.inStock === false) return false;
  if (input.unlimited === true) return true;
  if (input.stock == null) return true;
  if (input.stock > 0) return true;
  if (input.onDemand === true && input.inStock === true) return true;
  return false;
}

/** Numeric count for admin cards. Unlimited and unknown stay null → «نامشخص». */
export function quantumStockCountForAdmin(state: QuantumStockState): number | null {
  if (state.kind === "count") return state.stock;
  return null;
}

export function folderNameFromQuantum(folder: unknown): string | null {
  if (typeof folder === "string") {
    const trimmed = folder.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  const record = asRecord(folder);
  if (!record) return null;
  const name = record.name;
  const key = record.key;
  if (typeof name === "string" && name.trim()) return name.trim();
  if (typeof key === "string" && key.trim()) return key.trim();
  return null;
}
