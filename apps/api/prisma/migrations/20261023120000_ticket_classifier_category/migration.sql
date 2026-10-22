-- The category the classifier filed, on the ticket (#561).
--
-- Additive and nullable. `IF NOT EXISTS`, and every backfill below writes only
-- a still-null column, so the file can be replayed against seeded rows
-- (`classifier-category-migration.test.ts`) and changes nothing the second time.

-- AlterTable
ALTER TABLE "ticket" ADD COLUMN IF NOT EXISTS "classifierCategory" "TicketCategory";

-- Backfill from the classifier's own trail: the assistant-authored
-- `category_changed` row it writes exactly once per ticket, whose `toValue` is
-- the category it filed. An agent's later change or clear is a row of its own
-- and does not touch this one.
UPDATE "ticket" t
SET "classifierCategory" = a."toValue"::"TicketCategory"
FROM "ticket_activity" a
WHERE a."ticketId" = t.id
  AND a.action = 'category_changed'
  AND a."actorKind" = 'assistant'
  AND a."toValue" IS NOT NULL
  AND t."classifierCategory" IS NULL;

-- A ticket whose trail is gone keeps the reading it had before this column:
-- stamped and categorised reads as filed by the classifier. Activity is pruned
-- after a year (ADR-0012), so this is the old tickets with no `category_changed`
-- row at all. One with an agent's row and no assistant's is a ticket the
-- classifier gave up on and a person filed, and the trail says so; it stays
-- null.
UPDATE "ticket" t
SET "classifierCategory" = t.category
WHERE t."classifierCategory" IS NULL
  AND t."classifiedAt" IS NOT NULL
  AND t.category IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "ticket_activity" a
    WHERE a."ticketId" = t.id
      AND a.action = 'category_changed'
  );
