-- DeliveryType: replace GROUP with CREDENTIALS_REQUIRED
CREATE TYPE "DeliveryType_new" AS ENUM ('READY', 'MANUAL', 'CREDENTIALS_REQUIRED');

ALTER TABLE "Product"
  ALTER COLUMN "deliveryType" TYPE "DeliveryType_new"
  USING (
    CASE "deliveryType"::text
      WHEN 'GROUP' THEN 'MANUAL'::"DeliveryType_new"
      ELSE "deliveryType"::text::"DeliveryType_new"
    END
  );

DROP TYPE "DeliveryType";
ALTER TYPE "DeliveryType_new" RENAME TO "DeliveryType";

-- CreateTable
CREATE TABLE "ProductItem" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "isSold" BOOLEAN NOT NULL DEFAULT false,
    "invoiceId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductItem_invoiceId_key" ON "ProductItem"("invoiceId");

-- CreateIndex
CREATE INDEX "ProductItem_productId_isSold_idx" ON "ProductItem"("productId", "isSold");

-- AddForeignKey
ALTER TABLE "ProductItem" ADD CONSTRAINT "ProductItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductItem" ADD CONSTRAINT "ProductItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
