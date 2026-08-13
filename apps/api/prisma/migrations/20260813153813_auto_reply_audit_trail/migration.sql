-- AlterTable
ALTER TABLE "message" ADD COLUMN     "citedArticleIds" TEXT[];

-- AlterTable
ALTER TABLE "ticket" ADD COLUMN     "autoReplyDecline" TEXT,
ADD COLUMN     "autoReplyDeclinedAt" TIMESTAMP(3);
