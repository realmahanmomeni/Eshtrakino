-- AlterTable: Add dual currency support to Product
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'TOMAN';
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "usdPrice" DOUBLE PRECISION;
