import type { PgBoss, Db } from "pg-boss";
import { EVAL_RUN_STATUS } from "@ticket/shared";
import { autoReplyCaseById } from "@ticket/core";
import { prisma } from "../db";
import { isEvalConfigured } from "../evals/config";
import { frozenCorpus } from "../evals/frozen-corpus";
import { answerCase } from "../evals/runner";
import { publishEvalRunChanged } from "../events/ticket-events";
import { getBoss, registerWorker, type WorkerSpec } from "./boss";

/**
 * Running one eval, off the request that asked for it.
 *
 * The scheduling and bookkeeping half of the harness; `../evals/runner.ts` is
 * the measuring half and `../evals/frozen-corpus.ts` is where the corpus comes
 * from.
 *
 * **The request must not wait for it** (PRD R5). A run is model calls end to
 * end — one in slice 1, ~200 in slice 2 — and an admin holding an HTTP
 * connection open for several minutes is a request a proxy will close and a
 * page that cannot say what is happening. So `POST /api/evals/runs` writes the
 * `EvalRun` row and enqueues this in the same transaction, exactly as the
 * inbound webhook enqueues classification: the row and the job share a fate,
 * and the page hears the verdict over `/api/events` when this commits.
 *
 * **The run row is the source of truth, not the job.** pg-boss delivers at
 * least once, so this may arrive twice, late, or after a restart. The guard is
 * a conditional write on `finishedAt` — a run is finished once — and it sits
 * *above* the model call rather than below it, which is the one thing this
 * handler does differently from the classifier's. A duplicate classification
 * costs a call that gets thrown away; here the call **is** the cost of the
 * whole feature, and the PRD's "quiet cost, discovered on an invoice" risk is
 * about precisely this.
 *
 * Slice 1 answers one case, once, against the frozen corpus. The payload
 * already names a case rather than assuming one, because that is what the
 * pinned E2E subset needs and what slice 2 grows into.
 */

/** The queue an eval run is announced on. */
export const EVAL_RUN_QUEUE = "eval-run";

/**
 * Concurrent runs on this node.
 *
 * One, and for a different reason from the classifier's two: a run is not
 * competing with an agent's spinner, it is competing with **itself**. Two runs
 * at once would interleave their model calls against one provider account, and
 * slice 2's whole measurement rests on repeats of a case seeing an identical
 * prompt prefix so OpenAI's cache engages (`ai-features.md` on `cached=`).
 * Serial runs also mean the cost of the feature is one run's worth at a time,
 * which is the honest shape for something an admin triggers by clicking.
 */
const LOCAL_CONCURRENCY = 1;

/**
 * How long one run may be active before pg-boss assumes the worker died.
 *
 * Comfortably over the 30s ceiling inside `autoReply` for the one case slice 1
 * answers. Slice 2 multiplies the work by 30 cases × 5 repeats and this number
 * moves with it — a run that legitimately takes ten minutes must not be
 * re-offered halfway through and answered twice.
 */
const EXPIRE_IN_SECONDS = 120;

/** A `type` rather than an `interface`, so it satisfies `WorkerSpec`'s payload
 *  constraint — see the note there. */
export type EvalRunJob = {
  runId: number;
  caseId: string;
};

/**
 * Ask for this run to be answered.
 *
 * `db` takes a `fromPrisma(tx)` adapter so the enqueue joins the caller's
 * transaction — see `routes/evals.ts`, where the `EvalRun` row and this job
 * commit together or not at all. A run row with no job would sit at "running"
 * forever; a job with no row would find nothing to write to.
 *
 * A deployment with no key enqueues nothing, the same rule
 * `enqueueClassification` keeps and for the same reason: the E2E suite's
 * ordinary server has no key and should not be quietly building a backlog to
 * process the day somebody adds one. The route refuses first, so this is the
 * belt to that braces.
 */
export async function enqueueEvalRun(
  runId: number,
  caseId: string,
  db?: Db,
): Promise<void> {
  if (!isEvalConfigured()) return;

  await getBoss().send(
    EVAL_RUN_QUEUE,
    { runId, caseId } satisfies EvalRunJob,
    db ? { db } : {},
  );
}

/**
 * Close a run, if it is still open.
 *
 * `updateMany` for its `where`, not its plurality: a second delivery, or an
 * exhaustion arriving after a late success, must not overwrite a verdict that
 * is already recorded. Returns whether this call was the one that closed it.
 */
async function settle(
  runId: number,
  status: (typeof EVAL_RUN_STATUS)[keyof typeof EVAL_RUN_STATUS],
  error: string | null,
): Promise<boolean> {
  const { count } = await prisma.evalRun.updateMany({
    where: { id: runId, finishedAt: null },
    data: { status, error, finishedAt: new Date() },
  });
  return count > 0;
}

/**
 * Answer one case and record what it did.
 *
 * Returns rather than throws for everything that will fail identically forever
 * — a run id nothing names, a case id nothing names — because those are not
 * retryable and a ladder would only say the same thing five times. A provider
 * failure is a different matter and is left to `answerCase`'s own verdict: it
 * comes back as an `abandoned` outcome on the row rather than as a throw, so a
 * run through an outage produces a readable result instead of vanishing into
 * the dead-letter queue. That is a deliberate slice-1 simplification and the
 * place to revisit when repeats arrive.
 */
async function handle(job: EvalRunJob): Promise<void> {
  const { runId, caseId } = job;

  // Above the model call, not below it. A duplicate delivery must discover it
  // has nothing to write *before* it pays for an answer.
  const run = await prisma.evalRun.findUnique({
    where: { id: runId },
    select: { finishedAt: true },
  });
  if (!run) return;
  if (run.finishedAt !== null) return;

  const evalCase = autoReplyCaseById(caseId);
  if (!evalCase) {
    // The case set is code; an id that no longer names one is a rename that
    // outlived a queued job. Nothing to retry.
    if (
      await settle(runId, EVAL_RUN_STATUS.failed, `No such case: ${caseId}`)
    ) {
      publishEvalRunChanged(runId);
    }
    return;
  }

  const outcome = await answerCase(frozenCorpus(), evalCase);

  // One transaction, so a run is never `completed` with no result beside it —
  // which would read on screen as a run that measured nothing and found it fine.
  const closed = await prisma.$transaction(async (tx) => {
    const { count } = await tx.evalRun.updateMany({
      where: { id: runId, finishedAt: null },
      data: {
        status: EVAL_RUN_STATUS.completed,
        finishedAt: new Date(),
      },
    });
    // Lost the race to another delivery of this same job. Its result is already
    // recorded; a second one would double every rate computed off these rows.
    if (count === 0) return false;

    await tx.evalCaseResult.create({
      data: {
        runId,
        caseId: evalCase.id,
        // Denormalised, all four of them: a stored result has to keep saying
        // what it was measured against, however the case set is edited later.
        caseName: evalCase.name,
        adversarial: evalCase.adversarial,
        expectedOutcome: evalCase.expected.outcome,
        expectedDecline: evalCase.expected.decline,
        actualOutcome: outcome.outcome,
        actualDecline: outcome.decline,
        matched: outcome.matched,
      },
    });
    return true;
  });

  if (!closed) return;

  console.log(
    `[evals] run ${runId}: ${evalCase.id} reached ${outcome.outcome}` +
      `${outcome.decline ? ` (${outcome.decline})` : ""}` +
      `, ${outcome.matched ? "as expected" : "not as expected"}`,
  );

  // After the commit that made it true, never inside the transaction
  // (ADR-0015). The page refetches on this, and a subscriber told mid-commit
  // would cache pre-commit state and never be corrected.
  publishEvalRunChanged(runId);
}

/**
 * Give up on a run, without leaving it reading "running" forever.
 *
 * The dead-letter side of this queue, and — as everywhere else here — a repair
 * rather than a report: `registerWorker` has already made the log line and the
 * Sentry alert by the time this runs. A run stuck at `running` on a page whose
 * entire job is saying what happened is indistinguishable from one still in
 * flight, which is the worst state for this screen to be able to reach.
 */
async function onExhausted({ runId }: EvalRunJob): Promise<void> {
  if (
    await settle(
      runId,
      EVAL_RUN_STATUS.failed,
      "The run exhausted its retries. The provider was unreachable, or the job kept failing.",
    )
  ) {
    publishEvalRunChanged(runId);
  }
}

/**
 * What `./boss` needs to run this queue, and nothing it can work out itself.
 *
 * Exported for the reason `CLASSIFY_WORKER` is: both halves are then function
 * calls in a test with no queue running — including the terminal path, which
 * otherwise never runs on a good day.
 */
export const EVAL_RUN_WORKER: WorkerSpec<EvalRunJob> = {
  name: EVAL_RUN_QUEUE,
  concurrency: LOCAL_CONCURRENCY,
  expireInSeconds: EXPIRE_IN_SECONDS,
  handle,
  onExhausted,
};

/** Create the queues and start the workers. Called once, from `./index`. */
export async function registerEvalRun(boss: PgBoss): Promise<void> {
  await registerWorker(boss, EVAL_RUN_WORKER);
}
