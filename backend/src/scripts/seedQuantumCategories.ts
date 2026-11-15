/**
 * Idempotent Quantum category merge.
 *
 *   npm run seed:quantum-categories -- --dry-run
 *   npm run seed:quantum-categories -- --fixture
 *   npm run seed:quantum-categories
 *
 * Matches rows by id and name. Moves products into the kept subcategory and
 * deactivates the emptied one. Never deletes products or subcategories.
 */
import {
  planQuantumCategorySeed,
  productionLikeFixture,
  PROTECTED_CATEGORY_IDS,
  type SeedSnapshot,
} from "../services/catalog/quantumCategorySeed.js";

const protectedIds = new Set<number>(PROTECTED_CATEGORY_IDS);

function parseArgs(argv: string[]): { dryRun: boolean; fixture: boolean } {
  return {
    dryRun: argv.includes("--dry-run"),
    fixture: argv.includes("--fixture"),
  };
}

function printPlan(logs: string[]): void {
  for (const line of logs) console.log(line);
}

async function applySnapshot(before: SeedSnapshot, after: SeedSnapshot): Promise<void> {
  const { prisma } = await import("../lib/prisma.js");
  const categoryIds = new Map<number, number>();
  const subIds = new Map<number, number>();
  const supplierIds = new Map<number, number>();

  const mapId = (id: number, table: Map<number, number>): number => {
    if (id >= 0) return id;
    const mapped = table.get(id);
    if (mapped == null) throw new Error(`Missing created id for ${id}`);
    return mapped;
  };

  try {
    await prisma.$transaction(
      async (tx) => {
        for (const supplier of after.suppliers) {
          if (supplier.id >= 0) continue;
          const created = await tx.supplier.create({
            data: { name: supplier.name, isActive: supplier.isActive },
          });
          supplierIds.set(supplier.id, created.id);
        }

        for (const category of after.categories) {
          if (category.id >= 0) continue;
          const created = await tx.category.create({
            data: {
              name: category.name,
              description: category.description,
              isActive: category.isActive,
              isAdminManaged: category.isAdminManaged,
            },
          });
          categoryIds.set(category.id, created.id);
        }

        for (const category of after.categories) {
          if (category.id < 0 || protectedIds.has(category.id)) continue;
          const prior = before.categories.find((row) => row.id === category.id);
          if (!prior) continue;
          if (
            prior.description === category.description &&
            prior.isAdminManaged === category.isAdminManaged &&
            prior.isActive === category.isActive &&
            prior.name === category.name
          ) {
            continue;
          }
          await tx.category.update({
            where: { id: category.id },
            data: {
              description: category.description,
              isAdminManaged: category.isAdminManaged,
              isActive: category.isActive,
            },
          });
        }

        for (const sub of after.subCategories) {
          if (sub.id >= 0) continue;
          const created = await tx.subCategory.create({
            data: {
              name: sub.name,
              categoryId: mapId(sub.categoryId, categoryIds),
              isActive: sub.isActive,
              isAdminManaged: sub.isAdminManaged,
              sortOrder: sub.sortOrder,
            },
          });
          subIds.set(sub.id, created.id);
        }

        for (const sub of after.subCategories) {
          if (sub.id < 0 || protectedIds.has(sub.categoryId)) continue;
          const prior = before.subCategories.find((row) => row.id === sub.id);
          if (!prior) continue;
          if (
            prior.name === sub.name &&
            prior.isActive === sub.isActive &&
            prior.isAdminManaged === sub.isAdminManaged &&
            prior.categoryId === sub.categoryId
          ) {
            continue;
          }
          await tx.subCategory.update({
            where: { id: sub.id },
            data: {
              name: sub.name,
              isActive: sub.isActive,
              isAdminManaged: sub.isAdminManaged,
            },
          });
        }

        for (const product of after.products) {
          const prior = before.products.find((row) => row.id === product.id);
          if (!prior) throw new Error(`Refusing to create product #${product.id}`);
          const categoryId = mapId(product.categoryId, categoryIds);
          const subCategoryId =
            product.subCategoryId == null ? null : mapId(product.subCategoryId, subIds);
          if (prior.categoryId === categoryId && prior.subCategoryId === subCategoryId) continue;
          await tx.product.update({
            where: { id: product.id },
            data: { categoryId, subCategoryId },
          });
        }

        const beforeProductIds = new Set(before.products.map((row) => row.id));
        for (const id of beforeProductIds) {
          if (!after.products.some((row) => row.id === id)) {
            throw new Error(`Refusing to delete product #${id}`);
          }
        }

        for (const row of after.pending) {
          const prior = before.pending.find((item) => item.id === row.id);
          if (!prior) continue;
          const categoryId = row.categoryId == null ? null : mapId(row.categoryId, categoryIds);
          const subCategoryId =
            row.subCategoryId == null ? null : mapId(row.subCategoryId, subIds);
          if (prior.categoryId === categoryId && prior.subCategoryId === subCategoryId) continue;
          await tx.supplierPendingImport.update({
            where: { id: row.id },
            data: { categoryId, subCategoryId },
          });
        }

        const afterMappingIds = new Set(after.mappings.map((row) => row.id));
        for (const prior of before.mappings) {
          if (prior.id < 0 || afterMappingIds.has(prior.id)) continue;
          await tx.supplierCategoryMapping.delete({ where: { id: prior.id } });
        }

        for (const mapping of after.mappings) {
          const data = {
            supplierId: mapId(mapping.supplierId, supplierIds),
            remoteFolder: mapping.remoteFolder,
            categoryId: mapId(mapping.categoryId, categoryIds),
            subCategoryId:
              mapping.subCategoryId == null ? null : mapId(mapping.subCategoryId, subIds),
          };
          if (mapping.id < 0) {
            await tx.supplierCategoryMapping.create({ data });
            continue;
          }
          const prior = before.mappings.find((row) => row.id === mapping.id);
          if (
            prior &&
            prior.remoteFolder === data.remoteFolder &&
            prior.categoryId === data.categoryId &&
            prior.subCategoryId === data.subCategoryId &&
            prior.supplierId === data.supplierId
          ) {
            continue;
          }
          await tx.supplierCategoryMapping.update({ where: { id: mapping.id }, data });
        }
      },
      { timeout: 30_000 },
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function loadSnapshot(): Promise<SeedSnapshot> {
  const { prisma } = await import("../lib/prisma.js");
  const [categories, subCategories, products, pending, mappings, suppliers] = await Promise.all([
    prisma.category.findMany({
      select: { id: true, name: true, description: true, isActive: true, isAdminManaged: true },
    }),
    prisma.subCategory.findMany({
      select: {
        id: true,
        name: true,
        categoryId: true,
        isActive: true,
        isAdminManaged: true,
        sortOrder: true,
      },
    }),
    prisma.product.findMany({
      select: { id: true, name: true, categoryId: true, subCategoryId: true },
    }),
    prisma.supplierPendingImport.findMany({
      select: { id: true, categoryId: true, subCategoryId: true },
    }),
    prisma.supplierCategoryMapping.findMany({
      select: {
        id: true,
        supplierId: true,
        remoteFolder: true,
        categoryId: true,
        subCategoryId: true,
      },
    }),
    prisma.supplier.findMany({ select: { id: true, name: true, isActive: true } }),
  ]);
  return { categories, subCategories, products, pending, mappings, suppliers };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const before = args.fixture ? productionLikeFixture() : await loadSnapshot();
  const plan = planQuantumCategorySeed(before);
  printPlan(plan.logs);
  if (args.dryRun || args.fixture) {
    console.log("[quantum-categories] dry-run: no rows written");
    if (!args.fixture) {
      const { prisma } = await import("../lib/prisma.js");
      await prisma.$disconnect();
    }
    if (plan.skipped > 0) process.exitCode = 1;
    return;
  }
  await applySnapshot(before, plan.next);
  console.log("[quantum-categories] wrote changes");
  if (plan.skipped > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("[quantum-categories] failed:", error);
  process.exitCode = 1;
});
