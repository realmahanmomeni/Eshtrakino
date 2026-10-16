import type { CanbosoCatalogProduct } from "../adapters/CanbosoAdapter";
import { SupplierRateLimitError } from "../SupplierAdapter";
import { normalizeSupplierProductName } from "../../catalog/brandCatalog";
import {
  CANBOSO_BULK_IN_MEMORY_TTL_MS,
  CANBOSO_CHECKOUT_CATALOG_MAX_AGE_MS,
} from "./canbosoCatalogTtl";
import { isCanbosoApiRefreshAllowed } from "./canbosoCooldownState";

export type RemoteIndexes = {
  byId: Map<string, CanbosoCatalogProduct>;
  byName: Map<string, CanbosoCatalogProduct>;
};

export type BulkCatalogSnapshot = {
  fetchedAt: number;
  remoteProducts: CanbosoCatalogProduct[];
  indexes: RemoteIndexes;
  fromCache: boolean;
};

let cache: BulkCatalogSnapshot | null = null;
let inflight: Promise<BulkCatalogSnapshot> | null = null;
let lastNetworkFetchAt = 0;

export function getLastCanbosoNetworkFetchAt(): number {
  return lastNetworkFetchAt;
}

export function resetCanbosoBulkCatalogForTests(): void {
  cache = null;
  inflight = null;
  lastNetworkFetchAt = 0;
}

export function seedCanbosoBulkCatalogForTests(
  products: CanbosoCatalogProduct[],
  fetchedAt = Date.now(),
): void {
  cache = {
    fetchedAt,
    remoteProducts: products,
    indexes: buildRemoteIndexes(products),
    fromCache: true,
  };
}

export function buildRemoteIndexes(remoteProducts: CanbosoCatalogProduct[]): RemoteIndexes {
  const byId = new Map<string, CanbosoCatalogProduct>();
  const byName = new Map<string, CanbosoCatalogProduct>();
  for (const p of remoteProducts) {
    byId.set(p.productId, p);
    byId.set(String(p.productId), p);
    if (p.variantId) {
      byId.set(p.variantId, p);
      byId.set(String(p.variantId), p);
    }
    if (p.parentProductId && p.variantId) {
      byId.set(`${p.parentProductId}:${p.variantId}`, p);
    }
    byName.set(normalizeSupplierProductName(p.name), p);
    if (p.brandName) {
      byName.set(normalizeSupplierProductName(p.brandName), p);
    }
  }
  return { byId, byName };
}

function isCacheFresh(fetchedAt: number, maxAgeMs: number, now: number): boolean {
  return maxAgeMs > 0 && now - fetchedAt < maxAgeMs;
}

async function fetchFromNetwork(reason: string): Promise<BulkCatalogSnapshot> {
  if (!isCanbosoApiRefreshAllowed()) {
    if (cache) {
      return { ...cache, fromCache: true };
    }
    throw new SupplierRateLimitError("Canboso cooldown active");
  }

  try {
    const { canbosoAdapter } = await import("../adapters/CanbosoAdapter.js");
    const remoteProducts = await canbosoAdapter.fetchProductsFromApi(reason);
    const fetchedAt = Date.now();
    const snapshot: BulkCatalogSnapshot = {
      fetchedAt,
      remoteProducts,
      indexes: buildRemoteIndexes(remoteProducts),
      fromCache: false,
    };
    cache = snapshot;
    lastNetworkFetchAt = fetchedAt;
    return snapshot;
  } catch (err) {
    if (cache) {
      return { ...cache, fromCache: true };
    }
    throw err;
  }
}

/**
 * Shared GET /products catalog with single-flight and age-based reuse.
 */
export async function getCanbosoBulkCatalog(options?: {
  force?: boolean;
  /** Return cached snapshot when younger than this (ms). 0 = always fetch if allowed. */
  maxAgeMs?: number;
  reason?: string;
}): Promise<BulkCatalogSnapshot> {
  const now = Date.now();
  const force = options?.force === true;
  const maxAgeMs = options?.maxAgeMs ?? CANBOSO_BULK_IN_MEMORY_TTL_MS;
  const reason = options?.reason ?? "bulk";

  if (!force && cache && maxAgeMs > 0 && isCacheFresh(cache.fetchedAt, maxAgeMs, now)) {
    return { ...cache, fromCache: true };
  }

  if (inflight) {
    return inflight;
  }

  inflight = fetchFromNetwork(reason).finally(() => {
    inflight = null;
  });
  return inflight;
}

export async function getCanbosoBulkCatalogForCheckout(
  reason = "checkout",
): Promise<BulkCatalogSnapshot> {
  return getCanbosoBulkCatalog({
    maxAgeMs: CANBOSO_CHECKOUT_CATALOG_MAX_AGE_MS,
    reason,
  });
}

export function findRemoteInBulkCatalog(
  indexes: RemoteIndexes,
  supplierProductKey: string,
  localName: string,
): CanbosoCatalogProduct | undefined {
  const byKey = indexes.byId.get(supplierProductKey);
  if (byKey) return byKey;

  const normName = normalizeSupplierProductName(localName);
  const byExactName = indexes.byName.get(normName);
  if (byExactName) return byExactName;

  for (const remote of indexes.byName.values()) {
    const rName = normalizeSupplierProductName(remote.name);
    if (rName.includes(normName) || normName.includes(rName)) {
      return remote;
    }
  }
  return undefined;
}
