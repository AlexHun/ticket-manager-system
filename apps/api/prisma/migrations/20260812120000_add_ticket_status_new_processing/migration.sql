-- AlterEnum: two new labels on TicketStatus.
--
-- Hand-written, because Prisma appends a new label to the end of the type and
-- the *position* is the point: Postgres orders an enum by label position, and
-- the tickets list sorts by this column. Appended, "sort by status" would put a
-- brand-new ticket after Closed. `BEFORE 'Open'` twice lands them in lifecycle
-- order — New, Processing, Open, Resolved, Closed — matching `TICKET_STATUS` in
-- `@ticket/shared` and the enum block in `schema.prisma`.
--
-- Nothing else is in this migration on purpose. Postgres will not let a
-- transaction *use* an enum label that the same transaction added, and Prisma
-- runs one migration per transaction — so the default that uses 'New' has to
-- wait for the next file.
ALTER TYPE "TicketStatus" ADD VALUE 'New' BEFORE 'Open';
ALTER TYPE "TicketStatus" ADD VALUE 'Processing' BEFORE 'Open';
