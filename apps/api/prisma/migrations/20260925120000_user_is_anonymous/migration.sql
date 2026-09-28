-- Demo visitors (#319, ADR-0022). Better Auth's `anonymous` plugin declares an
-- `isAnonymous` field on the user and writes `true` on every `/sign-in/anonymous`;
-- this is that column, spelled the plugin's way.
--
-- NOT NULL with a default, so every existing row reads `false` — nobody on the
-- desk today is a demo visitor — and the filters on the assignee picker, the
-- roster and the Workload panel never have to consider a NULL.

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "isAnonymous" BOOLEAN NOT NULL DEFAULT false;
