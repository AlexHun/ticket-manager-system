-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('Open', 'Resolved', 'Closed');

-- CreateEnum
CREATE TYPE "TicketCategory" AS ENUM ('General', 'Technical', 'Refund', 'Other');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('inbound', 'outbound');

-- CreateTable
CREATE TABLE "ticket" (
    "id" SERIAL NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'Open',
    "category" "TicketCategory",
    "customerEmail" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "messageId" TEXT NOT NULL,
    "inReplyTo" TEXT,
    "senderEmail" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "textBody" TEXT,
    "htmlBody" TEXT,
    "direction" "MessageDirection" NOT NULL DEFAULT 'inbound',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ticket_customerEmail_idx" ON "ticket"("customerEmail");

-- CreateIndex
CREATE INDEX "ticket_lastMessageAt_idx" ON "ticket"("lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "message_messageId_key" ON "message"("messageId");

-- CreateIndex
CREATE INDEX "message_ticketId_createdAt_idx" ON "message"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "message_inReplyTo_idx" ON "message"("inReplyTo");

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
