-- A case result stops being a pass and becomes a rate (PRD R3), and a run
-- records what it cost (R10).
--
-- The slice-1 rows are migrated rather than dropped: a finished run's numbers
-- have to survive and stay readable alongside every later run (R7), and a
-- single answer is a perfectly good 1-of-1.

-- eval_run: what the run measured, and what it spent.
ALTER TABLE "eval_run" ADD COLUMN "repeats" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "eval_run" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "eval_run" ADD COLUMN "matches" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "eval_run" ADD COLUMN "abandoned" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "eval_run" ADD COLUMN "usd" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "eval_run" ADD COLUMN "cachedRepeats" INTEGER NOT NULL DEFAULT 0;

-- eval_case_result: matches out of repeats, plus every repeat's own verdict.
ALTER TABLE "eval_case_result" ADD COLUMN "repeats" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "eval_case_result" ADD COLUMN "matches" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "eval_case_result" ADD COLUMN "abandoned" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "eval_case_result" ADD COLUMN "usd" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "eval_case_result" ADD COLUMN "cachedRepeats" INTEGER NOT NULL DEFAULT 0;

-- Added with a default so the backfill below has somewhere to land, then the
-- default is dropped: a row written from here on carries the verdicts it was
-- actually built from, and nothing may write one without them.
ALTER TABLE "eval_case_result" ADD COLUMN "verdicts" JSONB NOT NULL DEFAULT '[]';

UPDATE "eval_case_result" SET
  "matches" = CASE WHEN "matched" THEN 1 ELSE 0 END,
  "abandoned" = CASE WHEN "actualOutcome" = 'abandoned' THEN 1 ELSE 0 END,
  "verdicts" = jsonb_build_array(
    jsonb_build_object(
      'outcome', "actualOutcome",
      'decline', "actualDecline",
      'matched', "matched"
    )
  );

ALTER TABLE "eval_case_result" ALTER COLUMN "verdicts" DROP DEFAULT;

-- The three columns the array above now carries, one entry per repeat.
ALTER TABLE "eval_case_result" DROP COLUMN "actualOutcome";
ALTER TABLE "eval_case_result" DROP COLUMN "actualDecline";
ALTER TABLE "eval_case_result" DROP COLUMN "matched";

-- Roll the per-case counts up onto the runs that own them.
UPDATE "eval_run" r SET
  "attempts" = COALESCE((SELECT SUM(c."repeats") FROM "eval_case_result" c WHERE c."runId" = r."id"), 0),
  "matches" = COALESCE((SELECT SUM(c."matches") FROM "eval_case_result" c WHERE c."runId" = r."id"), 0),
  "abandoned" = COALESCE((SELECT SUM(c."abandoned") FROM "eval_case_result" c WHERE c."runId" = r."id"), 0);

-- One row per case per run. The worker writes each case result as that case
-- finishes, so an admin can watch a run fill in — which means a job re-delivered
-- mid-run would otherwise write a second row for a case it had already answered
-- and double it in every rate taken off these.
CREATE UNIQUE INDEX "eval_case_result_runId_caseId_key" ON "eval_case_result"("runId", "caseId");
