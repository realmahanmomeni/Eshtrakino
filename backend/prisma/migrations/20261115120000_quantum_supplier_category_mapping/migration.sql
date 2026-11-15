-- Additive Quantum supplier support. Existing rows keep working:
-- new columns are nullable, and SupplierCategoryMapping starts empty.

ALTER TABLE "SupplierPendingImport" ADD COLUMN "remoteFolder" TEXT;

CREATE INDEX "SupplierPendingImport_supplierId_remoteFolder_status_idx"
  ON "SupplierPendingImport"("supplierId", "remoteFolder", "status");

ALTER TABLE "SupplierProductMapping" ADD COLUMN "supplierOfferGroup" TEXT;

CREATE INDEX "SupplierProductMapping_supplierId_supplierOfferGroup_idx"
  ON "SupplierProductMapping"("supplierId", "supplierOfferGroup");

CREATE TABLE "SupplierCategoryMapping" (
    "id" SERIAL NOT NULL,
    "supplierId" INTEGER NOT NULL,
    "remoteFolder" TEXT NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "subCategoryId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierCategoryMapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupplierCategoryMapping_supplierId_remoteFolder_key"
  ON "SupplierCategoryMapping"("supplierId", "remoteFolder");

CREATE INDEX "SupplierCategoryMapping_supplierId_idx"
  ON "SupplierCategoryMapping"("supplierId");

CREATE INDEX "SupplierCategoryMapping_categoryId_idx"
  ON "SupplierCategoryMapping"("categoryId");

ALTER TABLE "SupplierCategoryMapping"
  ADD CONSTRAINT "SupplierCategoryMapping_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupplierCategoryMapping"
  ADD CONSTRAINT "SupplierCategoryMapping_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupplierCategoryMapping"
  ADD CONSTRAINT "SupplierCategoryMapping_subCategoryId_fkey"
  FOREIGN KEY ("subCategoryId") REFERENCES "SubCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
