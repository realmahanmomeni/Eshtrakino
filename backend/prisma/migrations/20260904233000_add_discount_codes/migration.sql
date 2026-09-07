-- AlterTable: Add discount fields to Invoice
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "discountCode" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "discountPercent" INTEGER;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "discountAmount" DECIMAL(14, 2) NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "originalAmount" DECIMAL(14, 2);

-- CreateTable: DiscountCode
CREATE TABLE IF NOT EXISTS "DiscountCode" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "percentage" INTEGER NOT NULL,
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "appliesToAll" BOOLEAN NOT NULL DEFAULT true,
    "productIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscountCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "DiscountCode_code_key" ON "DiscountCode"("code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DiscountCode_code_idx" ON "DiscountCode"("code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DiscountCode_isActive_idx" ON "DiscountCode"("isActive");
