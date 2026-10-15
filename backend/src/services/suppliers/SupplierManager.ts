import { prisma } from "../../lib/prisma";
import { SupplierAdapter, SupplierPurchaseUncertainError, SupplierPriceExceededError, SupplierProductNotFoundError } from "./SupplierAdapter";
import { SupplierOrderStatus } from "@prisma/client";

export class SupplierManager {
  private adapters = new Map<string, SupplierAdapter>();

  registerAdapter(adapter: SupplierAdapter) {
    this.adapters.set(adapter.name, adapter);
  }

  getAdapter(name: string): SupplierAdapter {
    const direct = this.adapters.get(name);
    if (direct) return direct;

    const norm = (name || "").trim().toLowerCase();
    for (const [k, v] of this.adapters.entries()) {
      if (k.toLowerCase() === norm) return v;
    }

    if (/canboso|کنبوسو/i.test(norm)) {
      const cb = this.adapters.get("Canboso");
      if (cb) return cb;
    }

    if (/quantum|کوانتوم/i.test(norm)) {
      const qv = this.adapters.get("QuantumVault");
      if (qv) return qv;
    }

    if (this.adapters.size === 1) {
      return this.adapters.values().next().value!;
    }

    throw new Error(`Supplier adapter '${name}' not found.`);
  }

  hasAdapter(name: string): boolean {
    try {
      this.getAdapter(name);
      return true;
    } catch {
      return false;
    }
  }

  listAdapters(): SupplierAdapter[] {
    return Array.from(this.adapters.values());
  }

  async processAutoPurchase(invoiceId: number, productId: number): Promise<boolean> {
    const mapping = await prisma.supplierProductMapping.findUnique({
      where: { productId },
      include: { supplier: true },
    });

    if (!mapping || !mapping.isAutoPurchase || !mapping.supplier.isActive) {
      return false; // No auto-purchase configured or supplier disabled
    }

    const adapter = this.getAdapter(mapping.supplier.name);

    // Pick a valid, active key for this supplier
    const apiKey = await prisma.supplierApiKey.findFirst({
      where: {
        supplierId: mapping.supplier.id,
        isActive: true,
        isValid: true,
      },
      orderBy: { lastValidatedAt: 'desc' }, // simple selection policy for now
    });

    if (!apiKey) {
      throw new Error(`No valid API key available for supplier ${mapping.supplier.name}`);
    }

    // Create the SupplierOrder record BEFORE executing POST
    const supplierOrder = await prisma.supplierOrder.create({
      data: {
        internalInvoiceId: invoiceId,
        supplierId: mapping.supplier.id,
        apiKeyId: apiKey.id,
        status: SupplierOrderStatus.PENDING,
      },
    });

    try {
      // 1. Pre-purchase price protection
      if (mapping.maxPriceLimit) {
        const plainKey = SupplierManager.decryptKey(apiKey.encryptedKey);
        const productDetails = await adapter.getProductDetails(plainKey, mapping.supplierProductKey);
        if (!productDetails) {
          throw new SupplierProductNotFoundError(`Product ${mapping.supplierProductKey} not found at supplier before purchase.`);
        }
        
        let supplierPrice = 0;
        if (mapping.supplierVariantKey) {
          const variant = productDetails.variants.find(v => v.variantKey === mapping.supplierVariantKey);
          if (!variant) {
            throw new SupplierProductNotFoundError(`Variant ${mapping.supplierVariantKey} not found at supplier before purchase.`);
          }
          supplierPrice = variant.price;
        } else {
          // Assuming base product price is the first variant if variants exist, otherwise 0 or not applicable.
          // Since the QuantumVault response puts price on variants, let's take the first one or default 0.
          supplierPrice = productDetails.variants[0]?.price ?? 0;
        }

        if (supplierPrice > Number(mapping.maxPriceLimit)) {
          throw new SupplierPriceExceededError(`Supplier price ${supplierPrice} exceeds max allowed limit ${mapping.maxPriceLimit}`);
        }
      }

      const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
      const userInputData =
        invoice?.userInputData && typeof invoice.userInputData === "object"
          ? (invoice.userInputData as Record<string, string>)
          : undefined;

      const plainKey = SupplierManager.decryptKey(apiKey.encryptedKey);
      const result = await adapter.purchase(plainKey, mapping, undefined, {
        internalInvoiceId: invoiceId,
        userInputData,
      });

      const orderStatus = result.isProcessing
        ? SupplierOrderStatus.PENDING
        : SupplierOrderStatus.SUCCESS;

      await prisma.supplierOrder.update({
        where: { id: supplierOrder.id },
        data: {
          status: orderStatus,
          supplierOrderId: result.supplierOrderId,
          costAmount: result.costAmount,
          deliveryPayload: result.deliveryPayload,
          errorMessage: result.isProcessing
            ? result.status ?? "processing"
            : null,
        },
      });

      return true;

    } catch (error: any) {
      if (error instanceof SupplierPurchaseUncertainError) {
        // We cannot safely retry, mark as UNCERTAIN
        await prisma.supplierOrder.update({
          where: { id: supplierOrder.id },
          data: {
            status: SupplierOrderStatus.UNCERTAIN,
            errorMessage: error.message,
          },
        });
        // We might want to enqueue a reconciliation job here, or we just rely on cron / admin manual check
        throw error;
      } else {
        // Other errors (auth, out of stock) -> mark as FAILED
        await prisma.supplierOrder.update({
          where: { id: supplierOrder.id },
          data: {
            status: SupplierOrderStatus.FAILED,
            errorMessage: error.message,
          },
        });
        throw error;
      }
    }
  }

  /**
   * Helper to decrypt/encrypt keys (placeholder for actual encryption logic)
   * In a real system, you would use crypto module to decrypt/encrypt using a master key.
   */
  static encryptKey(rawKey: string): string {
    // For MVP, just returning raw, but in production:
    // const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(process.env.ENCRYPTION_KEY), iv);
    return rawKey; // WARNING: implement proper encryption based on Eshtrakino's existing crypto helpers if any
  }

  static decryptKey(encryptedKey: string): string {
    return encryptedKey;
  }
}

export const supplierManager = new SupplierManager();
