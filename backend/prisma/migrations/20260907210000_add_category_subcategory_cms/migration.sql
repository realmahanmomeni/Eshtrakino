-- AlterTable
ALTER TABLE "Category"
ADD COLUMN "description" TEXT,
ADD COLUMN "bannerUrl" TEXT;

-- AlterTable
ALTER TABLE "SubCategory"
ADD COLUMN "bannerUrl" TEXT;
