import { fromPrisma } from "pg-boss";
import { EVAL_THRESHOLD, type EvalCorpus } from "@ticket/shared";
import { prisma } from "../db";
import { publishEvalRunChanged } from "../events/ticket-events";
import { enqueueEvalRun, EVAL_REPEATS } from "../jobs/eval-run";

/**
 * Opening a run: one row, one job, one event.
 *
 * The harness has two front doors and this is the hallway behind both of them.
 * `routes/evals.ts` is an admin pressing Run; `jobs/eval-nightly.ts` is the
 * clock. What they share is not merely "create a row" — it is four decisions
 * that have to be made the same way at both, and the kind that go quietly out
 * of step when they are written twice:
 *
 * 1. **The row and the job commit together.** `enqueueEvalRun` is handed
 *    `fromPrisma(tx)`, so both land or neither does — the pattern `ingest.ts`
 *    uses for classification. A job with no row finds nothing to write to; a
 *    row with no job sits at `running` forever, on a page whose entire purpose
 *    is saying what happened.
 * 2. **The repeat count is stamped, not assumed.** A rate read months later
 *    means nothing without the denominator it was taken over.
 * 3. **The thresholds are snapshotted** (R8). Judged live against whatever
 *    constant this build carries, an edit to `EVAL_THRESHOLD` would silently
 *    re-colour every run in the history, including the ones somebody took a
 *    decision off. A run says what it was measured against *and* what it was
 *    judged against, or it is not a record.
 * 4. **The event is published after the commit, never inside it** (ADR-0015).
 *    A subscriber told mid-transaction reads pre-commit state, caches it, and is
 *    never corrected, because the event that would have corrected it is spent.
 *
 * It is a module of its own rather than an export on `jobs/eval-run.ts` for a
 * testing reason that is not incidental: `routes/evals.test.ts` replaces
 * `enqueueEvalRun` on that specifier to keep `getBoss()` out of a router test.
 * A `startEvalRun` living in the same file would call its own local binding
 * rather than the module's, so the stub would not apply and the route test
 * would need a queue running. Across a module boundary the seam holds, which is
 * the narrow-seam rule in `testing.md` applied one level up.
 *
 * **It does not check `isEvalConfigured()`.** Both callers already refuse
 * first, for reasons of their own — the route owes the caller a 503 rather than
 * a run it can never finish, and the sweep is not registered at all without a
 * key. A third check here would be a third place to keep in step, and
 * `enqueueEvalRun` is the belt to those braces.
 */
export async function startEvalRun(
  corpus: EvalCorpus,
  caseIds: string[],
): Promise<number> {
  const { id } = await prisma.$transaction(async (tx) => {
    const created = await tx.evalRun.create({
      data: { corpus, repeats: EVAL_REPEATS, thresholds: EVAL_THRESHOLD },
      select: { id: true },
    });
    await enqueueEvalRun(created.id, corpus, caseIds, fromPrisma(tx));
    return created;
  });

  publishEvalRunChanged(id);

  return id;
}
