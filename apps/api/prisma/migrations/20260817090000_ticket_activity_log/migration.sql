-- CreateEnum
CREATE TYPE "TicketActivityAction" AS ENUM ('created', 'status_changed', 'category_changed', 'assignee_changed', 'reopened', 'auto_resolved', 'auto_declined');

-- CreateEnum
CREATE TYPE "TicketActorKind" AS ENUM ('agent', 'assistant', 'customer');

-- CreateTable
CREATE TABLE "ticket_activity" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "action" "TicketActivityAction" NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "actorKind" "TicketActorKind" NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "actorEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_activity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ticket_activity_ticketId_createdAt_idx" ON "ticket_activity"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "ticket_activity_actorId_idx" ON "ticket_activity"("actorId");

-- AddForeignKey
ALTER TABLE "ticket_activity" ADD CONSTRAINT "ticket_activity_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_activity" ADD CONSTRAINT "ticket_activity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
