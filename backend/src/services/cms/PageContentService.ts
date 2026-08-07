import { prisma } from "../../lib/prisma";

/** Stable page keys used across UI + admin CMS. */
export const PAGE_KEYS = ["home", "shop", "account", "support", "wallet"] as const;
export type PageKey = (typeof PAGE_KEYS)[number];

export type PageMediaType = "photo" | "video";
export type LayoutColumns = 1 | 2;

export interface CmsPageContent {
  pageKey: PageKey;
  textContent: string;
  mediaFileId: string | null;
  mediaType: PageMediaType | null;
  layoutColumns: LayoutColumns;
}

export function isPageKey(value: string | undefined | null): value is PageKey {
  return !!value && (PAGE_KEYS as readonly string[]).includes(value);
}

/** Fallback copy when no DB row exists yet. */
export const DEFAULT_PAGE_TEXTS: Record<PageKey, string> = {
  home: [
    "✨ به *اشتراکینو* خوش آمدید!",
    "",
    "مرجع امن خرید اشتراک ابزارهای دیجیتال.",
    "",
    "👇 از منوی زیر یک گزینه را انتخاب کنید:",
  ].join("\n"),
  shop: [
    "🛒 *فروشگاه*",
    "",
    "دسته بندی مورد نظر را انتخاب کنید:",
  ].join("\n"),
  account: [
    "👤 *حساب کاربری*",
    "",
    "اطلاعات حساب و وضعیت سفارش‌های شما:",
  ].join("\n"),
  support: [
    "🎧 *پشتیبانی*",
    "",
    "برای ارتباط با تیم پشتیبانی، دکمه ارسال تیکت را بزنید.",
  ].join("\n"),
  wallet: [
    "💰 *کیف پول من*",
    "",
    "موجودی خود را ببینید و در صورت نیاز شارژ کنید.",
  ].join("\n"),
};

function normalizeLayout(raw: number | null | undefined): LayoutColumns {
  return raw === 2 ? 2 : 1;
}

function normalizeMediaType(raw: string | null | undefined): PageMediaType | null {
  if (raw === "photo" || raw === "video") return raw;
  return null;
}

export class PageContentService {
  async getPage(pageKey: PageKey): Promise<CmsPageContent> {
    const row = await prisma.pageContent.findUnique({ where: { pageKey } });
    const text = row?.textContent?.trim();
    return {
      pageKey,
      textContent: text || DEFAULT_PAGE_TEXTS[pageKey],
      mediaFileId: row?.mediaFileId?.trim() || null,
      mediaType: normalizeMediaType(row?.mediaType),
      layoutColumns: normalizeLayout(row?.layoutColumns),
    };
  }

  async getText(pageKey: PageKey): Promise<string> {
    const page = await this.getPage(pageKey);
    return page.textContent;
  }

  async setText(pageKey: PageKey, textContent: string): Promise<CmsPageContent> {
    const value = textContent.trim();
    await prisma.pageContent.upsert({
      where: { pageKey },
      create: { pageKey, textContent: value, layoutColumns: 1 },
      update: { textContent: value },
    });
    return this.getPage(pageKey);
  }

  async setMedia(
    pageKey: PageKey,
    mediaFileId: string,
    mediaType: PageMediaType,
  ): Promise<CmsPageContent> {
    const existing = await this.getText(pageKey);
    await prisma.pageContent.upsert({
      where: { pageKey },
      create: {
        pageKey,
        textContent: existing,
        mediaFileId,
        mediaType,
        layoutColumns: 1,
      },
      update: { mediaFileId, mediaType },
    });
    return this.getPage(pageKey);
  }

  async clearMedia(pageKey: PageKey): Promise<CmsPageContent> {
    const existing = await this.getText(pageKey);
    await prisma.pageContent.upsert({
      where: { pageKey },
      create: {
        pageKey,
        textContent: existing,
        mediaFileId: null,
        mediaType: null,
        layoutColumns: 1,
      },
      update: { mediaFileId: null, mediaType: null },
    });
    return this.getPage(pageKey);
  }

  /** Toggle 1 ↔ 2 columns; returns the new layout value. */
  async toggleLayout(pageKey: PageKey): Promise<LayoutColumns> {
    const page = await this.getPage(pageKey);
    const next: LayoutColumns = page.layoutColumns === 1 ? 2 : 1;
    await prisma.pageContent.upsert({
      where: { pageKey },
      create: {
        pageKey,
        textContent: page.textContent,
        layoutColumns: next,
      },
      update: { layoutColumns: next },
    });
    return next;
  }
}

export const pageContentService = new PageContentService();

/** Plain text for Telegram Bot API description fields (no Markdown). */
export function toBotDescription(text: string, max = 512): string {
  return text
    .replace(/[*_`\[\]]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}
