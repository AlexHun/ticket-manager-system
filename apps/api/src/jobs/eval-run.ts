import type { PgBoss, Db } from "pg-boss";
import {
  EVAL_CORPUS,
  EVAL_RUN_STATUS,
  evalCaseCounters,
  evalCounterSumSelect,
  evalRunCounters,
  type EvalCorpus,
} from "@ticket/shared";
import { autoReplyCaseById, AUTO_REPLY_CASES } from "@ticket/core";
import { autoReplyArticles, type KbArticle } from "../ai/knowledge-base";
import { prisma } from "../db";
import { isEvalConfigured } from "../evals/config";
import { frozenCorpus } from "../evals/frozen-corpus";
import { expectedCategoryOf, EVAL_REPEATS, runCase } from "../evals/runner";
import { storedVerdict } from "../evals/stored-verdict";
import { publishEvalRunChanged } from "../events/ticket-events";
import { getBoss, registerWorker, type WorkerSpec } from "./boss";

/**
 * Running one eval, off the request that asked for it.
 *
 * The scheduling and bookkeeping half of the harness; `../evals/runner.ts` is
 * the measuring half and `../evals/frozen-corpus.ts` is where the frozen corpus
 * comes from.
 *
 * **The request must not wait for it** (PRD R5). A run is ~175 model calls end
 * to end, and an admin holding an HTTP connection open for that is a request a
 * proxy will close and a page that cannot say what is happening. So
 * `POST /api/evals/runs` writes the `EvalRun` row and enqueues this in the same
 * transaction, exactly as the inbound webhook enqueues classification: the row
 * and the job share a fate, and the page hears about it over `/api/events`.
 *
 * **A case result is written and announced the moment that case finishes**, not
 * at the end. That is what makes R5's second half true — an admin watches the
 * run fill in case by case rather than staring at a spinner for several minutes
 * wondering whether anything is happening. It is also what forces the
 * idempotency story below to be more than one conditional write.
 *
 * **The run row is the source of truth, not the job.** pg-boss delivers at
 * least once, so this may arrive twice, late, or after a restart. Three guards,
 * and each one is there for a different delivery:
 *
 * 1. `finishedAt` is re-read *above* everything else, so a delivery arriving
 *    after the run closed pays for nothing. This is the one thing this handler
 *    does differently from the classifier's, and the reason is money: a
 *    duplicate classification costs a call that gets thrown away, whereas here
 *    the calls **are** the whole cost of the feature.
 * 2. Cases that already have a result row for this run are skipped, so a
 *    delivery that arrives mid-run (an expiry, a redeploy) resumes rather than
 *    starting again — the expensive half of the work is already paid for.
 * 3. `@@unique([runId, caseId])` is the backstop under both, so two workers
 *    racing the same run cannot double a case in the rates taken off these rows.
 */

/** The queue an eval run is announced on. */
export const EVAL_RUN_QUEUE = "eval-run";

/**
 * Concurrent runs on this node.
 *
 * One, and for a different reason from the classifier's two: a run is not
 * competing with an agent's spinner, it is competing with **itself**. Two runs
 * at once would interleave their model calls against one provider account, and
 * the measurement rests on repeats of a case seeing an identical prompt prefix
 * so OpenAI's cache engages (`ai-features.md` on `cached=`). Serial runs also
 * mean the cost of the feature is one run's worth at a time, which is the honest
 * shape for something an admin triggers by clicking.
 */
const LOCAL_CONCURRENCY = 1;

/**
 * How long one run may be active before pg-boss assumes the worker died.
 *
 * Forty minutes, and the arithmetic matters more than the number: a full set is
 * ~35 cases × 5 repeats, each repeat capped at the 30s ceiling inside
 * `autoReply`, so a genuinely slow run is minutes and a pathological one is
 * longer than anybody would wait. A run re-offered halfway through would be
 * answered twice and pay twice, which is why this is generous rather than tight
 * — and why guard 2 above exists for the case where it happens anyway.
 */
const EXPIRE_IN_SECONDS = 40 * 60;

/** A `type` rather than an `interface`, so it satisfies `WorkerSpec`'s payload
 *  constraint — see the note there. */
export type EvalRunJob = {
  runId: number;
  corpus: EvalCorpus;
  /** The cases to answer, resolved by the route. Every case, unless pinned. */
  caseIds: string[];
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
  corpus: EvalCorpus,
  caseIds: string[],
  db?: Db,
): Promise<void> {
  if (!isEvalConfigured()) return;

  await getBoss().send(
    EVAL_RUN_QUEUE,
    { runId, corpus, caseIds } satisfies EvalRunJob,
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
 * The corpus a run answers from (R4).
 *
 * The two are never mixed and never averaged, and that is enforced one level up
 * — the run carries its corpus on the row and nothing aggregates across runs.
 * Here it is simply a fork: the frozen file, whose numbers move only when the
 * code does, or the live table, where an admin's edit and a prompt regression
 * look identical from a chart.
 */
async function corpusFor(corpus: EvalCorpus): Promise<KbArticle[]> {
  // `autoReplyArticles()` and not a second query of its own: `orderBy: id` and
  // the two structural filters (withheld articles absent, `internalNote` never
  // selected) are properties of *that* function, and a run measuring a corpus
  // assembled any other way would be measuring a prompt the desk never builds.
  return corpus === EVAL_CORPUS.live ? autoReplyArticles() : frozenCorpus();
}

/**
 * Answer a run's cases and record what each one did.
 *
 * Returns rather than throws for everything that will fail identically forever
 * — a run id nothing names, a case set with nothing left in it — because those
 * are not retryable and a ladder would only say the same thing five times. A
 * provider failure is a different matter and is left to the runner's own
 * verdict: it comes back as `abandoned` repeats on the row rather than as a
 * throw, so a run through an outage produces a readable result — "the provider
 * answered none of this" — instead of vanishing into the dead-letter queue.
 */
async function handle(job: EvalRunJob): Promise<void> {
  const { runId, corpus, caseIds } = job;

  // Above everything, not below it. A duplicate delivery must discover it has
  // nothing to write *before* it pays for a hundred and seventy-five answers.
  const run = await prisma.evalRun.findUnique({
    where: { id: runId },
    select: { finishedAt: true, repeats: true },
  });
  if (!run) return;
  if (run.finishedAt !== null) return;

  const cases = caseIds
    .map(autoReplyCaseById)
    .filter((c): c is NonNullable<typeof c> => c !== null);

  if (cases.length === 0) {
    // The case set is code; ids that no longer name one are a rename that
    // outlived a queued job. Nothing to retry.
    if (
      await settle(
        runId,
        EVAL_RUN_STATUS.failed,
        `No such case: ${caseIds.join(", ")}`,
      )
    ) {
      publishEvalRunChanged(runId);
    }
    return;
  }

  // Guard 2: what a re-delivery has already paid for. Read once rather than per
  // case — the set is small and a run answers it in one pass.
  const done = new Set(
    (
      await prisma.evalCaseResult.findMany({
        where: { runId },
        select: { caseId: true },
      })
    ).map((r) => r.caseId),
  );

  const articles = await corpusFor(corpus);

  for (const evalCase of cases) {
    if (done.has(evalCase.id)) continue;

    const outcome = await runCase(articles, evalCase, run.repeats);

    await prisma.evalCaseResult.create({
      data: {
        runId,
        caseId: evalCase.id,
        // Denormalised, all four of them: a stored result has to keep saying
        // what it was measured against, however the case set is edited later.
        caseName: evalCase.name,
        adversarial: evalCase.adversarial,
        expectedOutcome: evalCase.expected.outcome,
        expectedDecline: evalCase.expected.decline,
        // Null on the two cases the classifier is not scored against, rather
        // than the category they happen to declare: a row reading "expected
        // General, 0 of 0 classified" claims a measurement nobody made.
        expectedCategory: expectedCategoryOf(evalCase),
        // Every counter `EVAL_COUNTERS` declares, taken off the outcome by
        // name. The outcome carries its verdicts too, and those go below.
        ...evalCaseCounters(outcome),
        // The one place a verdict is projected into the column, and the same
        // module is the only place it is read back — `evals/stored-verdict.ts`
        // is where the six fields are chosen, and where the older shapes those
        // rows can be in are accounted for.
        verdicts: outcome.verdicts.map(storedVerdict),
      },
    });

    // Per case, after its own commit. This is the whole of R5's second half:
    // an admin watching a run watches it fill in, rather than watching a
    // spinner for several minutes with no way to tell a working run from a
    // wedged one. Published after the write and never inside a transaction
    // (ADR-0015) — a subscriber told mid-commit caches pre-commit state and is
    // never corrected, because the event that would have corrected it is spent.
    publishEvalRunChanged(runId);
  }

  // The totals, read back from the rows rather than accumulated in a variable:
  // guard 2 means some of those rows may have been written by an earlier
  // delivery of this same job, and a run's headline number has to cover the
  // whole run rather than this attempt's share of it.
  const totals = await prisma.evalCaseResult.aggregate({
    where: { runId },
    _sum: evalCounterSumSelect(),
  });

  const closed = await prisma.evalRun.updateMany({
    where: { id: runId, finishedAt: null },
    data: {
      status: EVAL_RUN_STATUS.completed,
      finishedAt: new Date(),
      // Each per-case counter onto the run column `EVAL_COUNTERS` names for it
      // — the one place `repeats` becomes `attempts`, because a run's is the
      // sum over its cases and not the same number.
      ...evalRunCounters(totals._sum),
    },
  });

  // Lost the race to another delivery of this same job, which has already
  // written the same totals off the same rows. Nothing to announce.
  if (closed.count === 0) return;

  const attempts = totals._sum.repeats ?? 0;
  const matches = totals._sum.matches ?? 0;
  const caught = totals._sum.caught ?? 0;
  const escaped = totals._sum.escaped ?? 0;
  console.log(
    `[evals] run ${runId} (${corpus}): ${matches}/${attempts} repeats as expected across ` +
      `${cases.length} case(s), caught=${caught} escaped=${escaped}, ` +
      `filed=${totals._sum.classifyMatches ?? 0}/${totals._sum.classifiedRepeats ?? 0}, ` +
      `usd~${(totals._sum.usd ?? 0).toFixed(4)}`,
  );

  // Said separately and in these words because it is not a number that moved:
  // a payload reached a reply this desk was willing to send, which is ADR-0004's
  // claim failing. Everything else a run prints is a measurement; this is a bug,
  // and the screen alone is not where somebody would find it at three in the
  // morning.
  if (escaped > 0) {
    console.error(
      `[evals] run ${runId}: ${escaped} adversarial repeat(s) reached an accepted reply carrying the payload`,
    );
  }

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
 *
 * Whatever case results the run did manage are left where they are: they were
 * measured and they are true, and deleting them would throw away the half of the
 * answer that survived. The run is marked `failed`, which is what says its
 * numbers cover less than a whole set.
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

/** Every case in the set, which is what a run answers unless it was pinned. */
export const ALL_EVAL_CASE_IDS = AUTO_REPLY_CASES.map((c) => c.id);

/** How many times each case is answered. Re-exported so the route can stamp the row. */
export { EVAL_REPEATS };

/** Create the queues and start the workers. Called once, from `./index`. */
export async function registerEvalRun(boss: PgBoss): Promise<void> {
  await registerWorker(boss, EVAL_RUN_WORKER);
}
