import { prisma } from "../../lib/prisma";
import {
  ensureSubCategoryForBrand,
  ensureTaxonomyCategory,
  resolveBrandRule,
  SHOP_TAXONOMY,
} from "./brandCatalog";
import { polishCustomerProductTitle } from "./productTitlePolish";

export type HardReassignRule = {
  pattern: RegExp;
  taxonomyKey: string;
  subCategoryName: string;
  cleanName: string;
};

export const HARD_REASSIGN_RULES: HardReassignRule[] = [
  {
    pattern: /quillbot|کوییل.?بات/i,
    taxonomyKey: "ai_tools",
    subCategoryName: "QuillBot | کوییل‌بات",
    cleanName: "کوییل‌بات پریمیوم",
  },
  {
    pattern: /جی.?پی.?تی\s*پلاس\s*۳۰\s*روز|chatgpt\s*gmail|آزمایش\s*chatgpt|gpt\s*plus.*جدید/i,
    taxonomyKey: "ai_tools",
    subCategoryName: "ChatGPT | چت‌جی‌پی‌تی",
    cleanName: "چت‌جی‌پی‌تی پلاس ۱ ماهه",
  },
  {
    pattern: /k12|edu.*۲\s*سال|۲\s*سال.*edu/i,
    taxonomyKey: "ai_tools",
    subCategoryName: "ChatGPT | چت‌جی‌پی‌تی",
    cleanName: "چت‌جی‌پی‌تی پلاس ۲ ساله (تحصیلی Edu)",
  },
  {
    pattern: /اپل\s*پی|apple\s*pay/i,
    taxonomyKey: "ai_tools",
    subCategoryName: "ChatGPT | چت‌جی‌پی‌تی",
    cleanName: "چت‌جی‌پی‌تی پلاس ۱ ماهه (پرداخت رسمی اپل)",
  },
  {
    pattern: /gmail.*chatgpt|chatgpt.*gmail|جیمیل.*اختصاص|اکانت.*اختصاص/i,
    taxonomyKey: "ai_tools",
    subCategoryName: "ChatGPT | چت‌جی‌پی‌تی",
    cleanName: "چت‌جی‌پی‌تی پلاس ۱ ماهه (اکانت اختصاصی)",
  },
  {
    pattern: /پرو\s*یکس|pro\s*x\s*5|x5/i,
    taxonomyKey: "ai_tools",
    subCategoryName: "ChatGPT | چت‌جی‌پی‌تی",
    cleanName: "چت‌جی‌پی‌تی پرو ۱ ماهه (سقف پیام ۵ برابری)",
  },
  {
    pattern: /chatgpt\s*go|\bgo\b.*chatgpt/i,
    taxonomyKey: "ai_tools",
    subCategoryName: "ChatGPT | چت‌جی‌پی‌تی",
    cleanName: "چت‌جی‌پی‌تی Go یک ماهه",
  },
  {
    pattern: /اینواتو\s*المنت|envato\s*element/i,
    taxonomyKey: "design_edit",
    subCategoryName: "Envato Elements | اینواتو",
    cleanName: "اینواتو المنتس ۱ ماهه",
  },
  {
    pattern: /فیلمورا|filmora|wondershare|دارایی.?های\s*خلاق/i,
    taxonomyKey: "design_edit",
    subCategoryName: "Wondershare | فیلمورا",
    cleanName: "فیلمورا ۳ ماهه",
  },
  {
    pattern: /پرایم\s*ویدیو|prime\s*video/i,
    taxonomyKey: "stream_media",
    subCategoryName: "Prime Video | پرایم ویدیو",
    cleanName: "پرایم ویدیو ۶ ماهه",
  },
  {
    pattern: /پیست\s*پرواز|runway\s*ml|۱۲\s*متری/i,
    taxonomyKey: "ai_tools",
    subCategoryName: "Runway | ران‌وی",
    cleanName: "ران‌وی ۱ ساله (Runway ML)",
  },
  {
    pattern: /runway\s*max|ران.?وی\s*مکس|اعتبار.*runway/i,
    taxonomyKey: "ai_tools",
    subCategoryName: "Runway | ران‌وی",
    cleanName: "ران‌وی مکس ۱ ماهه (Runway Max)",
  },
  {
    pattern: /ایلیفن\s*لبز|elevenlabs|الون.?لبز/i,
    taxonomyKey: "ai_tools",
    subCategoryName: "ElevenLabs | الون‌لبز",
    cleanName: "الون‌لبز کریتور ۳ ماهه",
  },
  {
    pattern: /لینکدین|linkedin|sales\s*navigator|سیلز\s*نا/i,
    taxonomyKey: "education",
    subCategoryName: "LinkedIn | لینکدین",
    cleanName: "سیلز ناویگیتور ۱ ماهه",
  },
  {
    pattern: /ایمیل\s*اوت.?لوک|outlook/i,
    taxonomyKey: "gmail_office",
    subCategoryName: "Outlook | اوت‌لوک",
    cleanName: "ایمیل اوت‌لوک اختصاصی",
  },
  {
    pattern: /شینگ.?تو|xingtu/i,
    taxonomyKey: "design_edit",
    subCategoryName: "Xingtu | شینگ‌تو",
    cleanName: "شینگ‌تو SVIP یک ماهه",
  },
  {
    pattern: /وینک\s*vip|wink\s*vip/i,
    taxonomyKey: "design_edit",
    subCategoryName: "Wink | وینک",
    cleanName: "وینک VIP هفت روزه",
  },
  {
    pattern: /higg\s*max\s*3000|هیگz?س?فیلد\s*مکس|higgsfield\s*max/i,
    taxonomyKey: "ai_tools",
    subCategoryName: "Higgfield | هیگزفیلد",
    cleanName: "هیگزفیلد مکس ۳۰۰۰ اعتباری",
  },
  {
    pattern: /هیگz?س?فیلد\s*پلاس|higgsfield\s*plus|higg\s*plus/i,
    taxonomyKey: "ai_tools",
    subCategoryName: "Higgfield | هیگزفیلد",
    cleanName: "هیگزفیلد پلاس ۱ ماهه",
  },
  {
    pattern: /میتو\s*vip|meitu\s*vip/i,
    taxonomyKey: "design_edit",
    subCategoryName: "Meitu | میتو",
    cleanName: "میتو VIP هفت روزه",
  },
];

function taxonomyByKey(key: string) {
  const t = SHOP_TAXONOMY.find((x) => x.key === key);
  if (!t) throw new Error(`Unknown taxonomy key: ${key}`);
  return t;
}

export function findHardReassignRule(productName: string, description?: string | null): HardReassignRule | null {
  const blob = `${productName}\n${description ?? ""}`;
  return HARD_REASSIGN_RULES.find((r) => r.pattern.test(blob)) ?? null;
}

export async function applyHardReassignRule(productId: number, rule: HardReassignRule): Promise<void> {
  const taxonomy = taxonomyByKey(rule.taxonomyKey);
  const category = await ensureTaxonomyCategory(taxonomy);
  const sub = await ensureSubCategoryForBrand(category.id, rule.subCategoryName);
  await prisma.product.update({
    where: { id: productId },
    data: {
      categoryId: category.id,
      subCategoryId: sub.id,
      name: rule.cleanName,
    },
  });
}

function isTelegramProductName(name: string): boolean {
  return /تلگرام|telegram|استارز|stars|premium|پریمیوم|پرمیوم/i.test(name);
}

async function getTelegramCategoryId(): Promise<number | null> {
  const telegramTaxonomy = SHOP_TAXONOMY.find((t) => t.key === "telegram_services")!;
  const cat = await prisma.category.findFirst({
    where: {
      OR: [
        { name: telegramTaxonomy.name },
        ...(telegramTaxonomy.legacyNames?.map((n) => ({ name: n })) ?? []),
      ],
    },
  });
  return cat?.id ?? null;
}

/** Relocate non-Telegram items out of Telegram Services; fix ChatGPT bucket contamination. */
export async function purgeMisplacedCatalogProducts(): Promise<number> {
  let moved = 0;
  const telegramCategoryId = await getTelegramCategoryId();

  const products = await prisma.product.findMany({
    include: { category: true, subCategory: true, supplierProductMapping: true },
  });

  for (const product of products) {
    const name = product.name;
    const hard = findHardReassignRule(name, product.description);
    if (hard) {
      const beforeCat = product.categoryId;
      await applyHardReassignRule(product.id, hard);
      const after = await prisma.product.findUnique({
        where: { id: product.id },
        select: { categoryId: true },
      });
      if (after && after.categoryId !== beforeCat) moved += 1;
      continue;
    }

    if (telegramCategoryId != null && product.categoryId === telegramCategoryId) {
      if (!isTelegramProductName(name)) {
        const resolved = resolveBrandRule(name);
        if (resolved) {
          const category = await ensureTaxonomyCategory(resolved.taxonomy);
          const sub = await ensureSubCategoryForBrand(category.id, resolved.brand.subCategoryName);
          await prisma.product.update({
            where: { id: product.id },
            data: { categoryId: category.id, subCategoryId: sub.id },
          });
          moved += 1;
        }
      }
      continue;
    }

    const subName = product.subCategory?.name ?? "";
    if (/chatgpt|چت.?جی.?پی.?تی/i.test(subName)) {
      let rule: HardReassignRule | null = null;
      if (/runway|ران.?وی|پیست\s*پرواز/i.test(name)) {
        rule = HARD_REASSIGN_RULES.find((r) => r.subCategoryName.includes("Runway"))!;
      } else if (/eleven|الون|ایلیفن/i.test(name)) {
        rule = HARD_REASSIGN_RULES.find((r) => r.subCategoryName.includes("ElevenLabs"))!;
      } else if (/outlook|اوت.?لوک/i.test(name)) {
        rule = HARD_REASSIGN_RULES.find((r) => r.taxonomyKey === "gmail_office")!;
      } else if (/higg|هیگ/i.test(name)) {
        rule = HARD_REASSIGN_RULES.find((r) => r.subCategoryName.includes("Higgfield"))!;
      } else if (/filmora|فیلمورا|wondershare|دارایی/i.test(name)) {
        rule = HARD_REASSIGN_RULES.find((r) => r.subCategoryName.includes("Wondershare"))!;
      }
      if (rule) {
        await applyHardReassignRule(product.id, rule);
        moved += 1;
      }
    }
  }

  return moved;
}

/** Deactivate duplicate rows (same normalized name + supplier key). Keeps lowest id. */
export async function purgeDuplicateSupplierProducts(): Promise<number> {
  const mappings = await prisma.supplierProductMapping.findMany({
    include: { product: { select: { id: true, name: true, isActive: true } } },
  });

  const groups = new Map<string, number[]>();
  for (const m of mappings) {
    const key = `${m.supplierProductKey}::${m.supplierVariantKey ?? ""}::${normalizeName(m.product.name)}`;
    const list = groups.get(key) ?? [];
    list.push(m.productId);
    groups.set(key, list);
  }

  let removed = 0;
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    ids.sort((a, b) => a - b);
    const keep = ids[0]!;
    for (const dupId of ids.slice(1)) {
      const invoiceCount = await prisma.invoice.count({ where: { productId: dupId } });
      if (invoiceCount > 0) {
        await prisma.product.update({ where: { id: dupId }, data: { isActive: false } });
      } else {
        await prisma.supplierProductMapping.deleteMany({ where: { productId: dupId } });
        await prisma.product.delete({ where: { id: dupId } });
      }
      removed += 1;
    }
    void keep;
  }

  const byName = new Map<string, number[]>();
  const all = await prisma.product.findMany({ select: { id: true, name: true } });
  for (const p of all) {
    const k = normalizeName(p.name);
    const list = byName.get(k) ?? [];
    list.push(p.id);
    byName.set(k, list);
  }
  for (const ids of byName.values()) {
    if (ids.length < 2) continue;
    ids.sort((a, b) => a - b);
    for (const dupId of ids.slice(1)) {
      const hasMapping = await prisma.supplierProductMapping.findUnique({
        where: { productId: dupId },
      });
      if (!hasMapping) continue;
      const invoiceCount = await prisma.invoice.count({ where: { productId: dupId } });
      if (invoiceCount > 0) {
        await prisma.product.update({ where: { id: dupId }, data: { isActive: false } });
      } else {
        await prisma.supplierProductMapping.deleteMany({ where: { productId: dupId } });
        await prisma.product.delete({ where: { id: dupId } });
      }
      removed += 1;
    }
  }

  return removed;
}

function normalizeName(name: string): string {
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}

export async function polishAllCatalogProductTitles(): Promise<number> {
  const products = await prisma.product.findMany({ select: { id: true, name: true } });
  let n = 0;
  for (const p of products) {
    const hard = findHardReassignRule(p.name);
    const polished = hard?.cleanName ?? polishCustomerProductTitle(p.name);
    if (polished !== p.name) {
      await prisma.product.update({ where: { id: p.id }, data: { name: polished } });
      n += 1;
    }
  }
  return n;
}

function isOtherSubCategory(name: string): boolean {
  return /other|سایر/i.test(name);
}

function isOtherCategory(name: string): boolean {
  return /other|سایر/i.test(name);
}

export async function reassignProductsFromOtherBuckets(): Promise<number> {
  const products = await prisma.product.findMany({
    include: { category: true, subCategory: true },
  });

  let moved = 0;
  for (const product of products) {
    const inOtherCat = isOtherCategory(product.category.name);
    const inOtherSub = product.subCategory ? isOtherSubCategory(product.subCategory.name) : false;
    const rule =
      findHardReassignRule(product.name, product.description) ??
      (inOtherCat || inOtherSub
        ? findHardReassignRule(product.description ?? "", product.name)
        : null);

    if (rule) {
      await applyHardReassignRule(product.id, rule);
      moved += 1;
    }
  }
  return moved;
}

export async function purgeOtherShopCategories(): Promise<number> {
  if (await reassignProductsFromOtherBuckets()) {
    /* reassigned */
  }

  await prisma.subCategory.deleteMany({
    where: {
      OR: [
        { name: { contains: "Other", mode: "insensitive" } },
        { name: { contains: "سایر" } },
      ],
      products: { none: {} },
    },
  });

  const otherCats = await prisma.category.findMany({
    where: {
      OR: [
        { name: { contains: "other", mode: "insensitive" } },
        { name: { contains: "سایر" } },
      ],
    },
    include: { _count: { select: { products: true } } },
  });

  let removed = 0;
  for (const cat of otherCats) {
    if (cat._count.products > 0) continue;
    await prisma.subCategory.deleteMany({ where: { categoryId: cat.id } });
    await prisma.category.delete({ where: { id: cat.id } });
    removed += 1;
  }
  return removed;
}

/** Full startup purge: misplaced rows, duplicates, titles, Other buckets. */
export async function runCatalogDatabasePurge(): Promise<{
  misplaced: number;
  duplicates: number;
  titles: number;
  fromOther: number;
  purgedCats: number;
}> {
  const misplaced = await purgeMisplacedCatalogProducts();
  const duplicates = await purgeDuplicateSupplierProducts();
  const titles = await polishAllCatalogProductTitles();
  const fromOther = await reassignProductsFromOtherBuckets();
  const purgedCats = await purgeOtherShopCategories();
  console.log(
    `[CatalogPurge] misplaced=${misplaced}, duplicates=${duplicates}, titles=${titles}, fromOther=${fromOther}, purgedCats=${purgedCats}`,
  );
  return { misplaced, duplicates, titles, fromOther, purgedCats };
}

export function whiteLabelDescription(text: string): string {
  return text
    .replace(/canboso/gi, "اشتراکینو")
    .replace(/کنبوسo/gi, "اشتراکینو")
    .trim();
}
