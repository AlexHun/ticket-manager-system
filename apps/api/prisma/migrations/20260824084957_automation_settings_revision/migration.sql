-- CreateTable
CREATE TABLE "automation_settings_revision" (
    "id" SERIAL NOT NULL,
    "fromTarget" "HandoffTarget" NOT NULL,
    "toTarget" "HandoffTarget" NOT NULL,
    "fromUserId" TEXT,
    "fromUserName" TEXT,
    "toUserId" TEXT,
    "toUserName" TEXT,
    "changedById" TEXT,
    "changedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_settings_revision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "automation_settings_revision_createdAt_idx" ON "automation_settings_revision"("createdAt");

-- CreateIndex
CREATE INDEX "automation_settings_revision_fromUserId_idx" ON "automation_settings_revision"("fromUserId");

-- CreateIndex
CREATE INDEX "automation_settings_revision_toUserId_idx" ON "automation_settings_revision"("toUserId");

-- CreateIndex
CREATE INDEX "automation_settings_revision_changedById_idx" ON "automation_settings_revision"("changedById");

-- AddForeignKey
ALTER TABLE "automation_settings_revision" ADD CONSTRAINT "automation_settings_revision_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_settings_revision" ADD CONSTRAINT "automation_settings_revision_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_settings_revision" ADD CONSTRAINT "automation_settings_revision_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
