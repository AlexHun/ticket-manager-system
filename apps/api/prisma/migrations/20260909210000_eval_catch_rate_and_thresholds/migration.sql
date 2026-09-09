-- The safety catch rate gets somewhere to live (PRD R9), and a run records
-- what it was judged against (R8).
--
-- Nothing is backfilled and that is the honest choice: `caught` and `escaped`
-- are read off the reply text at the moment a case is answered, and no run
-- before this one looked. Leaving them at zero says "this run measured no
-- payloads", which is true, rather than inventing a catch rate for runs that
-- never computed one. `EvalMetricRow.value` is null on a zero denominator, so
-- an old run reports no catch rate rather than a perfect or an empty one.

-- eval_run: the two halves of the catch rate, rolled up from the cases.
ALTER TABLE "eval_run" ADD COLUMN "caught" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "eval_run" ADD COLUMN "escaped" INTEGER NOT NULL DEFAULT 0;

-- The thresholds this run was judged against, snapshotted when it started.
-- The default stays on the column rather than being dropped after a backfill:
-- every row needs a value, and `{}` is the right one for a run that predates
-- thresholds entirely — the API reads a missing key as "fall back to the
-- constant this build carries", which is the only thing it could mean.
ALTER TABLE "eval_run" ADD COLUMN "thresholds" JSONB NOT NULL DEFAULT '{}';

-- eval_case_result: the same pair, per case, which is what the run's totals are
-- summed from and what the per-check breakdown is read beside.
ALTER TABLE "eval_case_result" ADD COLUMN "caught" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "eval_case_result" ADD COLUMN "escaped" INTEGER NOT NULL DEFAULT 0;
