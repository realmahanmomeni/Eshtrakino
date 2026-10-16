import { prisma } from "../../lib/prisma";
import { isStarsCatalog } from "./starsPricingService";
import { isTelegramServicesCategory } from "./catalogAvailability";
import { isAutomaticHierarchyBlocked } from "./catalogHierarchyGuard";

export type BrandRule = {
  /** Bilingual subcategory label shown in Telegram UI */
  subCategoryName: string;
  pattern: RegExp;
};

export type CategoryTaxonomy = {
  key: string;
  name: string;
  description: string;
  brands: BrandRule[];
  /** Previous category titles to merge/rename */
  legacyNames?: string[];
};

/** Canonical shop taxonomy (deterministic brand → subcategory). */
export const SHOP_TAXONOMY: CategoryTaxonomy[] = [
  {
    key: "ai_tools",
    name: "🤖 ابزارهای هوش مصنوعی",
    description: "ChatGPT، Gemini، Claude، Grok، Zoom و سایر ابزارهای AI",
    legacyNames: [
      "🤖 ابزارهای AI",
      "ابزارهای هوش مصنوعی",
      "🤖 ابزارهای هوش مصنوعی | AI Tools",
    ],
    brands: [
      { subCategoryName: "ChatGPT | چت‌جی‌پی‌تی", pattern: /chatgpt|gpt|چت.?جی.?پی.?تی/i },
      {
        subCategoryName: "Gemini | جمنای",
        pattern: /gemini|جمنای|google\s*one|گوگل\s*وان/i,
      },
      { subCategoryName: "Claude | کلود", pattern: /claude|کلود/i },
      { subCategoryName: "Grok | گروک", pattern: /grok|گروک/i },
      { subCategoryName: "Zoom | زوم", pattern: /zoom|زوم/i },
      { subCategoryName: "ElevenLabs | الون‌لبز", pattern: /elevenlabs|ایلِون|الون/i },
      { subCategoryName: "Runway | ران‌وی", pattern: /runway|ران.?وی/i },
      { subCategoryName: "Perplexity | پرپلکسیتی", pattern: /perplexity|پرپلکسیتی/i },
      { subCategoryName: "Gamma | گاما", pattern: /gamma|گاما/i },
      {
        subCategoryName: "Higgfield | هیگزفیلد",
        pattern: /higgfield|higgsfield|هیگz?س?فیلد|higg\s*max/i,
      },
      { subCategoryName: "LartAI | لارت", pattern: /lartai|lart|لارت/i },
      { subCategoryName: "Suno | سونو", pattern: /suno|سونو/i },
      { subCategoryName: "Lovable | لاوابل", pattern: /lovable|لاوابل/i },
      { subCategoryName: "Muse AI | میوز", pattern: /muse\s*ai|میوز\s*ai/i },
      { subCategoryName: "Freepik | فری‌پیک", pattern: /freepik|فری.?پیک/i },
    ],
  },
  {
    key: "apple_services",
    name: "🍏 اپل آیدی و آیکلود",
    description: "Apple ID و فضای iCloud",
    legacyNames: [
      "🍏 اپل",
      "Apple",
      "اپل آیدی",
      "🍏 اپل آیدی و آیکلود | Apple & iCloud",
    ],
    brands: [
      { subCategoryName: "Apple ID | اپل آیدی", pattern: /apple\s*id|اپل\s*آیدی/i },
      { subCategoryName: "iCloud | آی‌کلود", pattern: /icloud|آی.?کلود/i },
      { subCategoryName: "Apple ID | اپل آیدی", pattern: /apple|اپل/i },
    ],
  },
  {
    key: "gmail_office",
    name: "📧 جیمیل و آفیس",
    description: "Gmail، Outlook و Microsoft 365",
    legacyNames: ["📧 اکانت و آفیس", "اکانت و آفیس", "📧 جیمیل و آفیس | Gmail & Office"],
    brands: [
      { subCategoryName: "Gmail | جیمیل", pattern: /gmail|جیمیل/i },
      { subCategoryName: "Outlook | اوت‌لوک", pattern: /outlook|اوت.?لوک/i },
      {
        subCategoryName: "Microsoft 365 | مایکروسافت ۳۶۵",
        pattern: /microsoft|office|آفیس|مايکروسافت|office\s*365/i,
      },
    ],
  },
  {
    key: "stream_media",
    name: "🎬 فیلم و موسیقی",
    description: "Spotify، Netflix، YouTube",
    legacyNames: ["🎬 استریم و فیلم", "🎬 فیلم و موسیقی | Stream & Media"],
    brands: [
      { subCategoryName: "Spotify | اسپاتیفای", pattern: /spotify|اسپاتیفای/i },
      { subCategoryName: "Netflix | نتفلیکس", pattern: /netflix|نتفلیکس|نتflix/i },
      { subCategoryName: "YouTube | یوتیوب", pattern: /youtube|یوتیوب/i },
      { subCategoryName: "Prime Video | پرایم ویدیو", pattern: /prime\s*video|پرایم\s*ویدیو/i },
    ],
  },
  {
    key: "design_edit",
    name: "🎨 طراحی و ادیت",
    description: "Canva، Adobe، CapCut و ابزار طراحی",
    legacyNames: ["🎨 طراحی و ادیت | Design & Edit"],
    brands: [
      { subCategoryName: "Canva | کانوا", pattern: /canva|کانوا/i },
      { subCategoryName: "Adobe | ادوبی", pattern: /adobe|ادوبی/i },
      { subCategoryName: "CapCut | کپ‌کات", pattern: /capcut|کپ.?کات/i },
      { subCategoryName: "Envato Elements | اینواتو", pattern: /envato|اینواتو/i },
      { subCategoryName: "Wondershare | فیلمورا", pattern: /filmora|فیلمورا|wondershare/i },
      { subCategoryName: "Xingtu | شینگ‌تو", pattern: /xingtu|شینگ.?تو/i },
      { subCategoryName: "Wink | وینک", pattern: /\bwink\b|وینک/i },
      { subCategoryName: "Meitu | میتو", pattern: /meitu|میتو/i },
    ],
  },
  {
    key: "dev_productivity",
    name: "💻 برنامه‌نویسی و وب",
    description: "Cursor، Notion و ابزار توسعه",
    legacyNames: ["💻 برنامه‌نویسی و وب | Dev & Productivity"],
    brands: [
      { subCategoryName: "Cursor | کرسر", pattern: /cursor|کرسر/i },
      { subCategoryName: "Notion | نوشن", pattern: /notion|نوشن/i },
    ],
  },
  {
    key: "vpn_security",
    name: "🛡 امنیت و VPN",
    description: "NordVPN، Surfshark و VPN",
    legacyNames: ["🛡 امنیت و VPN | Security & VPN"],
    brands: [
      { subCategoryName: "NordVPN | نورد", pattern: /nordvpn|nord\s*vpn/i },
      { subCategoryName: "Surfshark | سرف‌شارک", pattern: /surfshark|surf\s*shark/i },
      { subCategoryName: "VPN | وی‌پی‌ان", pattern: /\bvpn\b|وی.?پی.?ان/i },
    ],
  },
  {
    key: "education",
    name: "🎓 آموزش و مهارت",
    description: "Duolingo، Udemy، Coursera",
    legacyNames: ["🎓 آموزش و زبان", "🎓 آموزش و زبان | Education"],
    brands: [
      { subCategoryName: "Duolingo | دولینگو", pattern: /duolingo|دولینگو/i },
      { subCategoryName: "Udemy | یودمی", pattern: /udemy|یودمی/i },
      { subCategoryName: "Coursera | کورسرا", pattern: /coursera|کورسرا|کورsera/i },
      { subCategoryName: "Grammarly | گرامرلی", pattern: /grammarly|گرامرلی/i },
      { subCategoryName: "QuillBot | کوییل‌بات", pattern: /quillbot|کوییل.?بات/i },
      {
        subCategoryName: "LinkedIn | لینکدین",
        pattern: /linkedin|لینکدین|sales\s*navigator|سیلز\s*ناوی/i,
      },
    ],
  },
  {
    key: "telegram_services",
    name: "🚀 خدمات تلگرام",
    description: "استارز و پریمیوم — تحویل توسط اشتراکینو",
    legacyNames: ["🚀 خدمات تلگرام | Telegram"],
    brands: [
      { subCategoryName: "Telegram Stars | استارز تلگرام", pattern: /stars|استارز/i },
      {
        subCategoryName: "Telegram Premium | پریمیوم تلگرام",
        pattern: /premium|پریمیوم|پرمیوم/i,
      },
    ],
  },
];

/** Split/junk subcategories created by bad sync (product title fragments). */
export const CORRUPTED_SUBCATEGORY_NAMES = new Set([
  "۵۰۰",
  "500",
  "سوپر",
  "گارانتی",
  "دارایی‌های",
  "CDK",
  "کلید",
  "اعتبارات",
  "اعتبار",
  "پریم",
  "پیست",
  "طرح",
  "کورsera",
  "کورسرا",
  "ChatGPT",
  "Gemini",
  "Grok",
  "Zoom",
  "Runway",
  "Spotify",
  "Canva",
  "NordVPN",
  "Other",
  "سایر",
  "Adobe",
  "ادوبی",
  "دارایی‌های خلاقانه",
]);

export type ShopCategorySpec = {
  name: string;
  description: string;
  brandKeywords: string[];
};

export const SHOP_CATEGORY_SPECS: ShopCategorySpec[] = SHOP_TAXONOMY.map((t) => ({
  name: t.name,
  description: t.description,
  brandKeywords: t.brands.map((b) => b.subCategoryName.split("|")[0]!.trim().toLowerCase()),
}));

const CANONICAL_SUBCATEGORY_NAMES = new Set(
  SHOP_TAXONOMY.flatMap((t) => t.brands.map((b) => b.subCategoryName)),
);

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function resolveBrandRule(productName: string): {
  taxonomy: CategoryTaxonomy;
  brand: BrandRule;
} | null {
  const blob = productName.trim();
  if (!blob) return null;

  for (const taxonomy of SHOP_TAXONOMY) {
    for (const brand of taxonomy.brands) {
      if (brand.pattern.test(blob)) {
        return { taxonomy, brand };
      }
    }
  }
  return null;
}

export function resolveTelegramBrand(productName: string): BrandRule | null {
  if (isStarsCatalog(productName)) {
    return {
      subCategoryName: "Telegram Stars | استارز تلگرام",
      pattern: /stars/i,
    };
  }
  if (/premium|پریمیوم|پرمیوم|پریموم/i.test(productName)) {
    return {
      subCategoryName: "Telegram Premium | پریمیوم تلگرام",
      pattern: /premium/i,
    };
  }
  return null;
}

export function isCorruptedSubCategoryName(name: string): boolean {
  const trimmed = name.trim();
  if (CORRUPTED_SUBCATEGORY_NAMES.has(trimmed)) return true;
  if (/^\d+$/.test(trimmed)) return true;
  if (CANONICAL_SUBCATEGORY_NAMES.has(trimmed)) return false;
  if (trimmed.length <= 3 && !trimmed.includes("|")) return true;
  if (/^(سوپر|اعتبار|گارانتی|دارایی|CDK|کلید|پریم|پیست|طرح)\b/i.test(trimmed)) {
    return true;
  }
  return false;
}

export async function ensureTaxonomyCategory(taxonomy: CategoryTaxonomy) {
  let category = await prisma.category.findFirst({ where: { name: taxonomy.name } });
  if (!category && taxonomy.legacyNames) {
    for (const legacy of taxonomy.legacyNames) {
      category = await prisma.category.findFirst({ where: { name: legacy } });
      if (category) break;
    }
  }
  if (category) {
    return prisma.category.update({
      where: { id: category.id },
      data: {
        name: taxonomy.name,
        description: taxonomy.description,
        isActive: true,
      },
    });
  }
  return prisma.category.create({
    data: {
      name: taxonomy.name,
      description: taxonomy.description,
      isActive: true,
    },
  });
}

export async function ensureShopCategoriesExist(): Promise<void> {
  for (const taxonomy of SHOP_TAXONOMY) {
    await ensureTaxonomyCategory(taxonomy);
  }
}

export async function ensureSubCategoryForBrand(
  categoryId: number,
  brandName: string,
): Promise<{ id: number; categoryId: number }> {
  const trimmed = brandName.trim();
  let sub = await prisma.subCategory.findFirst({
    where: { categoryId, name: trimmed },
  });
  if (!sub) {
    sub = await prisma.subCategory.create({
      data: {
        categoryId,
        name: trimmed,
        isActive: true,
        sortOrder: 0,
      },
    });
  } else if (!sub.isActive) {
    sub = await prisma.subCategory.update({
      where: { id: sub.id },
      data: { isActive: true },
    });
  }
  return sub;
}

export async function assignProductToShopHierarchy(
  productId: number,
  productName: string,
): Promise<{ categoryId: number; subCategoryId: number } | null> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      category: true,
      subCategory: true,
      supplierProductMapping: true,
    },
  });
  if (!product) return null;

  if (isAutomaticHierarchyBlocked(product)) {
    return {
      categoryId: product.categoryId,
      subCategoryId: product.subCategoryId ?? 0,
    };
  }

  const telegramTaxonomy = SHOP_TAXONOMY.find((t) => t.key === "telegram_services")!;
  const telegramCat = await prisma.category.findFirst({
    where: {
      OR: [
        { name: telegramTaxonomy.name },
        ...(telegramTaxonomy.legacyNames?.map((n) => ({ name: n })) ?? []),
      ],
    },
  });

  const inTelegramServices =
    (telegramCat && product.categoryId === telegramCat.id) ||
    isTelegramServicesCategory(product.category, product.subCategory);

  if (inTelegramServices) {
    if (product.supplierProductMapping) {
      return {
        categoryId: product.categoryId,
        subCategoryId: product.subCategoryId ?? 0,
      };
    }

    const tgBrand = resolveTelegramBrand(productName);
    if (tgBrand) {
      const categoryId = telegramCat?.id ?? product.categoryId;
      const sub = await ensureSubCategoryForBrand(categoryId, tgBrand.subCategoryName);
      if (product.subCategoryId !== sub.id || product.categoryId !== categoryId) {
        await prisma.product.update({
          where: { id: productId },
          data: { categoryId, subCategoryId: sub.id },
        });
      }
      return { categoryId, subCategoryId: sub.id };
    }
    const { findHardReassignRule, applyHardReassignRule } = await import(
      "./productOtherMigration.js"
    );
    const hard = findHardReassignRule(productName, product.description);
    if (hard) {
      await applyHardReassignRule(productId, hard);
      const updated = await prisma.product.findUnique({
        where: { id: productId },
        select: { categoryId: true, subCategoryId: true },
      });
      return {
        categoryId: updated!.categoryId,
        subCategoryId: updated!.subCategoryId!,
      };
    }
    const resolvedOut = resolveBrandRule(productName);
    if (resolvedOut) {
      const category = await ensureTaxonomyCategory(resolvedOut.taxonomy);
      const sub = await ensureSubCategoryForBrand(
        category.id,
        resolvedOut.brand.subCategoryName,
      );
      await prisma.product.update({
        where: { id: productId },
        data: { categoryId: category.id, subCategoryId: sub.id },
      });
      return { categoryId: category.id, subCategoryId: sub.id };
    }
    return {
      categoryId: product.categoryId,
      subCategoryId: product.subCategoryId ?? 0,
    };
  }

  const { findHardReassignRule, applyHardReassignRule } = await import(
    "./productOtherMigration.js"
  );
  const hardRule = findHardReassignRule(productName, product.description);
  if (hardRule) {
    await applyHardReassignRule(productId, hardRule);
    const updated = await prisma.product.findUnique({
      where: { id: productId },
      select: { categoryId: true, subCategoryId: true },
    });
    return {
      categoryId: updated!.categoryId,
      subCategoryId: updated!.subCategoryId!,
    };
  }

  const resolved = resolveBrandRule(productName);
  if (!resolved) {
    return {
      categoryId: product.categoryId,
      subCategoryId: product.subCategoryId ?? 0,
    };
  }

  const category = await ensureTaxonomyCategory(resolved.taxonomy);
  const categoryId = category.id;
  const subCategoryName = resolved.brand.subCategoryName;

  const sub = await ensureSubCategoryForBrand(categoryId, subCategoryName);

  const desc =
    product.description && !/canboso|کنبوسo/i.test(product.description)
      ? product.description
      : "سرویس دیجیتال اشتراکینو";

  await prisma.product.update({
    where: { id: productId },
    data: {
      categoryId,
      subCategoryId: sub.id,
      description: desc.replace(/canboso/gi, "اشتراکینو").replace(/کنبوسo/gi, "اشتراکینو"),
    },
  });

  return { categoryId, subCategoryId: sub.id };
}

/** Deactivate junk subcategories and re-nest all products under canonical brands. */
export async function purgeCorruptedSubCategories(): Promise<number> {
  let purged = 0;
  const subs = await prisma.subCategory.findMany();
  for (const sub of subs) {
    if (sub.isAdminManaged) continue;
    if (!isCorruptedSubCategoryName(sub.name)) continue;

    const products = await prisma.product.findMany({ where: { subCategoryId: sub.id } });
    for (const p of products) {
      await assignProductToShopHierarchy(p.id, p.name);
    }

    const remaining = await prisma.product.count({ where: { subCategoryId: sub.id } });
    if (remaining === 0) {
      await prisma.subCategory.update({
        where: { id: sub.id },
        data: { isActive: false },
      });
      purged += 1;
    }
  }
  return purged;
}

/** Reassign every product using deterministic brand rules (Google One → Gemini, etc.). */
export async function reassignAllProductsToBrandTaxonomy(): Promise<number> {
  const products = await prisma.product.findMany({
    include: { category: true, subCategory: true },
  });
  let moved = 0;
  for (const product of products) {
    if (isAutomaticHierarchyBlocked(product)) continue;
    const beforeCat = product.categoryId;
    const beforeSub = product.subCategoryId;
    const result = await assignProductToShopHierarchy(product.id, product.name);
    if (
      result &&
      (result.categoryId !== beforeCat || result.subCategoryId !== beforeSub)
    ) {
      moved += 1;
    }
  }
  return moved;
}

export async function repairAllProductSubCategories(): Promise<number> {
  await purgeCorruptedSubCategories();
  return reassignAllProductsToBrandTaxonomy();
}

export function normalizeSupplierProductName(name: string): string {
  return normalize(name).replace(/[^\p{L}\p{N}\s]/gu, "");
}

/** Legacy export for keyword-based fallback */
export function resolveCategorySpec(productName: string): ShopCategorySpec | null {
  const resolved = resolveBrandRule(productName);
  if (!resolved) return null;
  return SHOP_CATEGORY_SPECS.find((s) => s.name === resolved.taxonomy.name) ?? null;
}

export function extractBrandSubCategoryName(productName: string): string {
  const resolved = resolveBrandRule(productName);
  if (resolved) return resolved.brand.subCategoryName;
  const tg = resolveTelegramBrand(productName);
  if (tg) return tg.subCategoryName;
  return "Unassigned";
}

async function deactivateEmptyLegacyCategories(): Promise<void> {
  for (const taxonomy of SHOP_TAXONOMY) {
    for (const legacy of taxonomy.legacyNames ?? []) {
      if (legacy === taxonomy.name) continue;
      const old = await prisma.category.findFirst({ where: { name: legacy } });
      if (!old) continue;
      const count = await prisma.product.count({ where: { categoryId: old.id } });
      if (count === 0) {
        await prisma.category.update({
          where: { id: old.id },
          data: { isActive: false },
        });
      }
    }
  }
}

/**
 * Soft-deactivate only corrupted empty subcategories (never hard-delete admin/shop subs).
 * Previously deleted all empty subs — that removed admin-created Quilbot/Muse/Freepik rows.
 */
export async function deleteEmptySubCategories(): Promise<number> {
  let deactivated = 0;
  const subs = await prisma.subCategory.findMany({ where: { isActive: true } });
  for (const sub of subs) {
    if (sub.isAdminManaged) continue;
    if (!isCorruptedSubCategoryName(sub.name)) continue;
    const count = await prisma.product.count({ where: { subCategoryId: sub.id } });
    if (count > 0) continue;
    await prisma.subCategory.update({
      where: { id: sub.id },
      data: { isActive: false },
    });
    deactivated += 1;
  }
  return deactivated;
}

export async function applyBrandTaxonomyMigration(): Promise<{
  purged: number;
  reassigned: number;
  deletedEmptySubs: number;
}> {
  await ensureShopCategoriesExist();
  const purged = await purgeCorruptedSubCategories();
  const reassigned = await reassignAllProductsToBrandTaxonomy();
  const deletedEmptySubs = await deleteEmptySubCategories();
  await deactivateEmptyLegacyCategories();

  const { runCatalogDatabasePurge } = await import("./productOtherMigration.js");
  await runCatalogDatabasePurge();

  return { purged, reassigned, deletedEmptySubs };
}
