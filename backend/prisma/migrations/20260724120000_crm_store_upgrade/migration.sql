-- CRM / store upgrade: DeliveryType, requiredFields, invoice approval, tickets
-- NOTE: Drop status-dependent indexes BEFORE altering InvoiceStatus enum
-- (PG cannot rebuild WHERE "status" = 'PENDING' across enum type renames).

-- 1) Drop old pending-only unique index first
DROP INDEX IF EXISTS "Invoice_one_pending_per_user";

-- 2) DeliveryType (replaces FulfillmentType)
CREATE TYPE "DeliveryType" AS ENUM ('READY', 'MANUAL', 'GROUP');

ALTER TABLE "Product" ADD COLUMN "deliveryType" "DeliveryType";

UPDATE "Product" SET "deliveryType" = CASE
  WHEN "fulfillmentType"::text = 'PRE_STOCKED' THEN 'READY'::"DeliveryType"
  WHEN "fulfillmentType"::text = 'MANUAL' THEN 'MANUAL'::"DeliveryType"
  WHEN "fulfillmentType"::text = 'GROUP_BUY' THEN 'GROUP'::"DeliveryType"
  ELSE 'MANUAL'::"DeliveryType"
END;

ALTER TABLE "Product" ALTER COLUMN "deliveryType" SET NOT NULL;
ALTER TABLE "Product" DROP COLUMN "fulfillmentType";
DROP TYPE "FulfillmentType";

ALTER TABLE "Product" ADD COLUMN "requiredFields" JSONB NOT NULL DEFAULT '[]';

-- 3) Widen money columns
ALTER TABLE "User" ALTER COLUMN "balance" TYPE DECIMAL(14,2);
ALTER TABLE "Product" ALTER COLUMN "price" TYPE DECIMAL(14,2);
ALTER TABLE "Invoice" ALTER COLUMN "amount" TYPE DECIMAL(14,2);

-- 4) Expand InvoiceStatus via swap enum
CREATE TYPE "InvoiceStatus_new" AS ENUM (
  'PENDING',
  'AWAITING_RECEIPT',
  'AWAITING_APPROVAL',
  'PAID',
  'CANCELLED',
  'EXPIRED'
);

ALTER TABLE "Invoice" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Invoice"
  ALTER COLUMN "status" TYPE "InvoiceStatus_new"
  USING ("status"::text::"InvoiceStatus_new");
DROP TYPE "InvoiceStatus";
ALTER TYPE "InvoiceStatus_new" RENAME TO "InvoiceStatus";
ALTER TABLE "Invoice" ALTER COLUMN "status" SET DEFAULT 'PENDING'::"InvoiceStatus";

-- 5) Invoice approval / checkout fields
ALTER TABLE "Invoice" ADD COLUMN "receiptFileId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "rejectReason" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "userInputData" JSONB;

-- 6) One open invoice per user (explicit enum casts)
CREATE UNIQUE INDEX "Invoice_one_open_per_user"
  ON "Invoice" ("userId")
  WHERE "status" IN (
    'PENDING'::"InvoiceStatus",
    'AWAITING_RECEIPT'::"InvoiceStatus",
    'AWAITING_APPROVAL'::"InvoiceStatus"
  );

-- 7) Ticketing
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "TicketSender" AS ENUM ('USER', 'ADMIN');

CREATE TABLE "Ticket" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
  "subject" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TicketMessage" (
  "id" SERIAL NOT NULL,
  "ticketId" INTEGER NOT NULL,
  "sender" "TicketSender" NOT NULL,
  "adminTelegramId" BIGINT,
  "text" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TicketMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Ticket_userId_status_idx" ON "Ticket"("userId", "status");
CREATE INDEX "Ticket_status_idx" ON "Ticket"("status");
CREATE INDEX "TicketMessage_ticketId_idx" ON "TicketMessage"("ticketId");

ALTER TABLE "Ticket"
  ADD CONSTRAINT "Ticket_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TicketMessage"
  ADD CONSTRAINT "TicketMessage_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
