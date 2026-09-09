/**
 * Unit tests for `apps/api/src/routes/evals.ts`.
 *
 * The router only, on a real Express app over a real database (`../test/pg`,
 * ADR-0014). Four things it is responsible for and nothing else can be: the
 * run row exists before the response returns, the request does not block on the
 * run, a deployment with no key refuses instead of queueing work that will
 * never be done, and the corpus the caller asked for is the corpus that gets
 * recorded and enqueued — because the two must never disagree about which
 * series a run belongs to.
 *
 * Two seams, and each is deliberately a specifier nothing else in this suite
 * owns. `../evals/config` is the one-line guard `isEvalConfigured()` exists for
 * — reading `../ai/provider` directly here would put a second *stateful* stub
 * on a specifier `jobs/sweeps.test.ts` already owns, and the registry keeps one
 * of two (testing.md, #174). `../jobs/eval-run` stands in for the enqueue,
 * because `getBoss()` throws with no queue running — and it is mocked rather
 * than `../jobs/boss`, which `jobs/sweeps.test.ts` owns under a path that
 * resolves to the same module. Both factories **spread the real module**; see
 * the note on the second one for what happened when one of them did not.
 */

import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  EVAL_CORPUS,
  EVAL_RUN_LIMIT,
  EVAL_RUN_STATUS,
  EVAL_METRIC,
  EVAL_THRESHOLD,
  PIPELINE_OUTCOME,
  TICKET_CATEGORY,
  type EvalCorpus,
  type EvalMetric,
  type EvalMetricRow,
  type EvalRunStatus,
  type EvalRunsResponse,
  type EvalRunStartedResponse,
  type TicketCategory,
} from "@ticket/shared";
import { AUTO_REPLY_CASES } from "@ticket/core";
import { prisma, resetDb } from "../test/pg";
import { serveRouter } from "../test/route-app";

/* ── The world behind the router ─────────────────────────────────────────── */

const fakeGuard = (req: Request, res: Response, next: NextFunction) => {
  res.locals.session = {
    user: {
      id: req.header("x-test-user") ?? "admin-1",
      name: "Adele Admin",
      email: "admin@example.com",
    },
    session: { id: "sess-1" },
  };
  next();
};

mock.module("../middleware/auth", () => ({
  requireAuth: fakeGuard,
  requireAdmin: fakeGuard,
  sessionOf: (res: Response) => res.locals.session,
}));

let configured = true;
mock.module("../evals/config", () => ({
  isEvalConfigured: () => configured,
}));

// **Spread, and this one was measured rather than copied.** Without it, this
// file is the first to load `../jobs/eval-run` — through a factory exporting
// one function — so the registry's copy of that module has no
// `EVAL_RUN_WORKER` on it at all, and `jobs/eval-run.test.ts`, which loads
// later, destructures `undefined`. Ten tests, green on Windows and red on
// ubuntu-latest, which is the platform-order trap `testing.md` warns about.
//
// Two things about `bun test` make it work that way, both checked directly
// rather than inferred from the failure. **Every test file's module body runs
// before any test does**, so "which file registered first" is decided entirely
// by discovery order and never by which test happens to run. And a factory
// registered later *does* reach a module that already linked the real one —
// live bindings are rewired — which is why snapshotting the real module here,
// eagerly, costs the files below nothing. It has to be eager: an `await
// import` of this same specifier inside the factory recurses.
const evalRunModule = await import("../jobs/eval-run");

let enqueued: { runId: number; corpus: EvalCorpus; caseIds: string[] }[] = [];
mock.module("../jobs/eval-run", () => ({
  ...evalRunModule,
  enqueueEvalRun: async (
    runId: number,
    corpus: EvalCorpus,
    caseIds: string[],
  ) => {
    enqueued.push({ runId, corpus, caseIds });
  },
}));

const { evalsRouter } = await import("./evals");

const url = serveRouter("/api/evals", evalsRouter);

beforeEach(async () => {
  await resetDb();
  configured = true;
  enqueued = [];
});

async function post(body: unknown = {}) {
  return fetch(url("/runs"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/* ── Starting a run ──────────────────────────────────────────────────────── */

describe("POST /runs", () => {
  test("records the run and hands back its id without waiting for it", async () => {
    const res = await post();

    // 202, not 201: the thing the caller asked for has not happened yet, and a
    // page that read this as "done" would show an empty run as a finished one.
    expect(res.status).toBe(202);
    const body = (await res.json()) as EvalRunStartedResponse;

    const run = await prisma.evalRun.findUniqueOrThrow({
      where: { id: body.runId },
    });
    expect(run.status).toBe(EVAL_RUN_STATUS.running);
    expect(run.finishedAt).toBeNull();
    // R4: every run says which knowledge base it answered, from the moment it
    // exists. Frozen unless the caller asked otherwise.
    expect(run.corpus).toBe(EVAL_CORPUS.frozen);
  });

  test("stamps the repeat count on the row rather than leaving it to be assumed", async () => {
    // A stored rate means nothing without the denominator it was taken over,
    // and a run kept for months outlives whatever constant this build carried.
    const res = await post();
    const body = (await res.json()) as EvalRunStartedResponse;

    const run = await prisma.evalRun.findUniqueOrThrow({
      where: { id: body.runId },
    });
    expect(run.repeats).toBe(5);
  });

  test("stamps the thresholds the run will be judged against", async () => {
    // R8, and the same argument as the repeat count above one step further on:
    // a run has to keep saying what it was *judged* against, not only what it
    // measured. Read live, an edit to `EVAL_THRESHOLD` would silently re-colour
    // every run in the history — including the ones a decision was taken off.
    const res = await post();
    const body = (await res.json()) as EvalRunStartedResponse;

    const run = await prisma.evalRun.findUniqueOrThrow({
      where: { id: body.runId },
    });
    expect(run.thresholds).toEqual(EVAL_THRESHOLD);
  });

  test("enqueues every case unless the caller pinned a subset", async () => {
    const res = await post();
    const body = (await res.json()) as EvalRunStartedResponse;

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]?.runId).toBe(body.runId);
    expect(enqueued[0]?.caseIds).toEqual(AUTO_REPLY_CASES.map((c) => c.id));
  });

  test("takes a pinned subset from the body", async () => {
    // What keeps the E2E suite from taking the whole set through the runner on
    // every push, and what an admin re-running one case asks for.
    const res = await post({ caseIds: ["planted-link", "refund"] });

    expect(res.status).toBe(202);
    expect(enqueued[0]?.caseIds).toEqual(["planted-link", "refund"]);
  });

  test("records and enqueues the corpus the caller asked for", async () => {
    // The row and the job must not disagree: the row is what says which series
    // the numbers belong to, and the job is what decides which articles were
    // actually answered from.
    const res = await post({ corpus: EVAL_CORPUS.live });
    const body = (await res.json()) as EvalRunStartedResponse;

    const run = await prisma.evalRun.findUniqueOrThrow({
      where: { id: body.runId },
    });
    expect(run.corpus).toBe(EVAL_CORPUS.live);
    expect(enqueued[0]?.corpus).toBe(EVAL_CORPUS.live);
  });

  test("refuses a corpus nothing names", async () => {
    const res = await post({ corpus: "whatever-is-lying-around" });

    expect(res.status).toBe(400);
    expect(await prisma.evalRun.count()).toBe(0);
  });

  test("refuses a case id nothing names, and records no run", async () => {
    // Worth a 400 rather than a run that fails several minutes later with
    // nothing to show for the wait.
    const res = await post({ caseIds: ["off-corpus", "no-such-case"] });

    expect(res.status).toBe(400);
    expect(await prisma.evalRun.count()).toBe(0);
    expect(enqueued).toEqual([]);
  });

  test("refuses when the deployment has no key, and records no run", async () => {
    // ADR-0003: one provider, one key. Unset means a run cannot start, in line
    // with how the rest of the app degrades — and a queued run nothing can
    // answer is worse than a refusal, because it reads as a run in flight.
    configured = false;

    const res = await post();

    expect(res.status).toBe(503);
    expect(await prisma.evalRun.count()).toBe(0);
    expect(enqueued).toEqual([]);
  });
});

/* ── Reading them back ───────────────────────────────────────────────────── */

/** A finished case result, with whatever this test wants to say about it. */
function caseResult(overrides: Record<string, unknown> = {}) {
  return {
    caseId: "off-corpus",
    caseName: "Nothing in the corpus covers it",
    adversarial: false,
    expectedOutcome: PIPELINE_OUTCOME.declined,
    expectedDecline: "notCovered",
    repeats: 5,
    matches: 5,
    abandoned: 0,
    usd: 0.001,
    cachedRepeats: 4,
    verdicts: Array.from({ length: 5 }, () => ({
      outcome: PIPELINE_OUTCOME.declined,
      decline: "notCovered",
      matched: true,
    })),
    ...overrides,
  };
}

/**
 * A finished run whose classifier filed things where this test says.
 *
 * One case, one expectation, and a list of what the repeats were actually filed
 * as — `null` standing for a repeat the classifier could not answer. The run's
 * two totals are derived from that list rather than stated beside it, because a
 * row whose totals disagreed with its own verdicts is a state the worker cannot
 * produce and a test asserting against one would be asserting about nothing.
 */
async function classifiedRun(
  expectedCategory: TicketCategory | null,
  filed: (TicketCategory | null)[],
) {
  const classifiedRepeats = filed.filter((c) => c !== null).length;
  const classifyMatches = filed.filter((c) => c === expectedCategory).length;

  return prisma.evalRun.create({
    data: {
      corpus: EVAL_CORPUS.frozen,
      status: EVAL_RUN_STATUS.completed,
      finishedAt: new Date(),
      repeats: filed.length,
      attempts: filed.length,
      matches: filed.length,
      thresholds: EVAL_THRESHOLD,
      classifiedRepeats,
      classifyMatches,
      results: {
        create: caseResult({
          repeats: filed.length,
          matches: filed.length,
          expectedCategory,
          classifiedRepeats,
          classifyMatches,
          verdicts: filed.map((category) => ({
            outcome: PIPELINE_OUTCOME.declined,
            decline: "notCovered",
            matched: true,
            category,
          })),
        }),
      },
    },
  });
}

/**
 * A finished run of one adversarial case, with the catch counts a test wants.
 *
 * The run's totals are what the metrics are taken off, and they are set to the
 * case's rather than left to be summed: the summing is `jobs/eval-run.ts`'s job
 * and is asserted there, so restating it here would make this file fail for the
 * worker's reasons.
 */
async function finishedRun(
  overrides: {
    caught?: number;
    escaped?: number;
    thresholds?: Record<string, number>;
    verdicts?: unknown[];
    status?: EvalRunStatus;
    error?: string;
    /** For the comparison tests, which are entirely about these three. */
    corpus?: EvalCorpus;
    startedAt?: Date;
    attempts?: number;
    matches?: number;
  } = {},
) {
  const {
    thresholds = EVAL_THRESHOLD,
    status = EVAL_RUN_STATUS.completed,
    error = null,
    corpus = EVAL_CORPUS.frozen,
    startedAt,
    attempts = 5,
    matches = 5,
    ...counts
  } = overrides;
  const caught = counts.caught ?? 0;
  const escaped = counts.escaped ?? 0;

  return prisma.evalRun.create({
    data: {
      corpus,
      status,
      error,
      ...(startedAt ? { startedAt } : {}),
      finishedAt: new Date(),
      repeats: 5,
      attempts,
      matches,
      caught,
      escaped,
      thresholds,
      results: {
        create: caseResult({
          adversarial: true,
          caseId: "planted-link",
          caught,
          escaped,
          ...(counts.verdicts ? { verdicts: counts.verdicts } : {}),
        }),
      },
    },
  });
}

async function runs(): Promise<EvalRunsResponse> {
  const res = await fetch(url("/runs"));
  return (await res.json()) as EvalRunsResponse;
}

function metricOf(body: EvalRunsResponse, metric: EvalMetric): EvalMetricRow {
  const row = body.runs[0]?.metrics.find((m) => m.metric === metric);
  if (!row) throw new Error(`No ${metric} on the run`);
  return row;
}

describe("GET /runs", () => {
  test("is empty, and says whether a run could be started at all", async () => {
    configured = false;

    const res = await fetch(url("/runs"));
    const body = (await res.json()) as EvalRunsResponse;

    expect(res.status).toBe(200);
    expect(body.runs).toEqual([]);
    // A presence boolean, never the value — the same rule the pipeline config
    // block keeps. It is what lets the page say "no key" instead of drawing a
    // Run button that always fails.
    expect(body.evalConfigured).toBe(false);
  });

  test("returns runs newest first, with their case results", async () => {
    const older = await prisma.evalRun.create({
      data: {
        corpus: EVAL_CORPUS.frozen,
        status: EVAL_RUN_STATUS.completed,
        startedAt: new Date("2026-09-01T10:00:00Z"),
        finishedAt: new Date("2026-09-01T10:00:20Z"),
        repeats: 5,
        attempts: 5,
        matches: 5,
        results: { create: caseResult() },
      },
    });
    const newer = await prisma.evalRun.create({
      data: {
        corpus: EVAL_CORPUS.frozen,
        startedAt: new Date("2026-09-02T10:00:00Z"),
      },
    });

    const res = await fetch(url("/runs"));
    const body = (await res.json()) as EvalRunsResponse;

    expect(body.runs.map((r) => r.id)).toEqual([newer.id, older.id]);
    expect(body.runs[1]?.results[0]).toMatchObject({
      caseId: "off-corpus",
      expectedDecline: "notCovered",
      // A rate, never a pass.
      repeats: 5,
      matches: 5,
    });
  });

  test("collapses the repeats into the distinct places the case landed", async () => {
    // Five identical rows say one thing five times; a case that split 3/2 is
    // the interesting one, and what a reader needs is which way and how often.
    await prisma.evalRun.create({
      data: {
        corpus: EVAL_CORPUS.frozen,
        status: EVAL_RUN_STATUS.completed,
        finishedAt: new Date(),
        repeats: 5,
        results: {
          create: caseResult({
            matches: 3,
            verdicts: [
              ...Array.from({ length: 3 }, () => ({
                outcome: PIPELINE_OUTCOME.declined,
                decline: "notCovered",
                matched: true,
              })),
              ...Array.from({ length: 2 }, () => ({
                outcome: PIPELINE_OUTCOME.resolved,
                decline: null,
                matched: false,
              })),
            ],
          }),
        },
      },
    });

    const res = await fetch(url("/runs"));
    const body = (await res.json()) as EvalRunsResponse;

    // Most frequent first, so the head of the list is what the case usually does.
    expect(body.runs[0]?.results[0]?.reached).toEqual([
      {
        outcome: PIPELINE_OUTCOME.declined,
        decline: "notCovered",
        count: 3,
        matched: true,
      },
      {
        outcome: PIPELINE_OUTCOME.resolved,
        decline: null,
        count: 2,
        matched: false,
      },
    ]);
  });

  test("reports the catch rate over payloads attempted, not over repeats", async () => {
    // R9, and the denominator is the whole argument. A repeat where the model
    // ignored the payload is on neither side of this — there was nothing to
    // catch — so a run where it happened to behave must not read as a run where
    // the checks held. Same arithmetic as the hand-measured 7-of-9.
    await finishedRun({ caught: 3, escaped: 1 });

    const body = await runs();
    const metric = metricOf(body, EVAL_METRIC.catchRate);

    expect(metric.numerator).toBe(3);
    expect(metric.denominator).toBe(4);
    expect(metric.value).toBeCloseTo(0.75, 6);
  });

  test("reports no catch rate at all when no payload was attempted", async () => {
    // Null, and not 100%. "The model planted nothing this run" is not evidence
    // that the checks work, and a screen that drew it as a perfect score would
    // be the most misleading thing on the page.
    await finishedRun({ caught: 0, escaped: 0 });

    const metric = metricOf(await runs(), EVAL_METRIC.catchRate);

    expect(metric.value).toBeNull();
    // A metric with no measurement cannot fall below a threshold.
    expect(metric.meets).toBe(true);
  });

  test("marks a run failing when a measured metric is below its threshold", async () => {
    // R8: marked failing, shown failing, and nothing else — no issue, no
    // notification, no red pull request.
    await finishedRun({ caught: 3, escaped: 1 });

    const body = await runs();

    expect(body.runs[0]?.failing).toBe(true);
    // And the run itself did not fail. A failed run fell over and has no
    // numbers; this one finished and its numbers are the answer.
    expect(body.runs[0]?.status).toBe(EVAL_RUN_STATUS.completed);
  });

  test("judges a run against the thresholds it recorded, not today's", async () => {
    // The reason the column exists. A run kept for months has to keep saying
    // what it was judged against, or editing `EVAL_THRESHOLD` silently
    // re-colours every result somebody has already taken a decision off.
    await finishedRun({
      caught: 3,
      escaped: 1,
      thresholds: { [EVAL_METRIC.catchRate]: 0.5 },
    });

    const body = await runs();

    expect(metricOf(body, EVAL_METRIC.catchRate).threshold).toBe(0.5);
    expect(body.runs[0]?.failing).toBe(false);
  });

  test("falls back to this build's threshold for a run that recorded none", async () => {
    // Every row written before the column existed. Judging it by today's
    // numbers is the only thing available and the only honest reading of an
    // absent key — the alternative is a zero that reads as a threshold nothing
    // could fail.
    await finishedRun({ caught: 3, escaped: 1, thresholds: {} });

    expect(metricOf(await runs(), EVAL_METRIC.catchRate).threshold).toBe(
      EVAL_THRESHOLD[EVAL_METRIC.catchRate],
    );
  });

  test("reports classifier accuracy over the repeats it answered", async () => {
    // R15. Four of five filed as expected, and the denominator is the repeats
    // the classifier answered rather than the repeats the run made.
    await classifiedRun(TICKET_CATEGORY.General, [
      TICKET_CATEGORY.General,
      TICKET_CATEGORY.General,
      TICKET_CATEGORY.General,
      TICKET_CATEGORY.General,
      TICKET_CATEGORY.Other,
    ]);

    const metric = metricOf(await runs(), EVAL_METRIC.classifierAccuracy);

    expect(metric.numerator).toBe(4);
    expect(metric.denominator).toBe(5);
    expect(metric.value).toBeCloseTo(0.8, 6);
  });

  test("leaves a repeat the classifier could not answer out of the rate entirely", async () => {
    // An outage is not the model getting things wrong. Two of two, not two of
    // three — the same split `abandoned` draws on the other metric.
    await classifiedRun(TICKET_CATEGORY.General, [
      TICKET_CATEGORY.General,
      TICKET_CATEGORY.General,
      null,
    ]);

    const metric = metricOf(await runs(), EVAL_METRIC.classifierAccuracy);

    expect(metric.numerator).toBe(2);
    expect(metric.denominator).toBe(2);
  });

  test("reports no classifier accuracy at all on a run that predates it", async () => {
    // Every row written before this slice: both halves zero. Null rather than a
    // zero, which would draw a catastrophe on a run that never asked.
    await finishedRun({ caught: 0, escaped: 0 });

    const metric = metricOf(await runs(), EVAL_METRIC.classifierAccuracy);

    expect(metric.value).toBeNull();
    expect(metric.meets).toBe(true);
  });

  test("says what was filed where, expected category and all", async () => {
    // The pair, not a tally of categories. "Refund → General" is the line worth
    // drawing on this desk, because the category gate is the only control
    // between a refund request and an unattended reply — and a per-category
    // count could not draw it.
    await classifiedRun(TICKET_CATEGORY.Refund, [
      TICKET_CATEGORY.General,
      TICKET_CATEGORY.General,
      TICKET_CATEGORY.Refund,
    ]);

    const body = await runs();

    expect(body.runs[0]?.categories).toEqual([
      {
        expected: TICKET_CATEGORY.Refund,
        actual: TICKET_CATEGORY.General,
        count: 2,
        matched: false,
      },
      {
        expected: TICKET_CATEGORY.Refund,
        actual: TICKET_CATEGORY.Refund,
        count: 1,
        matched: true,
      },
    ]);
  });

  test("leaves a case the classifier is not scored on out of the breakdown", async () => {
    // `expectedCategory` is null on the two cases that cannot be scored, and on
    // every row written before the column existed. Neither has a filing to
    // report, and inventing one would claim a measurement nobody made.
    await classifiedRun(null, [null, null]);

    const body = await runs();

    expect(body.runs[0]?.categories).toEqual([]);
    expect(body.runs[0]?.results[0]?.filed).toEqual([]);
    expect(body.runs[0]?.results[0]?.expectedCategory).toBeNull();
  });

  test("says which check caught each payload", async () => {
    // R9's second half. A bare catch rate cannot say which of the two string
    // comparisons is carrying the load, which is exactly what it would cost
    // most to weaken.
    await finishedRun({
      caught: 3,
      escaped: 0,
      verdicts: [
        ...Array.from({ length: 2 }, () => ({
          outcome: PIPELINE_OUTCOME.declined,
          decline: "unbackedReference",
          matched: true,
          caught: true,
        })),
        {
          outcome: PIPELINE_OUTCOME.declined,
          decline: "unbackedCommitment",
          matched: true,
          caught: true,
        },
        {
          outcome: PIPELINE_OUTCOME.declined,
          decline: "notCovered",
          matched: false,
          caught: false,
        },
      ],
    });

    const body = await runs();

    expect(body.runs[0]?.checks).toEqual([
      { decline: "unbackedReference", count: 2 },
      { decline: "unbackedCommitment", count: 1 },
    ]);
  });

  test("draws no metrics on a run that has not finished", async () => {
    // A rate over the third of the set that has finished is not a smaller
    // version of the answer, it is a different number — and a threshold applied
    // to one would go red on a run that is merely young.
    await prisma.evalRun.create({
      data: { corpus: EVAL_CORPUS.frozen, repeats: 5 },
    });

    const body = await runs();

    expect(body.runs[0]?.metrics).toEqual([]);
    expect(body.runs[0]?.failing).toBe(false);
  });

  test("draws no metrics on a run that fell over either", async () => {
    // The same argument as the test above, and the one the first version of
    // this route missed by gating on "not running" instead of "completed": a
    // run whose queue gave up part way through has answered some fraction of
    // the set, and a rate over that fraction is not a smaller version of the
    // answer. Drawn, it would put a red "Failing" badge on a card whose real
    // news is that the provider was unreachable — which is the one confusion
    // the two words exist to prevent.
    await finishedRun({
      caught: 3,
      escaped: 1,
      status: EVAL_RUN_STATUS.failed,
      error: "The run exhausted its retries.",
    });

    const body = await runs();

    expect(body.runs[0]?.metrics).toEqual([]);
    expect(body.runs[0]?.failing).toBe(false);
    // The reason it stopped is still on the row; that is what this card says.
    expect(body.runs[0]?.status).toBe(EVAL_RUN_STATUS.failed);
  });

  test("counts only the repeats that could have hit the prompt cache", async () => {
    // One repeat per case is what warms it, so the denominator is not the
    // number of repeats — a cold run would otherwise read as 20% cached forever.
    await prisma.evalRun.create({
      data: {
        corpus: EVAL_CORPUS.frozen,
        status: EVAL_RUN_STATUS.completed,
        finishedAt: new Date(),
        repeats: 5,
        cachedRepeats: 8,
        results: {
          create: [
            caseResult({ caseId: "off-corpus", cachedRepeats: 4 }),
            caseResult({ caseId: "api-access", cachedRepeats: 4 }),
          ],
        },
      },
    });

    const res = await fetch(url("/runs"));
    const body = (await res.json()) as EvalRunsResponse;

    expect(body.runs[0]?.cacheable).toBe(8);
    expect(body.runs[0]?.cachedRepeats).toBe(8);
  });

  test("a stored reason this build has no wording for reads as null", async () => {
    // The columns are plain text, the same arrangement `Ticket.autoReplyDecline`
    // keeps, so the type on the wire is a promise this route makes rather than
    // one Postgres keeps for it. Rendering a raw column at an admin is worse
    // than saying nothing.
    await prisma.evalRun.create({
      data: {
        corpus: EVAL_CORPUS.frozen,
        status: EVAL_RUN_STATUS.completed,
        finishedAt: new Date(),
        results: {
          create: caseResult({
            caseId: "x",
            caseName: "x",
            expectedDecline: "somethingFromTheFuture",
            verdicts: [
              { outcome: "alsoFromTheFuture", decline: null, matched: false },
            ],
          }),
        },
      },
    });

    const res = await fetch(url("/runs"));
    const body = (await res.json()) as EvalRunsResponse;

    expect(body.runs[0]?.results[0]?.expectedDecline).toBeNull();
    // An outcome is not nullable on the wire, so an unrecognised one falls back
    // to the honest "nothing is scheduled and nothing happened".
    expect(body.runs[0]?.results[0]?.reached[0]?.outcome).toBe(
      PIPELINE_OUTCOME.notOffered,
    );
  });

  test("a verdicts column that is not the shape this build writes does not throw", async () => {
    // `Json` makes no promise about its contents, and the migration that
    // introduced it backfilled rows written by an older build. A page whose
    // whole job is saying what happened must not 500 on one of them.
    await prisma.evalRun.create({
      data: {
        corpus: EVAL_CORPUS.frozen,
        status: EVAL_RUN_STATUS.completed,
        finishedAt: new Date(),
        results: { create: caseResult({ verdicts: { not: "an array" } }) },
      },
    });

    const res = await fetch(url("/runs"));
    const body = (await res.json()) as EvalRunsResponse;

    expect(res.status).toBe(200);
    expect(body.runs[0]?.results[0]?.reached).toEqual([]);
  });
});

/* ── What moved since last time ──────────────────────────────────────────── */

/** A day in September 2026, so a test can order runs without racing the clock. */
function sept(day: number): Date {
  return new Date(`2026-09-${String(day).padStart(2, "0")}T10:00:00Z`);
}

/** The comparison a run's decline accuracy carries, or a legible failure. */
function deltaOf(body: EvalRunsResponse, metric: EvalMetric) {
  return metricOf(body, metric).previous;
}

describe("GET /runs — comparison against the previous run (R14)", () => {
  test("compares a finished run against the one before it on the same corpus", async () => {
    // The question the whole epic exists to make answerable: an admin edits a
    // prompt, runs the harness, and reads how far each number moved without
    // opening a second page or re-running anything.
    const older = await finishedRun({
      startedAt: sept(1),
      attempts: 5,
      matches: 5,
    });
    const newer = await finishedRun({
      startedAt: sept(2),
      attempts: 5,
      matches: 3,
    });

    const body = await runs();

    expect(body.runs[0]?.id).toBe(newer.id);
    expect(body.runs[0]?.previous).toEqual({
      id: older.id,
      startedAt: sept(1).toISOString(),
    });
    // A fraction, in the same units as `value`, so the page draws percentage
    // points without the server and the screen disagreeing about the scale.
    expect(deltaOf(body, EVAL_METRIC.declineAccuracy)?.value).toBeCloseTo(1, 6);
    expect(deltaOf(body, EVAL_METRIC.declineAccuracy)?.delta).toBeCloseTo(
      -0.4,
      6,
    );
  });

  test("never compares a live run against a frozen one", async () => {
    // R4 arriving on R14's doorstep. The two corpora are independent series,
    // and a delta across them would be measuring what an admin did to the
    // article table that morning while calling it a prompt regression — the
    // single most expensive way this screen could be wrong.
    await finishedRun({
      corpus: EVAL_CORPUS.frozen,
      startedAt: sept(1),
      attempts: 5,
      matches: 5,
    });
    const live = await finishedRun({
      corpus: EVAL_CORPUS.live,
      startedAt: sept(2),
      attempts: 5,
      matches: 3,
    });

    const body = await runs();

    expect(body.runs[0]?.id).toBe(live.id);
    expect(body.runs[0]?.previous).toBeNull();
  });

  test("the first run on a corpus is compared against nothing", async () => {
    await finishedRun({ startedAt: sept(1) });

    const body = await runs();

    expect(body.runs[0]?.previous).toBeNull();
    expect(deltaOf(body, EVAL_METRIC.declineAccuracy)).toBeNull();
  });

  test("looks past a run that fell over rather than comparing against it", async () => {
    // A failed run holds whatever fraction of the set its queue got through
    // before giving up, so a rate over it is not a smaller version of the
    // answer — it is a different number that looks exactly like the real one.
    // Compared against, it would manufacture a swing out of nothing but the
    // provider having been unreachable; used as the predecessor, it would hide
    // the last real measurement. So it is skipped in both directions.
    const good = await finishedRun({
      startedAt: sept(1),
      attempts: 5,
      matches: 5,
    });
    await finishedRun({
      startedAt: sept(2),
      attempts: 1,
      matches: 0,
      status: EVAL_RUN_STATUS.failed,
      error: "The run exhausted its retries.",
    });
    const latest = await finishedRun({
      startedAt: sept(3),
      attempts: 5,
      matches: 4,
    });

    const body = await runs();

    // The failed run itself: no metrics, and so nothing to compare either.
    expect(body.runs[1]?.metrics).toEqual([]);
    expect(body.runs[1]?.previous).toBeNull();

    expect(body.runs[0]?.id).toBe(latest.id);
    expect(body.runs[0]?.previous?.id).toBe(good.id);
    expect(deltaOf(body, EVAL_METRIC.declineAccuracy)?.delta).toBeCloseTo(
      -0.2,
      6,
    );
  });

  test("reports the run it compared against even when neither run measured the metric", async () => {
    // The catch rate on two quiet nights: null on both sides, so there is no
    // delta to state — and stating a zero would say the two runs agreed about
    // something neither of them measured. The comparison still names the run,
    // which is what lets the page say what it is reading against.
    await finishedRun({ startedAt: sept(1), caught: 0, escaped: 0 });
    await finishedRun({ startedAt: sept(2), caught: 0, escaped: 0 });

    const body = await runs();

    expect(body.runs[0]?.previous).not.toBeNull();
    expect(deltaOf(body, EVAL_METRIC.catchRate)).toEqual({
      value: null,
      delta: null,
    });
  });

  test("finds the previous run even when it has fallen off the end of the page", async () => {
    // The nightly is frozen, so twenty of them push the previous *live* run out
    // of the window this route reads — and the live series would then quietly
    // stop being comparable at exactly the point somebody most wants to know
    // whether an article edit moved anything. One anchor lookup per corpus is
    // what stops the window deciding what is comparable.
    const live = await finishedRun({
      corpus: EVAL_CORPUS.live,
      startedAt: sept(1),
      attempts: 5,
      matches: 5,
    });
    for (let day = 2; day <= EVAL_RUN_LIMIT + 1; day += 1) {
      await finishedRun({ startedAt: sept(day) });
    }
    const newer = await finishedRun({
      corpus: EVAL_CORPUS.live,
      startedAt: sept(EVAL_RUN_LIMIT + 2),
      attempts: 5,
      matches: 3,
    });

    const body = await runs();

    // The older live run is nowhere on the page, which is the whole point.
    expect(body.runs).toHaveLength(EVAL_RUN_LIMIT);
    expect(body.runs.map((r) => r.id)).not.toContain(live.id);

    expect(body.runs[0]?.id).toBe(newer.id);
    expect(body.runs[0]?.previous?.id).toBe(live.id);
    expect(deltaOf(body, EVAL_METRIC.declineAccuracy)?.delta).toBeCloseTo(
      -0.4,
      6,
    );
  });
});
