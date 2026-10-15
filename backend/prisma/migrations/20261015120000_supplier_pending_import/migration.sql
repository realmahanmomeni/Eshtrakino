-- CreateEnum
CREATE TYPE "SupplierPendingImportStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "SupplierPendingImport" (
    "id" SERIAL NOT NULL,
    "supplierId" INTEGER NOT NULL,
    "supplierProductKey" TEXT NOT NULL,
    "supplierVariantKey" TEXT NOT NULL DEFAULT '',
    "status" "SupplierPendingImportStatus" NOT NULL DEFAULT 'PENDING',
    "displayName" TEXT NOT NULL,
    "brandName" TEXT,
    "supplierCostUsd" DOUBLE PRECISION NOT NULL,
    "profitMarginPercent" DOUBLE PRECISION,
    "description" TEXT,
    "requiredFields" JSONB NOT NULL DEFAULT '[]',
    "stock" INTEGER NOT NULL DEFAULT 0,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "remoteSnapshot" JSONB,
    "categoryId" INTEGER,
    "subCategoryId" INTEGER,
    "productId" INTEGER,
    "reviewedByTelegramId" BIGINT,
    "reviewedAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierPendingImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPendingImport_productId_key" ON "SupplierPendingImport"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPendingImport_supplierId_supplierProductKey_supplierVariantKey_key" ON "SupplierPendingImport"("supplierId", "supplierProductKey", "supplierVariantKey");

-- CreateIndex
CREATE INDEX "SupplierPendingImport_supplierId_status_idx" ON "SupplierPendingImport"("supplierId", "status");

-- CreateIndex
CREATE INDEX "SupplierPendingImport_status_createdAt_idx" ON "SupplierPendingImport"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "SupplierPendingImport" ADD CONSTRAINT "SupplierPendingImport_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPendingImport" ADD CONSTRAINT "SupplierPendingImport_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
