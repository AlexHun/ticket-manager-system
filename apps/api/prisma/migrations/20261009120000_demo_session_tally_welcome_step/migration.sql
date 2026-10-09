-- Whether a demo session followed one of the welcome's suggested steps (#464,
-- demo-welcome PRD R11). A flag on the existing tally row, so it outlives the
-- nightly reset like the other two figures.

-- AlterTable
ALTER TABLE "demo_session_tally" ADD COLUMN     "followedWelcomeStep" BOOLEAN NOT NULL DEFAULT false;
