-- The prompt cache's denominator becomes a counter (#223).
--
-- `cacheable` — how many repeats of a case could have hit the prompt cache —
-- was derived at read time by `routes/evals.ts`, as `Σ max(repeats - 1, 0)`
-- over the stored rows, while the numerator beside it was computed by
-- `runCase` from `verdicts.slice(1)`. One rule, two expressions, nothing making
-- them agree. It is now written where every other counter is written.
--
-- **These rows are backfilled, and that is the opposite of what the
-- classifier-accuracy migration did.** The difference is whether the
-- measurement happened. No run before that migration asked the classifier
-- anything, so zero was the true answer and an old run honestly reports no
-- classifier accuracy at all. Here the measurement *did* happen: every existing
-- run counted its cache hits, and only the denominator lived somewhere else. So
-- the column is filled from the rule the route was applying a moment ago,
-- against the same `repeats` it read, which leaves every historical run
-- reporting exactly the rate it reported before this migration. Left at zero
-- instead, a finished run would draw "4 of 0 repeats" — a numerator with no
-- denominator, which reads as a broken screen rather than as an absence.

-- eval_case_result: the case's own denominator, one repeat per case removed
-- because that is the one that warms the cache.
ALTER TABLE "eval_case_result" ADD COLUMN "cacheable" INTEGER NOT NULL DEFAULT 0;
UPDATE "eval_case_result" SET "cacheable" = GREATEST("repeats" - 1, 0);

-- eval_run: summed from its cases, exactly as the route summed it and as the
-- worker will sum it from now on. A run with no case results counted nothing,
-- and zero is the right answer for it.
ALTER TABLE "eval_run" ADD COLUMN "cacheable" INTEGER NOT NULL DEFAULT 0;
UPDATE "eval_run" SET "cacheable" = COALESCE(
  (
    SELECT SUM("cacheable")
    FROM "eval_case_result"
    WHERE "eval_case_result"."runId" = "eval_run"."id"
  ),
  0
);
