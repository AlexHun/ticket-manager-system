-- CreateTable
CREATE TABLE "dashboard_layout" (
    "userId" TEXT NOT NULL,
    "panels" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboard_layout_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "dashboard_layout" ADD CONSTRAINT "dashboard_layout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
