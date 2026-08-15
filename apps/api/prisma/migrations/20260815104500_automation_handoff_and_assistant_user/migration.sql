-- CreateEnum
CREATE TYPE "HandoffTarget" AS ENUM ('admin', 'user', 'unassigned');

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "automated" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "automation_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "target" "HandoffTarget" NOT NULL DEFAULT 'admin',
    "handoffUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,
    "updatedByName" TEXT,

    CONSTRAINT "automation_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "automation_settings_handoffUserId_idx" ON "automation_settings"("handoffUserId");

-- CreateIndex
CREATE INDEX "automation_settings_updatedById_idx" ON "automation_settings"("updatedById");

-- CreateIndex
CREATE INDEX "user_automated_idx" ON "user"("automated");

-- AddForeignKey
ALTER TABLE "automation_settings" ADD CONSTRAINT "automation_settings_handoffUserId_fkey" FOREIGN KEY ("handoffUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_settings" ADD CONSTRAINT "automation_settings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
