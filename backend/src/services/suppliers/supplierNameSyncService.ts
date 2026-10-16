import { prisma } from "../../lib/prisma";
import { isAutomaticHierarchyBlocked } from "../catalog/catalogHierarchyGuard";
import { shortenSupplierProductName } from "../catalog/shortenSupplierProductName";
import { sanitizeSupplierNameSyncProposal } from "../catalog/supplierNameSyncGuard";
import { canbosoAdapter, type CanbosoCatalogProduct } from "./adapters/CanbosoAdapter";
import { CANBOSO_SUPPLIER_NAME, CanbosoSyncService } from "./CanbosoSyncService";

export type SupplierNameSyncProposal = {
  productId: number;
  currentName: string;
  proposedName: string;
  supplierProductKey: string;
};

function findRemoteForMapping(
  remoteProducts: CanbosoCatalogProduct[],
  supplierProductKey: string,
  supplierVariantKey: string | null,
): CanbosoCatalogProduct | undefined {
  const byKey = new Map<string, CanbosoCatalogProduct>();
  for (const p of remoteProducts) {
    byKey.set(p.productId, p);
    if (p.variantId) byKey.set(p.variantId, p);
  }
  if (supplierVariantKey && byKey.has(supplierVariantKey)) {
    return byKey.get(supplierVariantKey);
  }
  return byKey.get(supplierProductKey);
}

export async function buildSupplierNameSyncProposals(): Promise<{
  proposals: SupplierNameSyncProposal[];
  error?: string;
}> {
  const sync = new CanbosoSyncService();
  let remoteProducts: CanbosoCatalogProduct[];
  try {
    await sync.ensureSupplierAndKey();
    remoteProducts = await canbosoAdapter.getProducts();
  } catch (err) {
    console.error("[supplierNameSync] catalog fetch failed:", err);
    return { proposals: [], error: "دریافت کاتالوگ کنبوسo ناموفق بود. API Key را بررسی کنید." };
  }

  const supplier = await prisma.supplier.findFirst({
    where: { name: CANBOSO_SUPPLIER_NAME },
    select: { id: true },
  });
  if (!supplier) {
    return { proposals: [], error: "تامین‌کننده Canboso یافت نشد." };
  }

  const mappings = await prisma.supplierProductMapping.findMany({
    where: { supplierId: supplier.id },
    include: {
      product: {
        include: {
          category: true,
          subCategory: true,
          supplierProductMapping: true,
        },
      },
    },
  });

  const proposals: SupplierNameSyncProposal[] = [];

  for (const m of mappings) {
    const product = m.product;
    if (isAutomaticHierarchyBlocked(product)) continue;

    const remote = findRemoteForMapping(
      remoteProducts,
      m.supplierProductKey,
      m.supplierVariantKey,
    );
    if (!remote) continue;

    const rawProposed = shortenSupplierProductName(remote.name, { brandName: remote.brandName });
    const proposed = sanitizeSupplierNameSyncProposal({
      currentName: product.name,
      remoteName: remote.name,
      proposedName: rawProposed,
    });
    if (!proposed || proposed === product.name) continue;

    const dup = await prisma.product.findFirst({
      where: {
        id: { not: product.id },
        subCategoryId: product.subCategoryId,
        isActive: true,
        name: proposed,
      },
      select: { id: true },
    });
    if (dup) continue;

    proposals.push({
      productId: product.id,
      currentName: product.name,
      proposedName: proposed,
      supplierProductKey: m.supplierProductKey,
    });
  }

  proposals.sort((a, b) => a.productId - b.productId);
  return { proposals };
}

export async function applySupplierNameSyncProposals(
  proposals: SupplierNameSyncProposal[],
): Promise<number> {
  let updated = 0;
  for (const p of proposals) {
    const product = await prisma.product.findUnique({
      where: { id: p.productId },
      include: { category: true, subCategory: true },
    });
    if (!product || isAutomaticHierarchyBlocked(product)) continue;
    if (product.name === p.proposedName) continue;

    const dup = await prisma.product.findFirst({
      where: {
        id: { not: product.id },
        subCategoryId: product.subCategoryId,
        isActive: true,
        name: p.proposedName,
      },
    });
    if (dup) continue;

    await prisma.product.update({
      where: { id: p.productId },
      data: { name: p.proposedName },
    });
    updated += 1;
  }
  return updated;
}
