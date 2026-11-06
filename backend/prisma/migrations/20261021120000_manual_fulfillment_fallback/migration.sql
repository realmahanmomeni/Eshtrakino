-- Manual fulfillment fallback for supplier OOS products (e.g. Gemini Pro)
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "forceManualFallback" BOOLEAN NOT NULL DEFAULT false;

ALTER TYPE "SupplierOrderStatus" ADD VALUE IF NOT EXISTS 'PENDING_MANUAL_DELIVERY';
