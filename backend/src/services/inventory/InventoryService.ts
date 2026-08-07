import type { DeliveryType, ProductItem } from "@prisma/client";
import { prisma } from "../../lib/prisma";

export class InventoryService {
  async countAvailable(productId: number): Promise<number> {
    return prisma.productItem.count({
      where: { productId, isSold: false },
    });
  }

  async bulkRestock(productId: number, lines: string[]): Promise<number> {
    const content = lines.map((l) => l.trim()).filter(Boolean);
    if (content.length === 0) return 0;

    const result = await prisma.productItem.createMany({
      data: content.map((line) => ({
        productId,
        content: line,
        isSold: false,
      })),
    });
    return result.count;
  }

  /**
   * Atomically claim the oldest unsold inventory item for an invoice.
   * Returns null when out of stock.
   */
  async claimForInvoice(productId: number, invoiceId: number): Promise<ProductItem | null> {
    return prisma.$transaction(async (tx) => {
      const item = await tx.productItem.findFirst({
        where: { productId, isSold: false },
        orderBy: { id: "asc" },
      });
      if (!item) return null;

      const updated = await tx.productItem.updateMany({
        where: { id: item.id, isSold: false },
        data: { isSold: true, invoiceId },
      });
      if (updated.count === 0) return null;

      return tx.productItem.findUnique({ where: { id: item.id } });
    });
  }

  async getCompleteInventoryReport(): Promise<
    Array<{
      productId: number;
      productName: string;
      deliveryType: DeliveryType;
      unsoldCount: number;
      isActive: boolean;
    }>
  > {
    const products = await prisma.product.findMany({
      orderBy: [{ isActive: "desc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        deliveryType: true,
        isActive: true,
        _count: {
          select: {
            inventory: {
              where: { isSold: false },
            },
          },
        },
      },
    });

    return products.map((product) => ({
      productId: product.id,
      productName: product.name,
      deliveryType: product.deliveryType,
      isActive: product.isActive,
      unsoldCount: product._count.inventory,
    }));
  }
}

export const inventoryService = new InventoryService();
