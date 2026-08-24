-- CreateEnum
CREATE TYPE "KnowledgeRevisionStatus" AS ENUM ('pending', 'approved', 'rejected');

-- AlterTable
ALTER TABLE "knowledge_article_revision" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "approvedByName" TEXT,
ADD COLUMN     "status" "KnowledgeRevisionStatus" NOT NULL DEFAULT 'approved';

-- CreateIndex
CREATE INDEX "knowledge_article_revision_status_idx" ON "knowledge_article_revision"("status");

-- AddForeignKey
ALTER TABLE "knowledge_article_revision" ADD CONSTRAINT "knowledge_article_revision_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
