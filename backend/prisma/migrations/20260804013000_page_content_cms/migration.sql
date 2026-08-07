-- CMS: dynamic page texts for Telegram-native content management
CREATE TABLE IF NOT EXISTS "PageContent" (
    "id" SERIAL NOT NULL,
    "pageKey" VARCHAR(64) NOT NULL,
    "textContent" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PageContent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PageContent_pageKey_key" ON "PageContent"("pageKey");
