-- Wallet system: balance transactions + wallet top-up invoices

CREATE TABLE "WalletTransaction" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WalletTransaction_userId_idx" ON "WalletTransaction"("userId");

ALTER TABLE "WalletTransaction"
ADD CONSTRAINT "WalletTransaction_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Invoice" ALTER COLUMN "productId" DROP NOT NULL;

ALTER TABLE "Invoice"
ADD COLUMN "isWalletTopUp" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "topUpAmount" DECIMAL(14,2);
