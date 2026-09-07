-- AlterTable
ALTER TABLE "Invoice"
ADD COLUMN "logMessageId" INTEGER,
ADD COLUMN "approvedByAdminId" BIGINT,
ADD COLUMN "approvedByAdminName" TEXT;
