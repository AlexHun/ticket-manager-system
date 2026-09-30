-- When a ticket was offered to the auto-reply (#360).
--
-- Additive and nullable, with no backfill: a row from before this column reads
-- as never offered, which is what `/pipeline` reports for it. The only rows
-- that mislabel are ones in flight at deploy time, which settle to a verdict
-- within seconds.

-- AlterTable
ALTER TABLE "ticket" ADD COLUMN     "autoReplyOfferedAt" TIMESTAMP(3);
