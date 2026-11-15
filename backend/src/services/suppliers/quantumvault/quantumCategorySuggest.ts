import { prisma } from "../../../lib/prisma";
import { QUANTUM_SUPPLIER_NAME } from "./quantumCatalog";

export function normalizeRemoteFolder(value: string | null | undefined): string | null {
  const folder = value?.trim();
  return folder ? folder : null;
}

/** Folder labels match trimmed and case-insensitively. Null and blank stay unmapped. */
export async function findFolderSuggestion(supplierId: number, remoteFolder: string | null | undefined) {
  const folder = normalizeRemoteFolder(remoteFolder);
  if (!folder) return null;
  const rows = await prisma.supplierCategoryMapping.findMany({
    where: {
      supplierId,
      remoteFolder: { equals: folder, mode: "insensitive" },
    },
    include: {
      category: { select: { id: true, name: true, isActive: true } },
      subCategory: { select: { id: true, name: true, isActive: true, categoryId: true } },
    },
    orderBy: { id: "asc" },
  });
  return rows.find((row) => row.remoteFolder === folder) ?? rows[0] ?? null;
}

export async function listFolderBulkActions(): Promise<
  Array<{
    mappingId: number;
    remoteFolder: string;
    pendingCount: number;
    categoryName: string;
    subCategoryName: string | null;
  }>
> {
  const supplier = await prisma.supplier.findFirst({
    where: { name: QUANTUM_SUPPLIER_NAME },
    select: { id: true },
  });
  if (!supplier) return [];

  const mappings = await prisma.supplierCategoryMapping.findMany({
    where: { supplierId: supplier.id },
    include: {
      category: { select: { name: true } },
      subCategory: { select: { name: true } },
    },
    orderBy: { remoteFolder: "asc" },
  });

  const actions = [];
  for (const mapping of mappings) {
    const pendingCount = await prisma.supplierPendingImport.count({
      where: {
        supplierId: supplier.id,
        status: "PENDING",
        remoteFolder: { equals: mapping.remoteFolder, mode: "insensitive" },
      },
    });
    if (pendingCount === 0) continue;
    actions.push({
      mappingId: mapping.id,
      remoteFolder: mapping.remoteFolder,
      pendingCount,
      categoryName: mapping.category.name,
      subCategoryName: mapping.subCategory?.name ?? null,
    });
  }
  return actions;
}
