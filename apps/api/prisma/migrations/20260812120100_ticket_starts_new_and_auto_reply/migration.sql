-- A ticket now starts as 'New' rather than 'Open'.
--
-- Existing rows are deliberately not backfilled. They were triaged under the old
-- model, where Open meant "arrived"; rewriting them to New would claim nobody
-- had ever looked at them, which is false for every ticket in the table.
ALTER TABLE "ticket" ALTER COLUMN "status" SET DEFAULT 'New';

-- AlterTable
ALTER TABLE "ticket" ADD COLUMN     "autoResolvedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "message" ADD COLUMN     "automated" BOOLEAN NOT NULL DEFAULT false;
