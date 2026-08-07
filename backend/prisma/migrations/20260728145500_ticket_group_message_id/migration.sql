ALTER TABLE "TicketMessage"
ADD COLUMN "tgMessageId" INTEGER;

CREATE UNIQUE INDEX "TicketMessage_tgMessageId_key" ON "TicketMessage"("tgMessageId");
