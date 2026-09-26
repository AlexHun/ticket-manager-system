-- A demo session's email is written to the outbox and never sent (#325, PRD R10).
--
-- A fifth status rather than an `undeliverable` row with a note on it: the
-- outbox retry acts on `undeliverable`, and the only thing standing between a
-- demo reply and a customer would then be a second check somewhere else. A
-- status the retry's `RETRYABLE_STATUS` does not list is refused by the same
-- conditional `updateMany` that already refuses a `sent` row.
--
-- Nothing here uses the new value: Postgres will not let an enum value be added
-- and used in one transaction, and `prisma migrate deploy` runs a migration as
-- one.

-- AlterEnum
ALTER TYPE "OutboundEmailStatus" ADD VALUE 'withheld';
