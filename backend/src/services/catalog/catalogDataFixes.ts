import { prisma } from "../../lib/prisma";
import {
  CANONICAL_COURSERA_LATIN,
  CORRUPTED_COURSERA_TOKEN,
  repairCourseraTokenInText,
} from "../../lib/latinText";
import { isTelegramServicesCategory } from "./catalogAvailability";
import {
  ensureSubCategoryForBrand,
  resolveTelegramBrand,
} from "./brandCatalog";

const PREMIUM_TYPO_RE = /پریموم/g;

function normalizeTelegramPremiumTypos(name: string): string {
  return name.replace(PREMIUM_TYPO_RE, "پریمیوم");
}

/** Idempotent: fix «کورsera» → «Coursera» in catalog text fields only. */
export async function fixCourseraCorruptionInCatalog(): Promise<number> {
  let updated = 0;

  const products = await prisma.product.findMany({
    where: {
      OR: [
        { name: { contains: CORRUPTED_COURSERA_TOKEN } },
        { description: { contains: CORRUPTED_COURSERA_TOKEN } },
      ],
    },
    select: { id: true, name: true, description: true },
  });

  for (const p of products) {
    const name = repairCourseraTokenInText(p.name);
    const description = p.description
      ? repairCourseraTokenInText(p.description)
      : p.description;
    if (name !== p.name || description !== p.description) {
      await prisma.product.update({
        where: { id: p.id },
        data: { name, ...(description != null ? { description } : {}) },
      });
      updated += 1;
    }
  }

  const subs = await prisma.subCategory.findMany({
    where: { name: { contains: CORRUPTED_COURSERA_TOKEN } },
    select: { id: true, name: true, description: true },
  });

  for (const s of subs) {
    const name = repairCourseraTokenInText(s.name);
    const description = s.description
      ? repairCourseraTokenInText(s.description)
      : s.description;
    if (name !== s.name || description !== s.description) {
      await prisma.subCategory.update({
        where: { id: s.id },
        data: { name, ...(description != null ? { description } : {}) },
      });
      updated += 1;
    }
  }

  const categories = await prisma.category.findMany({
    where: {
      OR: [
        { name: { contains: CORRUPTED_COURSERA_TOKEN } },
        { description: { contains: CORRUPTED_COURSERA_TOKEN } },
      ],
    },
    select: { id: true, name: true, description: true },
  });

  for (const c of categories) {
    const name = repairCourseraTokenInText(c.name);
    const description = c.description
      ? repairCourseraTokenInText(c.description)
      : c.description;
    if (name !== c.name || description !== c.description) {
      await prisma.category.update({
        where: { id: c.id },
        data: { name, ...(description != null ? { description } : {}) },
      });
      updated += 1;
    }
  }

  if (updated > 0) {
    console.log(
      `[DataFix] Coursera token repair: ${updated} row(s) (${CORRUPTED_COURSERA_TOKEN} → ${CANONICAL_COURSERA_LATIN})`,
    );
  }
  return updated;
}

/** Idempotent: Telegram Premium vs Stars subcategories; normalize «پریموم» typo. Skips supplier-mapped products. */
export async function fixTelegramServicesProductPlacement(): Promise<number> {
  let updated = 0;

  const products = await prisma.product.findMany({
    where: { supplierProductMapping: null },
    include: {
      category: true,
      subCategory: true,
      supplierProductMapping: true,
    },
  });

  for (const product of products) {
    if (!isTelegramServicesCategory(product.category, product.subCategory)) {
      continue;
    }

    let name = product.name;
    const normalizedName = normalizeTelegramPremiumTypos(name);
    const tgBrand = resolveTelegramBrand(normalizedName);
    if (!tgBrand) {
      if (normalizedName !== name) {
        await prisma.product.update({
          where: { id: product.id },
          data: { name: normalizedName },
        });
        updated += 1;
      }
      continue;
    }

    const sub = await ensureSubCategoryForBrand(product.categoryId, tgBrand.subCategoryName);
    const needsUpdate =
      normalizedName !== name ||
      product.subCategoryId !== sub.id;

    if (needsUpdate) {
      await prisma.product.update({
        where: { id: product.id },
        data: {
          name: normalizedName,
          subCategoryId: sub.id,
        },
      });
      updated += 1;
    }
  }

  if (updated > 0) {
    console.log(`[DataFix] Telegram services placement/name: ${updated} product(s)`);
  }
  return updated;
}

export async function runIdempotentCatalogDataFixes(): Promise<void> {
  try {
    await fixCourseraCorruptionInCatalog();
    await fixTelegramServicesProductPlacement();
  } catch (err) {
    console.error("[DataFix] Catalog data fixes failed:", err);
  }
}
