import { prisma } from "../../lib/prisma";
import type { Category, DeliveryType, Product } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { parseRequiredFields } from "../../lib/money";

export type ProductWithCategory = Product & { category: Category };

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

  async listAllCategories(): Promise<Category[]> {
    return prisma.category.findMany({ orderBy: { id: "asc" } });
  }

  async getCategory(categoryId: number, activeOnly = true): Promise<Category | null> {
    return prisma.category.findFirst({
      where: activeOnly ? { id: categoryId, isActive: true } : { id: categoryId },
    });
  }

  async createCategory(name: string): Promise<Category> {
    return prisma.category.create({
      data: { name: name.trim(), isActive: true },
    });
  }

  async updateCategoryName(categoryId: number, name: string): Promise<Category> {
    return prisma.category.update({
      where: { id: categoryId },
      data: { name: name.trim() },
    });
  }

  async deleteCategory(categoryId: number): Promise<Category> {
    return prisma.category.update({
      where: { id: categoryId },
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

  async listActiveProducts(): Promise<ProductWithCategory[]> {
    return prisma.product.findMany({
      where: { isActive: true, category: { isActive: true } },
      include: { category: true },
      orderBy: { id: "asc" },
    });
  }

  async getProduct(
    productId: number,
    activeOnly = true,
  ): Promise<ProductWithCategory | null> {
    return prisma.product.findFirst({
      where: activeOnly
        ? { id: productId, isActive: true, category: { isActive: true } }
        : { id: productId },
      include: { category: true },
    });
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
    categoryId: number;
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

    return prisma.product.create({
      data: {
        name: input.name.trim(),
        price: input.price,
        categoryId: input.categoryId,
        deliveryType: input.deliveryType,
        description,
        bannerFileId,
        requiredFields: (input.requiredFields ?? []) as Prisma.InputJsonValue,
        isActive: true,
      },
    });
  }

  async updateProductName(productId: number, name: string): Promise<Product> {
    return prisma.product.update({
      where: { id: productId },
      data: { name: name.trim() },
    });
  }

  async updateProductBanner(productId: number, bannerFileId: string | null): Promise<Product> {
    const value =
      typeof bannerFileId === "string" && bannerFileId.trim().length > 0
        ? bannerFileId.trim()
        : null;
    return prisma.product.update({
      where: { id: productId },
      data: { bannerFileId: value },
    });
  }

  async updateProductDeliveryType(
    productId: number,
    deliveryType: DeliveryType,
  ): Promise<Product> {
    return prisma.product.update({
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
    return prisma.product.update({
      where: { id: productId },
      data: { description: value },
    });
  }

  async updateProductPrice(productId: number, price: number): Promise<Product> {
    return prisma.product.update({
      where: { id: productId },
      data: { price },
    });
  }

  async deleteProduct(productId: number): Promise<Product> {
    return prisma.product.update({
      where: { id: productId },
      data: { isActive: false },
    });
  }
}

export const catalogService = new CatalogService();
