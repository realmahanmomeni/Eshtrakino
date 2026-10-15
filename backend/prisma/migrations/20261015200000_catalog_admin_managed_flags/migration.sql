-- AlterTable
ALTER TABLE "Category" ADD COLUMN "isAdminManaged" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SubCategory" ADD COLUMN "isAdminManaged" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "hierarchyLocked" BOOLEAN NOT NULL DEFAULT false;
