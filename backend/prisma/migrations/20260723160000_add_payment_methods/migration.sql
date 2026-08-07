-- AlterEnum
CREATE TYPE "PaymentMethodType" AS ENUM ('CARD', 'GATEWAY');

-- CreateTable
CREATE TABLE "PaymentMethod" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PaymentMethodType" NOT NULL,
    "config" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentMethod_isActive_idx" ON "PaymentMethod"("isActive");

-- CreateIndex
CREATE INDEX "PaymentMethod_type_idx" ON "PaymentMethod"("type");
