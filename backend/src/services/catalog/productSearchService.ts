import type { DeliveryType } from "@prisma/client";
import { prisma } from "../../lib/prisma";

/** Bilingual synonym groups — any hit expands to all terms in the group. */
const SEARCH_SYNONYM_GROUPS: string[][] = [
  ["grok", "\u06AF\u0631\u0648\u06A9"],
  ["chatgpt", "gpt", "چت جی پی تی", "چت جی‌پی‌تی", "جی پی تی", "چت‌جی‌پی‌تی"],
  ["gemini", "جمنای", "google one", "گوگل وان"],
  ["claude", "کلود"],
  ["zoom", "زوم"],
  ["runway", "ران وی", "ران‌وی", "رانوی"],
  ["spotify", "اسپاتیفای"],
  ["netflix", "نتفلیکس"],
  ["youtube", "یوتیوب"],
  ["canva", "کانوا"],
  ["capcut", "کپ کات", "کپ‌کات"],
  ["nordvpn", "nord vpn", "نورد"],
  ["duolingo", "دولینگو"],
  ["apple", "اپل", "apple id", "اپل آیدی"],
  ["icloud", "\u0622\u06CC\u06A9\u0644\u0648\u062F", "آی‌کلود", "آی کلود"],
  ["elevenlabs", "الون", "eleven labs"],
  ["perplexity", "پرپلکسیتی"],
  ["gamma", "گاما"],
  ["notion", "نوشن"],
  ["cursor", "کرسر"],
  ["surfshark", "سرف"],
  ["telegram stars", "استارز", "stars"],
  ["premium", "پریمیوم", "تلگرام پریمیوم"],
  ["linkedin", "لینکدین", "sales navigator", "salesnavigator", "سیلز ناویگیتور", "navigator"],
];

function fixPersianChars(input: string): string {
  return input
    .replace(/[\u064A\u0649]/g, "ی")
    .replace(/[\u0643]/g, "ک")
    .replace(/\u200c/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeSearchQuery(raw: string): string {
  return fixPersianChars(raw).toLowerCase();
}

export function expandSearchTerms(rawQuery: string): string[] {
  const normalized = normalizeSearchQuery(rawQuery);
  if (!normalized) return [];

  const terms = new Set<string>([normalized]);

  for (const word of normalized.split(/\s+/)) {
    if (word.length >= 2) terms.add(word);
  }

  for (const group of SEARCH_SYNONYM_GROUPS) {
    const normalizedGroup = group.map((g) => normalizeSearchQuery(g));
    const matched = normalizedGroup.some(
      (g) =>
        g.length >= 2 &&
        (normalized.includes(g) || g.includes(normalized) || normalized === g),
    );
    if (matched) {
      for (const g of normalizedGroup) {
        if (g.length >= 2) terms.add(g);
      }
      for (const original of group) {
        terms.add(original);
        terms.add(normalizeSearchQuery(original));
      }
    }
  }

  return [...terms].filter((t) => t.length >= 2);
}

/** Plain JSON — safe for grammY `conversation.external()` / structuredClone. */
export type CatalogSearchResultDto = {
  id: number;
  name: string;
  description: string | null;
  price: number;
  isActive: boolean;
  subCategoryId: number | null;
  categoryId: number;
  deliveryType: DeliveryType;
  categoryName: string | null;
  subCategoryName: string | null;
};

/** @deprecated Use CatalogSearchResultDto */
export type ProductSearchHit = CatalogSearchResultDto;

function toCatalogSearchResultDto(
  row: {
    id: number;
    name: string;
    description: string | null;
    price: { toString(): string } | number;
    isActive: boolean;
    subCategoryId: number | null;
    categoryId: number;
    deliveryType: DeliveryType;
    category: { name: string } | null;
    subCategory: { name: string } | null;
  },
): CatalogSearchResultDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: Number(row.price),
    isActive: row.isActive,
    subCategoryId: row.subCategoryId,
    categoryId: row.categoryId,
    deliveryType: row.deliveryType,
    categoryName: row.category?.name ?? null,
    subCategoryName: row.subCategory?.name ?? null,
  };
}

export type SearchCatalogOptions = {
  limit?: number;
  /** Include inactive rows (same pool as admin shop browse with «نمایش ناموجودها»). */
  includeInactiveProducts?: boolean;
};

/** Shop search visibility: admins with OOS toggle see inactive/OOS catalog rows. */
export function shouldSearchIncludeInactiveProducts(isAdmin: boolean, showOutOfStock: boolean): boolean {
  return isAdmin && showOutOfStock;
}

export async function searchCatalogProducts(
  rawQuery: string,
  options?: SearchCatalogOptions,
): Promise<CatalogSearchResultDto[]> {
  const limit = options?.limit ?? 24;
  const terms = expandSearchTerms(rawQuery);
  if (terms.length === 0) return [];

  const orConditions = terms.flatMap((term) => [
    { name: { contains: term, mode: "insensitive" as const } },
    { description: { contains: term, mode: "insensitive" as const } },
    { subCategory: { is: { name: { contains: term, mode: "insensitive" as const } } } },
    { category: { is: { name: { contains: term, mode: "insensitive" as const } } } },
  ]);

  const rows = await prisma.product.findMany({
    where: {
      ...(options?.includeInactiveProducts ? {} : { isActive: true }),
      OR: orConditions,
    },
    include: {
      category: { select: { name: true } },
      subCategory: { select: { name: true } },
    },
    orderBy: [{ isActive: "desc" }, { id: "asc" }],
    take: Math.min(limit, 40),
  });

  return rows
    .filter(
      (p) =>
        !/canboso|کنبوسo/i.test(p.name) &&
        !(p.description && /canboso|کنبوسo/i.test(p.description)),
    )
    .map(toCatalogSearchResultDto);
}
