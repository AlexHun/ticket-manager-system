-- CreateEnum
CREATE TYPE "OutboundEmailKind" AS ENUM ('reply', 'passwordReset', 'invitation');

-- CreateEnum
CREATE TYPE "OutboundEmailStatus" AS ENUM ('queued', 'sent', 'failed', 'undeliverable');

-- CreateTable
CREATE TABLE "outbound_email" (
    "id" SERIAL NOT NULL,
    "kind" "OutboundEmailKind" NOT NULL,
    "messageId" INTEGER,
    "toEmail" TEXT NOT NULL,
    "toName" TEXT,
    "subject" TEXT NOT NULL,
    "textBody" TEXT NOT NULL,
    "emailMessageId" TEXT,
    "inReplyTo" TEXT,
    "references" TEXT[],
    "status" "OutboundEmailStatus" NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "providerMessageId" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "outbound_email_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "outbound_email_messageId_key" ON "outbound_email"("messageId");

-- CreateIndex
CREATE INDEX "outbound_email_status_createdAt_idx" ON "outbound_email"("status", "createdAt");

-- CreateIndex
CREATE INDEX "outbound_email_createdAt_idx" ON "outbound_email"("createdAt");

-- AddForeignKey
ALTER TABLE "outbound_email" ADD CONSTRAINT "outbound_email_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

