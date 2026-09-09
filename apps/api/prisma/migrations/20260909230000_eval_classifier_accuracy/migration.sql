-- Classifier accuracy gets somewhere to live (PRD R15).
--
-- Nothing is backfilled, for the reason the catch-rate migration gives: no run
-- before this one asked the classifier anything, so zero is the true answer to
-- "how many repeats were classified" rather than a number invented for old
-- rows. `EvalMetricRow.value` is null on a zero denominator, so an earlier run
-- reports no classifier accuracy at all — not a perfect one, and not a zero.

-- eval_run: the rate's two halves, rolled up from the cases.
ALTER TABLE "eval_run" ADD COLUMN "classifiedRepeats" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "eval_run" ADD COLUMN "classifyMatches" INTEGER NOT NULL DEFAULT 0;

-- eval_case_result: the same pair per case, plus the expectation they are read
-- against. Nullable rather than defaulted: null is a real value here — it is
-- what the two cases the classifier cannot be scored against carry, and it is
-- also the honest reading for every row written before this column existed.
ALTER TABLE "eval_case_result" ADD COLUMN "expectedCategory" TEXT;
ALTER TABLE "eval_case_result" ADD COLUMN "classifiedRepeats" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "eval_case_result" ADD COLUMN "classifyMatches" INTEGER NOT NULL DEFAULT 0;
