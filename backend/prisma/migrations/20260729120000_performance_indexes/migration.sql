-- Performance indexes for background jobs and hot paths

CREATE INDEX IF NOT EXISTS "Invoice_status_idx" ON "Invoice"("status");

CREATE INDEX IF NOT EXISTS "Invoice_expiresAt_reminded5Days_remindedLastDay_idx"
ON "Invoice"("expiresAt", "reminded5Days", "remindedLastDay");

CREATE INDEX IF NOT EXISTS "ProductItem_isSold_productId_idx"
ON "ProductItem"("isSold", "productId");
