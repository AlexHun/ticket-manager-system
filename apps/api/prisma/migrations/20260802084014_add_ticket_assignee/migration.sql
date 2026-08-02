-- AlterTable
ALTER TABLE "ticket" ADD COLUMN     "assignedToId" TEXT;

-- CreateIndex
CREATE INDEX "ticket_assignedToId_idx" ON "ticket"("assignedToId");

-- AddForeignKey
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
