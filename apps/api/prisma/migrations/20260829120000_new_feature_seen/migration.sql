-- CreateTable
CREATE TABLE "new_feature_seen" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "seenVersion" INTEGER NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "new_feature_seen_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "new_feature_seen_userId_featureKey_key" ON "new_feature_seen"("userId", "featureKey");

-- AddForeignKey
ALTER TABLE "new_feature_seen" ADD CONSTRAINT "new_feature_seen_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
