-- AlterTable
ALTER TABLE "message" ADD COLUMN     "authorId" TEXT;

-- CreateIndex
CREATE INDEX "message_authorId_idx" ON "message"("authorId");

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
