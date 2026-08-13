-- CreateEnum
CREATE TYPE "KnowledgeRevisionAction" AS ENUM ('created', 'updated', 'archived', 'restored');

-- CreateTable
CREATE TABLE "knowledge_article" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "TicketCategory" NOT NULL,
    "body" TEXT NOT NULL,
    "internalNote" TEXT,
    "autoReply" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_article_revision" (
    "id" SERIAL NOT NULL,
    "articleId" TEXT NOT NULL,
    "action" "KnowledgeRevisionAction" NOT NULL,
    "title" TEXT NOT NULL,
    "category" "TicketCategory" NOT NULL,
    "body" TEXT NOT NULL,
    "internalNote" TEXT,
    "autoReply" BOOLEAN NOT NULL,
    "archived" BOOLEAN NOT NULL,
    "editorId" TEXT,
    "editorName" TEXT NOT NULL,
    "editorEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_article_revision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_article_archived_autoReply_idx" ON "knowledge_article"("archived", "autoReply");

-- CreateIndex
CREATE INDEX "knowledge_article_revision_articleId_createdAt_idx" ON "knowledge_article_revision"("articleId", "createdAt");

-- CreateIndex
CREATE INDEX "knowledge_article_revision_editorId_idx" ON "knowledge_article_revision"("editorId");

-- CreateIndex
CREATE INDEX "knowledge_article_revision_createdAt_idx" ON "knowledge_article_revision"("createdAt");

-- AddForeignKey
ALTER TABLE "knowledge_article_revision" ADD CONSTRAINT "knowledge_article_revision_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "knowledge_article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_article_revision" ADD CONSTRAINT "knowledge_article_revision_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
