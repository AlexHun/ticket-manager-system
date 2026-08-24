-- CreateEnum
CREATE TYPE "AdminActivityAction" AS ENUM ('user_created', 'user_invited', 'user_edited', 'role_changed', 'user_deleted');

-- CreateTable
CREATE TABLE "admin_activity" (
    "id" SERIAL NOT NULL,
    "action" "AdminActivityAction" NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "actorEmail" TEXT NOT NULL,
    "targetUserId" TEXT,
    "targetUserName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_activity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_activity_createdAt_idx" ON "admin_activity"("createdAt");

-- CreateIndex
CREATE INDEX "admin_activity_actorId_idx" ON "admin_activity"("actorId");

-- CreateIndex
CREATE INDEX "admin_activity_targetUserId_idx" ON "admin_activity"("targetUserId");

-- AddForeignKey
ALTER TABLE "admin_activity" ADD CONSTRAINT "admin_activity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_activity" ADD CONSTRAINT "admin_activity_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
