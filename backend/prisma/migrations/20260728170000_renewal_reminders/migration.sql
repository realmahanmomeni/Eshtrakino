-- Smart renewal reminders: product duration + invoice reminder flags

ALTER TABLE "Product" ADD COLUMN "durationDays" INTEGER;

ALTER TABLE "Invoice"
ADD COLUMN "reminded5Days" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "remindedLastDay" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Invoice_status_expiresAt_reminded5Days_idx"
ON "Invoice"("status", "expiresAt", "reminded5Days");

CREATE INDEX "Invoice_status_expiresAt_remindedLastDay_idx"
ON "Invoice"("status", "expiresAt", "remindedLastDay");
