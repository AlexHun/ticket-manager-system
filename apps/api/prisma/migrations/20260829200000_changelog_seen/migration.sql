-- CreateTable
CREATE TABLE "changelog_seen" (
    "userId" TEXT NOT NULL,
    "seenVersion" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "changelog_seen_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "changelog_seen" ADD CONSTRAINT "changelog_seen_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
