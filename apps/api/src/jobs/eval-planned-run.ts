import type { PgBoss, Db } from "pg-boss";
import {
  EVAL_PLANNED_RUN_GRACE_MINUTES,
  EVAL_PLANNED_RUN_STATUS,
  type EvalCorpus,
} from "@ticket/shared";
import { prisma } from "../db";
import { isEvalConfigured } from "../evals/config";
import { startEvalRun } from "../evals/start-run";
import { ALL_EVAL_CASE_IDS } from "./eval-run";
import { getBoss, registerWorker, type WorkerSpec } from "./boss";

/**
 * A run asked for at a future time, and the deferred job that opens it (#236).
 *
 * **A planned run is not a run** (`docs/adr/0021`). It is its own row, because
 * an `EvalRun` says what was measured and a plan has measured nothing: its
 * `startedAt` would be false, its `repeats` a guess at whatever constant the
 * deploy before tonight carries, and its thresholds a snapshot taken hours
 * before the run they are supposed to have judged. What this module owns is the
 * moment a plan stops being one — and the two ways it never gets there, which
 * are cancelling and missing.
 *
 * **Nothing here is a second scheduler.** A deferred job is an ordinary
 * `send` with a `startAfter`, and cancelling it is an ordinary `cancel`:
 * enqueueing is what a consumer of the queue is for, and neither of those is on
 * the list `jobs/boss.test.ts` keeps. The *standing* schedule is the other
 * half of #236 and is not here — it is a cron, and a cron belongs to
 * `registerSweep`.
 *
 * **The plan is claimed before the run is opened**, which is the one ordering
 * decision in the file and it is about money. Delivery is at-least-once, so
 * this handler may arrive twice; a conditional `updateMany` off `planned` is
 * what makes the second arrival cost nothing. Claiming first means a crash
 * between the claim and the run leaves a plan marked `fired` with no run behind
 * it — visible, and recoverable by planning another — where the other ordering
 * would answer ~175 model calls twice and charge for both.
 */

/** The queue a planned run's deferred job is announced on. */
export const EVAL_PLANNED_RUN_QUEUE = "eval-planned-run";

/**
 * Concurrent firings on this node.
 *
 * One, and it is not the ceiling it looks like: this handler writes two rows
 * and hands the work to `EVAL_RUN_QUEUE`, whose own concurrency of one is what
 * actually serialises the expensive part. Two plans a few minutes apart is a
 * supported thing to ask for — there is deliberately no guard against planning
 * a run close to another, because the run worker takes one at a time and "two
 * runs a few minutes apart" is a fair description of what happened.
 */
const LOCAL_CONCURRENCY = 1;

/**
 * How long one firing may be active before pg-boss assumes the worker died.
 *
 * A minute, sized like the nightly sweep's and for the same reason: all this
 * does is write a row and enqueue. The forty minutes a *run* may take belongs
 * to `EVAL_RUN_WORKER`, which is the thing that takes them.
 */
const EXPIRE_IN_SECONDS = 60;

/** The grace window, as milliseconds. */
const GRACE_MS = EVAL_PLANNED_RUN_GRACE_MINUTES * 60 * 1000;

/** A `type` rather than an `interface`, so it satisfies `WorkerSpec`'s payload
 *  constraint — see the note there. */
export type EvalPlannedRunJob = {
  plannedRunId: number;
};

/**
 * Ask the queue to fire this plan when its time comes.
 *
 * Returns the job's id so the row can hold it: **cancelling a plan has to
 * release the queued job**, or the row would say cancelled while the queue went
 * on to open a run at the planned time. `db` takes a `fromPrisma(tx)` adapter
 * so the row and the job commit together, the same pairing `enqueueEvalRun`
 * keeps.
 *
 * A deployment with no key enqueues nothing and answers `null`, the rule every
 * enqueue in this directory keeps: the E2E suite's ordinary server has no key
 * and should not be quietly building a backlog to process the day somebody adds
 * one. The route refuses first; this is the belt to that braces.
 */
export async function enqueuePlannedRun(
  plannedRunId: number,
  runAt: Date,
  db?: Db,
): Promise<string | null> {
  if (!isEvalConfigured()) return null;

  return await getBoss().send(
    EVAL_PLANNED_RUN_QUEUE,
    { plannedRunId } satisfies EvalPlannedRunJob,
    { startAfter: runAt, ...(db ? { db } : {}) },
  );
}

/**
 * Release a plan's queued job.
 *
 * Cancelling a plan is two writes that have to agree — the row says cancelled,
 * the queue forgets the job — and this is the second. It is deliberately
 * tolerant of a job the queue no longer has: pg-boss answers a cancel for an
 * unknown id without complaint, and a plan whose job was already fired or swept
 * away is still a plan an admin may cancel.
 */
export async function cancelPlannedRunJob(jobId: string): Promise<void> {
  await getBoss().cancel(EVAL_PLANNED_RUN_QUEUE, jobId);
}

/**
 * Fire a plan, or record why it did not.
 *
 * Three exits, and the order of the checks is the design:
 *
 * 1. **Not `planned` any more** — cancelled, or already fired by a delivery
 *    this one is a duplicate of. Nothing to do, and nothing to say.
 * 2. **Outside the grace window** — the app was down, or a deploy overran, and
 *    this job is hours late. Marked `missed`, which starts nothing and spends
 *    nothing: firing late charges money at a moment nobody chose and stamps a
 *    trend point whose date means nothing.
 * 3. **On time** — claim the plan, then open the run through the same door the
 *    route and the nightly use.
 */
async function firePlannedRun({
  plannedRunId,
}: EvalPlannedRunJob): Promise<void> {
  const plan = await prisma.evalPlannedRun.findUnique({
    where: { id: plannedRunId },
    select: { corpus: true, runAt: true, status: true },
  });

  if (!plan || plan.status !== EVAL_PLANNED_RUN_STATUS.planned) return;

  if (Date.now() > plan.runAt.getTime() + GRACE_MS) {
    await markMissed(plannedRunId);
    console.log(
      `[evals] planned run ${plannedRunId} missed its window and started nothing`,
    );
    return;
  }

  // The claim. `updateMany` for its `where`, not its plurality — a second
  // delivery matches nothing and pays for nothing, which is the whole guard.
  const { count } = await prisma.evalPlannedRun.updateMany({
    where: { id: plannedRunId, status: EVAL_PLANNED_RUN_STATUS.planned },
    data: { status: EVAL_PLANNED_RUN_STATUS.fired },
  });
  if (count === 0) return;

  const runId = await startEvalRun(
    plan.corpus as EvalCorpus,
    ALL_EVAL_CASE_IDS,
  );

  // Written after the run exists rather than before, so the link is never a
  // promise: a plan naming a run id is a plan whose run is on the page.
  await prisma.evalPlannedRun.update({
    where: { id: plannedRunId },
    data: { runId },
  });

  // One line, unconditionally, for the reason the nightly logs one: this spends
  // money every time it fires, and an unexplained charge with no line beside it
  // is the risk the PRD names.
  console.log(
    `[evals] planned run ${plannedRunId} fired: run ${runId}, ${plan.corpus} corpus`,
  );
}

/** Mark a plan missed, if it is still waiting. */
async function markMissed(plannedRunId: number): Promise<void> {
  await prisma.evalPlannedRun.updateMany({
    where: { id: plannedRunId, status: EVAL_PLANNED_RUN_STATUS.planned },
    data: { status: EVAL_PLANNED_RUN_STATUS.missed },
  });
}

/**
 * What `./boss` needs to fire plans, and how both halves are reachable with no
 * queue running.
 *
 * **Exported**, for the reason every spec here is: what a deferred job does is
 * invisible until the afternoon it did the wrong thing, and the terminal path
 * — the ladder running out — otherwise never runs on a good day.
 *
 * `onExhausted` marks the plan missed rather than leaving it `planned`. A plan
 * whose firing failed five times over seven minutes has no job coming for it
 * any more, and `planned` would be a row promising a run that nothing will ever
 * open. Missed is the true statement, and it is the one the panel can draw.
 */
export const EVAL_PLANNED_RUN_WORKER: WorkerSpec<EvalPlannedRunJob> = {
  name: EVAL_PLANNED_RUN_QUEUE,
  concurrency: LOCAL_CONCURRENCY,
  expireInSeconds: EXPIRE_IN_SECONDS,
  handle: firePlannedRun,
  onExhausted: async ({ plannedRunId }) => {
    await markMissed(plannedRunId);
  },
};

/** Create the queues and start the workers. Called once, from `./index`. */
export async function registerEvalPlannedRun(boss: PgBoss): Promise<void> {
  await registerWorker(boss, EVAL_PLANNED_RUN_WORKER);
}
