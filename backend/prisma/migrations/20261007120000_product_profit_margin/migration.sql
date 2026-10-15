-- Percentage-based profit margin pricing
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "supplierCostUsd" DOUBLE PRECISION;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "profitMarginPercent" DOUBLE PRECISION;
