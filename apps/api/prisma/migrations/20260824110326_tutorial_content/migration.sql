-- CreateEnum
CREATE TYPE "TutorialPageKey" AS ENUM ('dashboard', 'tickets', 'ticketDetail', 'pipeline', 'knowledge', 'users', 'activity', 'outbox');

-- CreateTable
CREATE TABLE "tutorial_content" (
    "pageKey" "TutorialPageKey" NOT NULL,
    "title" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,
    "updatedByName" TEXT,

    CONSTRAINT "tutorial_content_pkey" PRIMARY KEY ("pageKey")
);

-- CreateTable
CREATE TABLE "tutorial_progress" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "pageKey" "TutorialPageKey" NOT NULL,
    "seenVersion" INTEGER NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tutorial_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tutorial_content_updatedById_idx" ON "tutorial_content"("updatedById");

-- CreateIndex
CREATE UNIQUE INDEX "tutorial_progress_userId_pageKey_key" ON "tutorial_progress"("userId", "pageKey");

-- AddForeignKey
ALTER TABLE "tutorial_content" ADD CONSTRAINT "tutorial_content_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tutorial_progress" ADD CONSTRAINT "tutorial_progress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

