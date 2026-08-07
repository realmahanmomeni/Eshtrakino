-- Add USER_CHOICE to DeliveryType
ALTER TYPE "DeliveryType" ADD VALUE 'USER_CHOICE';

-- Add buyer preference for USER_CHOICE invoices
ALTER TABLE "Invoice"
ADD COLUMN "deliveryPreference" TEXT;
