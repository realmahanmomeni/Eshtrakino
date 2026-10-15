import { prisma } from "../../lib/prisma";
import type { Category, DeliveryType, Product } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { parseRequiredFields } from "../../lib/money";
import { exchangeRateService, convertUsdToToman } from "../exchangeRateService";

export type ProductWithCategory = Product & { category: Category };

export type SubCategoryRecord = {
  id: number;
  name: string;
  description: string | null;
  coverImageUrl: string | null;
  bannerUrl?: string | null;
  categoryId: number;
  category?: Category | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type ProductWithCategoryAndSub = Product & {
  category: Category;
  subCategory?: SubCategoryRecord | null;
  subCategoryId?: number | null;
};

/**
 * Catalog service — single source of truth for categories/products/prices.
 * Telegram keyboards MUST use these methods; never hardcode catalog items.
 */
export class CatalogService {
  async listActiveCategories(): Promise<Category[]> {
    return prisma.category.findMany({
      where: { isActive: true },
      orderBy: { id: "asc" },
    });
  }

  /** Shop home — ordered short categories for 2-column mobile layout. */
  async listShopCategories(): Promise<Category[]> {
    const { sortShopCategories, SHOP_CATEGORY_SPECS } = await import("./whiteLabelCatalog.js");
    const activeNames = new Set(SHOP_CATEGORY_SPECS.map((c) => c.name));
    const categories = await prisma.category.findMany({
      where: {
        isActive: true,
        name: { in: [...activeNames] },
      },
    });
    return sortShopCategories(categories);
  }

  async listDisplayProductsByCategory(categoryId: number): Promise<Product[]> {
    return prisma.product.findMany({
      where: { categoryId },
      orderBy: { id: "asc" },
    });
  }

  async listDisplayProductsBySubCategory(subCategoryId: number): Promise<Product[]> {
    return prisma.product.findMany({
      where: { subCategoryId },
      orderBy: { id: "asc" },
    });
  }

  async listDisplaySubCategoriesByCategory(categoryId: number): Promise<SubCategoryRecord[]> {
    return (prisma as any).subCategory.findMany({
      where: { categoryId, isActive: true },
      include: { category: true },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    });
  }

  async listCategories(activeOnly = true): Promise<Category[]> {
    return activeOnly ? this.listActiveCategories() : this.listAllCategories();
  }

  async listAllCategories(): Promise<Category[]> {
    return prisma.category.findMany({ orderBy: { id: "asc" } });
  }

  async getCategory(categoryId: number, activeOnly = true): Promise<Category | null> {
    return prisma.category.findFirst({
      where: activeOnly ? { id: categoryId, isActive: true } : { id: categoryId },
    });
  }

  async createCategory(name: string): Promise<Category> {
    const trimmed = name.trim();
    const existing = await prisma.category.findFirst({
      where: { name: trimmed },
    });
    if (existing) {
      if (!existing.isActive) {
        return prisma.category.update({
          where: { id: existing.id },
          data: { isActive: true },
        });
      }
      return existing;
    }
    return prisma.category.create({
      data: { name: trimmed, isActive: true },
    });
  }

  async updateCategoryName(categoryId: number, name: string): Promise<Category> {
    return prisma.category.update({
      where: { id: categoryId },
      data: { name: name.trim() },
    });
  }

  async updateCategoryBanner(categoryId: number, bannerUrl: string | null): Promise<Category> {
    return (prisma.category as any).update({
      where: { id: categoryId },
      data: { bannerUrl: bannerUrl ? bannerUrl.trim() : null },
    });
  }

  async updateCategoryDescription(categoryId: number, description: string | null): Promise<Category> {
    return (prisma.category as any).update({
      where: { id: categoryId },
      data: { description: description && description.trim().length > 0 ? description.trim() : null },
    });
  }

  async deleteCategory(categoryId: number): Promise<Category> {
    return prisma.category.update({
      where: { id: categoryId },
      data: { isActive: false },
    });
  }

  // --- SubCategory (Service) CRUD ---

  async listSubCategoriesByCategory(
    categoryId: number,
    activeOnly = true,
  ): Promise<SubCategoryRecord[]> {
    return (prisma as any).subCategory.findMany({
      where: activeOnly
        ? { categoryId, isActive: true }
        : { categoryId },
      include: { category: true },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    });
  }

  async listAllSubCategories(activeOnly = true): Promise<SubCategoryRecord[]> {
    return (prisma as any).subCategory.findMany({
      where: activeOnly ? { isActive: true } : {},
      include: { category: true },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    });
  }

  async getSubCategoryById(id: number): Promise<SubCategoryRecord | null> {
    return (prisma as any).subCategory.findUnique({
      where: { id },
      include: { category: true },
    });
  }

  async createSubCategory(data: {
    name: string;
    categoryId: number;
    description?: string | null;
    coverImageUrl?: string | null;
    sortOrder?: number;
  }): Promise<SubCategoryRecord> {
    const description =
      typeof data.description === "string" && data.description.trim().length > 0
        ? data.description.trim()
        : null;
    const coverImageUrl =
      typeof data.coverImageUrl === "string" && data.coverImageUrl.trim().length > 0
        ? data.coverImageUrl.trim()
        : null;

    const trimmedName = data.name.trim();
    const existing = await (prisma as any).subCategory.findFirst({
      where: {
        name: trimmedName,
        categoryId: data.categoryId,
      },
    });
    if (existing) {
      return (prisma as any).subCategory.update({
        where: { id: existing.id },
        data: {
          isActive: true,
          description: description ?? existing.description,
          coverImageUrl: coverImageUrl ?? existing.coverImageUrl,
          sortOrder: data.sortOrder ?? existing.sortOrder,
        },
      });
    }

    return (prisma as any).subCategory.create({
      data: {
        name: trimmedName,
        categoryId: data.categoryId,
        description,
        coverImageUrl,
        sortOrder: data.sortOrder ?? 0,
        isActive: true,
      },
    });
  }

  async updateSubCategory(
    id: number,
    data: Partial<{
      name: string;
      description: string | null;
      coverImageUrl: string | null;
      bannerUrl: string | null;
      isActive: boolean;
      sortOrder: number;
    }>,
  ): Promise<SubCategoryRecord> {
    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name.trim();
    if (data.description !== undefined) {
      updateData.description =
        typeof data.description === "string" && data.description.trim().length > 0
          ? data.description.trim()
          : null;
    }
    if (data.coverImageUrl !== undefined) {
      updateData.coverImageUrl =
        typeof data.coverImageUrl === "string" && data.coverImageUrl.trim().length > 0
          ? data.coverImageUrl.trim()
          : null;
    }
    if (data.bannerUrl !== undefined) {
      updateData.bannerUrl =
        typeof data.bannerUrl === "string" && data.bannerUrl.trim().length > 0
          ? data.bannerUrl.trim()
          : null;
    }
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.sortOrder !== undefined) updateData.sortOrder = data.sortOrder;

    return (prisma as any).subCategory.update({
      where: { id },
      data: updateData,
    });
  }

  async updateSubCategoryBanner(id: number, bannerUrl: string | null): Promise<SubCategoryRecord> {
    const cleanBanner = typeof bannerUrl === "string" && bannerUrl.trim().length > 0 ? bannerUrl.trim() : null;
    return (prisma as any).subCategory.update({
      where: { id },
      data: {
        bannerUrl: cleanBanner,
        coverImageUrl: cleanBanner, // Keep coverImageUrl in sync for existing views
      },
    });
  }

  async updateSubCategoryDescription(id: number, description: string | null): Promise<SubCategoryRecord> {
    return this.updateSubCategory(id, { description });
  }

  async deleteSubCategory(id: number): Promise<SubCategoryRecord> {
    return (prisma as any).subCategory.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async listActiveProductsByCategory(categoryId: number): Promise<Product[]> {
    return prisma.product.findMany({
      where: {
        categoryId,
        isActive: true,
        category: { isActive: true },
      },
      orderBy: { id: "asc" },
    });
  }

  async listActiveProductsBySubCategory(subCategoryId: number): Promise<Product[]> {
    return (prisma.product.findMany as any)({
      where: {
        subCategoryId,
        isActive: true,
        category: { isActive: true },
      },
      orderBy: { id: "asc" },
    });
  }

  async listActiveProducts(): Promise<Product[]> {
    return (prisma.product.findMany as any)({
      where: { isActive: true, category: { isActive: true } },
      orderBy: { id: "asc" },
    });
  }

  async getProduct(
    productId: number,
    activeOnly = true,
  ): Promise<ProductWithCategoryAndSub | null> {
    return (prisma.product.findFirst as any)({
      where: activeOnly
        ? { id: productId, isActive: true, category: { isActive: true } }
        : { id: productId },
      include: {
        category: true,
        subCategory: true,
      },
    }) as Promise<ProductWithCategoryAndSub | null>;
  }

  requiredFieldsOf(product: Product): string[] {
    return parseRequiredFields(product.requiredFields);
  }

  /** Plain description text for detail view (null/blank → default). */
  descriptionOf(product: Product, fallback = "توضیحات بیشتری برای این محصول ثبت نشده است."): string {
    const raw = product.description?.trim();
    return raw && raw.length > 0 ? raw : fallback;
  }

  async createProduct(input: {
    name: string;
    price: number;
    currency?: string;
    usdPrice?: number | null;
    categoryId: number;
    subCategoryId?: number | null;
    deliveryType: DeliveryType;
    requiredFields?: string[];
    description?: string | null;
    bannerFileId?: string | null;
  }): Promise<Product> {
    const description =
      typeof input.description === "string" && input.description.trim().length > 0
        ? input.description.trim()
        : null;

    const bannerFileId =
      typeof input.bannerFileId === "string" && input.bannerFileId.trim().length > 0
        ? input.bannerFileId.trim()
        : null;

    const trimmedName = input.name.trim();
    const existing = await prisma.product.findFirst({
      where: {
        name: trimmedName,
        categoryId: input.categoryId,
      },
    });
    if (existing) {
      return (prisma.product.update as any)({
        where: { id: existing.id },
        data: {
          price: input.price,
          currency: input.currency ?? existing.currency,
          usdPrice: input.usdPrice !== undefined ? input.usdPrice : (existing as any).usdPrice,
          subCategoryId: input.subCategoryId !== undefined ? input.subCategoryId : existing.subCategoryId,
          deliveryType: input.deliveryType,
          description: description ?? existing.description,
          bannerFileId: bannerFileId ?? existing.bannerFileId,
          requiredFields: (input.requiredFields ?? existing.requiredFields) as Prisma.InputJsonValue,
          isActive: true,
        },
      });
    }

    return (prisma.product.create as any)({
      data: {
        name: trimmedName,
        price: input.price,
        currency: input.currency ?? "TOMAN",
        usdPrice: input.usdPrice ?? null,
        categoryId: input.categoryId,
        subCategoryId: input.subCategoryId ?? null,
        deliveryType: input.deliveryType,
        description,
        bannerFileId,
        requiredFields: (input.requiredFields ?? []) as Prisma.InputJsonValue,
        isActive: true,
      },
    });
  }

  async updateProductName(productId: number, name: string): Promise<Product> {
    return (prisma.product.update as any)({
      where: { id: productId },
      data: { name: name.trim() },
    });
  }

  async updateProductBanner(productId: number, bannerFileId: string | null): Promise<Product> {
    const value =
      typeof bannerFileId === "string" && bannerFileId.trim().length > 0
        ? bannerFileId.trim()
        : null;
    return (prisma.product.update as any)({
      where: { id: productId },
      data: { bannerFileId: value },
    });
  }

  async updateProductDeliveryType(
    productId: number,
    deliveryType: DeliveryType,
  ): Promise<Product> {
    return (prisma.product.update as any)({
      where: { id: productId },
      data: { deliveryType },
    });
  }

  async updateProductDescription(
    productId: number,
    description: string | null,
  ): Promise<Product> {
    const value =
      typeof description === "string" && description.trim().length > 0
        ? description.trim()
        : null;
    return (prisma.product.update as any)({
      where: { id: productId },
      data: { description: value },
    });
  }

  async updateProductPrice(
    productId: number,
    price: number,
    currency?: string,
    usdPrice?: number | null,
  ): Promise<Product> {
    return (prisma.product.update as any)({
      where: { id: productId },
      data: {
        price,
        ...(currency ? { currency } : {}),
        usdPrice: usdPrice !== undefined ? usdPrice : undefined,
      },
    });
  }

  async updateProductSubCategory(
    productId: number,
    subCategoryId: number | null,
  ): Promise<Product> {
    return (prisma.product.update as any)({
      where: { id: productId },
      data: { subCategoryId },
    });
  }

  /**
   * Get the current effective price in Toman for customers.
   * If the product is priced in USD, dynamically converts using the latest exchange rate.
   */
  async getEffectivePrice(product: Product): Promise<number> {
    const { getEffectiveTomanFromMargin, isMarginPricedProduct } = await import(
      "./profitMarginService.js"
    );

    const withRelations =
      (product as Product & { category?: { name: string } | null }).category != null
        ? (product as Product & { category?: { name: string } | null; subCategory?: { name: string } | null })
        : await prisma.product.findUnique({
            where: { id: product.id },
            include: { category: true, subCategory: true },
          });

    const target = withRelations ?? product;

    if (isMarginPricedProduct(target)) {
      const marginToman = await getEffectiveTomanFromMargin(target);
      if (marginToman != null && marginToman > 0) {
        return marginToman;
      }
    }

    const p = product as Product & { usdPrice?: number | null; currency?: string };
    if (p.currency === "USD" && p.usdPrice != null && p.usdPrice > 0) {
      const rate = await exchangeRateService.getUsdRate();
      return convertUsdToToman(p.usdPrice, rate);
    }
    return Math.round(Number(product.price));
  }

  async deleteProduct(productId: number): Promise<Product> {
    return (prisma.product.update as any)({
      where: { id: productId },
      data: { isActive: false },
    });
  }
}

export const catalogService = new CatalogService();

export {
  starsPricingService,
  recalculateStarsProducts,
  extractStarCount,
  isStarsCatalog,
} from "./starsPricingService";
