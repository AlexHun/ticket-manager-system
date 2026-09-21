-- The evals page gets a walkthrough, like the eight that already had one (#240).
--
-- Adding a tutorial page is a migration rather than a constant because
-- `TutorialPageKey` is a Postgres enum: `tutorial_content.pageKey` and
-- `tutorial_progress.pageKey` are both of that type, so a row for the new page
-- cannot be written — nor a "seen" mark recorded — until the value exists here.
--
-- Nothing in this migration uses the new value, deliberately. Postgres will not
-- let an enum value be added and then used inside the same transaction, and
-- `prisma migrate deploy` runs a migration as one. The starter copy is seeded
-- separately by `bun run db:seed:tutorials`, which is also what keeps it from
-- overwriting an admin's edits.

-- AlterEnum
ALTER TYPE "TutorialPageKey" ADD VALUE 'evals';
