-- CMS: page banners + button layout columns
ALTER TABLE "PageContent" ADD COLUMN IF NOT EXISTS "mediaFileId" TEXT;
ALTER TABLE "PageContent" ADD COLUMN IF NOT EXISTS "mediaType" VARCHAR(16);
ALTER TABLE "PageContent" ADD COLUMN IF NOT EXISTS "layoutColumns" INTEGER NOT NULL DEFAULT 1;
