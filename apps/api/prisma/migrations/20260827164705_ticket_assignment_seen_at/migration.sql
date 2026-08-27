-- AlterTable
ALTER TABLE "ticket" ADD COLUMN     "assignmentSeenAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ticket_assignedToId_assignmentSeenAt_idx" ON "ticket"("assignedToId", "assignmentSeenAt");
