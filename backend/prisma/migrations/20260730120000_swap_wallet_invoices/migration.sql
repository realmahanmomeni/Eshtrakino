-- CreateEnum
CREATE TYPE "SwapInvoiceStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'EXPIRED', 'CANCELED');

-- CreateTable
CREATE TABLE "SwapWalletInvoice" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "amountUsd" DECIMAL(18,8) NOT NULL,
    "exactCryptoAmount" DECIMAL(18,8),
    "gateway" VARCHAR(32) NOT NULL DEFAULT 'SWAPWALLET',
    "status" "SwapInvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "trackingCode" VARCHAR(64) NOT NULL,
    "providerRef" VARCHAR(128),
    "paymentUrl" VARCHAR(1024),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SwapWalletInvoice_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "SwapWalletInvoice_trackingCode_key" ON "SwapWalletInvoice"("trackingCode");
CREATE INDEX "SwapWalletInvoice_userId_idx" ON "SwapWalletInvoice"("userId");
CREATE INDEX "SwapWalletInvoice_status_idx" ON "SwapWalletInvoice"("status");
CREATE INDEX "SwapWalletInvoice_exactCryptoAmount_idx" ON "SwapWalletInvoice"("exactCryptoAmount");
CREATE INDEX "SwapWalletInvoice_providerRef_idx" ON "SwapWalletInvoice"("providerRef");
CREATE INDEX "SwapWalletInvoice_status_exactCryptoAmount_idx" ON "SwapWalletInvoice"("status", "exactCryptoAmount");
CREATE INDEX "SwapWalletInvoice_status_createdAt_idx" ON "SwapWalletInvoice"("status", "createdAt");

-- Partial unique: one PENDING invoice per exact crypto amount (slot allocation)
CREATE UNIQUE INDEX "uq_swap_invoice_pending_exact_crypto"
  ON "SwapWalletInvoice" ("exactCryptoAmount")
  WHERE "status" = 'PENDING' AND "exactCryptoAmount" IS NOT NULL;

-- ForeignKey
ALTER TABLE "SwapWalletInvoice"
  ADD CONSTRAINT "SwapWalletInvoice_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
