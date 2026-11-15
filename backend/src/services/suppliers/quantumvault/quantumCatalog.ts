import type { CanbosoCatalogProduct } from "../adapters/CanbosoAdapter";
import { parseUsdAmount } from "./quantumMoney";
import {
  folderNameFromQuantum,
  isQuantumRemoteInStock,
  mapQuantumStock,
  readQuantumStockFields,
  type QuantumStockState,
} from "./quantumStock";

export const QUANTUM_SUPPLIER_NAME = "Quantum";

export function isQuantumSupplierName(name: string | null | undefined): boolean {
  return (name ?? "").trim().toLowerCase() === QUANTUM_SUPPLIER_NAME.toLowerCase();
}

export type QuantumSellableUnit = {
  productKey: string;
  variantKey: string | null;
  variantName: string | null;
  offerGroup: string | null;
  folder: string | null;
  name: string;
  description: string;
  priceUsd: number | null;
  stockState: QuantumStockState;
  /** Numeric stock when kind is count; null for unlimited and unknown. */
  stock: number | null;
  unlimited: boolean;
  inStockFlag: boolean | null;
  onDemand: boolean;
  deliverFieldNames: string[];
  raw: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pickString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function deliverFieldNames(row: Record<string, unknown>): string[] {
  const raw = row.deliverFields;
  if (!Array.isArray(raw)) return [];
  const names: string[] = [];
  for (const item of raw) {
    const rec = asRecord(item);
    const name = pickString(rec?.name) ?? pickString(rec?.label) ?? pickString(item);
    if (name) names.push(name);
  }
  return names;
}

function unitFromRow(
  product: Record<string, unknown>,
  variant: Record<string, unknown> | null,
): QuantumSellableUnit | null {
  const productKey = pickString(product.productKey) ?? pickString(product.id);
  if (!productKey) return null;

  const source = variant ?? product;
  const stockFields = readQuantumStockFields(source);
  const stockState = mapQuantumStock({
    unlimited: stockFields.unlimited,
    stock: stockFields.stock,
  });
  const variantKey = variant ? pickString(variant.key) ?? pickString(variant.variantKey) : null;
  const productName = pickString(product.name) ?? productKey;
  const variantName = variant ? pickString(variant.name) : null;
  const description =
    pickString(variant?.description) ?? pickString(product.description) ?? "";
  const priceSource = variant ? variant.price : product.price;

  return {
    productKey,
    variantKey,
    variantName,
    offerGroup: pickString(product.offerGroup),
    folder: folderNameFromQuantum(product.folder),
    name: variantName ? `${productName} — ${variantName}` : productName,
    description,
    priceUsd: parseUsdAmount(priceSource),
    stockState,
    stock: stockState.kind === "count" ? stockState.stock : null,
    unlimited: stockState.kind === "unlimited",
    inStockFlag: stockFields.inStock,
    onDemand: stockFields.onDemand,
    deliverFieldNames: deliverFieldNames(product),
    raw: variant ? { product, variant } : product,
  };
}

/** One shop row per product, or per variant when the product has variants. */
export function expandQuantumCatalog(body: unknown): QuantumSellableUnit[] {
  const root = asRecord(body);
  const list = Array.isArray(body)
    ? body
    : Array.isArray(root?.products)
      ? root.products
      : root?.product
        ? [root.product]
        : [];

  const units: QuantumSellableUnit[] = [];
  for (const item of list) {
    const product = asRecord(item);
    if (!product) continue;
    const variants = Array.isArray(product.variants) ? product.variants : [];
    if (variants.length === 0) {
      const unit = unitFromRow(product, null);
      if (unit) units.push(unit);
      continue;
    }
    for (const variantRaw of variants) {
      const variant = asRecord(variantRaw);
      if (!variant) continue;
      const unit = unitFromRow(product, variant);
      if (unit) units.push(unit);
    }
  }
  return units;
}

export function isQuantumUnitInStock(unit: QuantumSellableUnit): boolean {
  return isQuantumRemoteInStock({
    unlimited: unit.unlimited,
    stock: unit.stock,
    inStock: unit.inStockFlag,
    onDemand: unit.onDemand,
  });
}

/** Shape reused by the existing pending-import queue (Canboso rules). */
export function quantumUnitToCatalogProduct(unit: QuantumSellableUnit): CanbosoCatalogProduct {
  return {
    productId: unit.productKey,
    parentProductId: unit.productKey,
    variantId: unit.variantKey ?? undefined,
    brandName: unit.folder ?? undefined,
    name: unit.name,
    stock: unit.stock,
    isAvailable: isQuantumUnitInStock(unit),
    supplierPriceToman: 0,
    supplierCostUsd: unit.priceUsd ?? 0,
    description: unit.description,
    requiredFields: unit.deliverFieldNames,
    raw: {
      price: unit.priceUsd,
      description: unit.description,
      folder: unit.folder,
      offerGroup: unit.offerGroup,
      productKey: unit.productKey,
      variantKey: unit.variantKey,
    },
  };
}

export function quantumMappingIdentity(unit: QuantumSellableUnit): {
  supplierProductKey: string;
  supplierVariantKey: string;
} {
  return {
    supplierProductKey: unit.productKey,
    supplierVariantKey: unit.variantKey?.trim() ? unit.variantKey.trim() : "",
  };
}

let cachedUnits: QuantumSellableUnit[] = [];
let cachedAt = 0;

export function setQuantumCatalogCache(units: QuantumSellableUnit[], at = Date.now()): void {
  cachedUnits = units;
  cachedAt = at;
}

export function getQuantumCatalogCache(): { units: QuantumSellableUnit[]; cachedAt: number } {
  return { units: cachedUnits, cachedAt };
}

export function resetQuantumCatalogCacheForTests(): void {
  cachedUnits = [];
  cachedAt = 0;
}

export function findQuantumCachedUnit(input: {
  productKey: string;
  variantKey?: string | null;
  offerGroup?: string | null;
}): QuantumSellableUnit | null {
  const variant = input.variantKey?.trim() ? input.variantKey.trim() : "";
  if (input.offerGroup) {
    const byGroup = cachedUnits.find(
      (unit) =>
        unit.offerGroup === input.offerGroup &&
        (unit.variantKey?.trim() ? unit.variantKey.trim() : "") === variant,
    );
    if (byGroup) return byGroup;
  }
  return (
    cachedUnits.find((unit) => {
      const unitVariant = unit.variantKey?.trim() ? unit.variantKey.trim() : "";
      return unit.productKey === input.productKey && unitVariant === variant;
    }) ?? null
  );
}
