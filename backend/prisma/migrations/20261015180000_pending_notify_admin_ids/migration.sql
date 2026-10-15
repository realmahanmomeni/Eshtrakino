-- AlterTable
ALTER TABLE "SupplierPendingImport" ADD COLUMN "notifiedAdminIds" JSONB NOT NULL DEFAULT '[]';
