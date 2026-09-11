-- CreateEnum
CREATE TYPE "SupplierOrderStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'UNCERTAIN');

-- AlterEnum
ALTER TYPE "DeliveryType" ADD VALUE 'SUPPLIER_AUTO';

-- AlterEnum
ALTER TYPE "TicketStatus" ADD VALUE 'ANSWERED';

-- DropForeignKey
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_productId_fkey";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "adminPermissions" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "Supplier" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierApiKey" (
    "id" SERIAL NOT NULL,
    "supplierId" INTEGER NOT NULL,
    "keyName" TEXT NOT NULL,
    "encryptedKey" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isValid" BOOLEAN NOT NULL DEFAULT false,
    "lastBalance" DECIMAL(14,2),
    "lastError" TEXT,
    "lastValidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierProductMapping" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "supplierId" INTEGER NOT NULL,
    "supplierProductKey" TEXT NOT NULL,
    "supplierVariantKey" TEXT,
    "maxPriceLimit" DECIMAL(14,2),
    "isAutoPurchase" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierProductMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierOrder" (
    "id" SERIAL NOT NULL,
    "internalInvoiceId" INTEGER NOT NULL,
    "supplierId" INTEGER NOT NULL,
    "apiKeyId" INTEGER NOT NULL,
    "supplierOrderId" TEXT,
    "status" "SupplierOrderStatus" NOT NULL DEFAULT 'PENDING',
    "costAmount" DECIMAL(14,2),
    "deliveryPayload" TEXT,
    "errorMessage" TEXT,
    "reconciled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_name_key" ON "Supplier"("name");

-- CreateIndex
CREATE INDEX "SupplierApiKey_supplierId_isActive_isValid_idx" ON "SupplierApiKey"("supplierId", "isActive", "isValid");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierProductMapping_productId_key" ON "SupplierProductMapping"("productId");

-- CreateIndex
CREATE INDEX "SupplierProductMapping_supplierId_idx" ON "SupplierProductMapping"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierOrder_internalInvoiceId_key" ON "SupplierOrder"("internalInvoiceId");

-- CreateIndex
CREATE INDEX "SupplierOrder_supplierId_status_idx" ON "SupplierOrder"("supplierId", "status");

-- CreateIndex
CREATE INDEX "SupplierOrder_internalInvoiceId_idx" ON "SupplierOrder"("internalInvoiceId");

-- CreateIndex
CREATE INDEX "User_updatedAt_idx" ON "User"("updatedAt");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierApiKey" ADD CONSTRAINT "SupplierApiKey_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierProductMapping" ADD CONSTRAINT "SupplierProductMapping_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierProductMapping" ADD CONSTRAINT "SupplierProductMapping_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierOrder" ADD CONSTRAINT "SupplierOrder_internalInvoiceId_fkey" FOREIGN KEY ("internalInvoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierOrder" ADD CONSTRAINT "SupplierOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierOrder" ADD CONSTRAINT "SupplierOrder_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "SupplierApiKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
