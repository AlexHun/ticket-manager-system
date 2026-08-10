-- Clear the assignee on every ticket still pointing at a soft-deleted user.
--
-- `ticket_assignedToId_fkey` is ON DELETE SET NULL, but deleting a user here is
-- a soft delete: the row stays and only gets `deletedAt`, so the constraint
-- never fires. The ticket kept naming someone `/api/tickets/assignees` no
-- longer returns, which left it stranded — the picker could not offer them and
-- the assignment guard refused to re-select them, so the assignment could be
-- seen but not changed.
--
-- The DELETE route in `src/routes/users.ts` now clears these in the same
-- transaction as the soft delete. This is the backlog from every user deleted
-- before that existed.
UPDATE "ticket" AS t
SET "assignedToId" = NULL
FROM "user" AS u
WHERE t."assignedToId" = u."id"
  AND u."deletedAt" IS NOT NULL;
