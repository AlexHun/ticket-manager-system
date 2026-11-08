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
 * The reads are held to status codes, the guards and the shape of their
 * queries: which runs reach a card, the series it is read against and the
 * sidebar's verdict. What a run's numbers mean is `../evals/read-run.ts`'s,
 * asserted as values in `../evals/read-run.test.ts` (#750).
 *
 * **One seam now, not two — this file is spike #209's converted call site.**
 * The configuration answer is no longer read off a module at all: the router is
 * a factory, it is handed a `{ evalConfigured }` object, and this file sets a
 * field on it. So the `../evals/config` registration is gone, and with it the
 * whole reason that one-line module was written — a caller reading
 * `../ai/provider` directly would put a second *stateful* stub on a specifier
 * the test preload owns (#578), and the registry keeps one of two
 * (testing.md, #174). Nothing here binds either specifier now.
 *
 * The seam that remains is `../jobs/eval-run`, which stands in for the enqueue
 * because `getBoss()` throws with no queue running — mocked rather than
 * `../jobs/boss`, which `jobs/sweeps.test.ts` owns under a path that resolves
 * to the same module. Its factory **spreads the real module**; see the note on
 * it for what happened when it did not. That one is not a configuration
 * question, so passing a value does not reach it.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  ADMIN_SCREEN,
  EVAL_CORPUS,
  EVAL_HEALTH,
  EVAL_RUN_LIMIT,
  EVAL_RUN_STATUS,
  EVAL_METRIC,
  EVAL_THRESHOLD,
  PIPELINE_OUTCOME,
  type EvalCorpus,
  type EvalMetric,
  type EvalMetricRow,
  type EvalRunStatus,
  type EvalRunsResponse,
  type EvalRunStartedResponse,
  type EvalStatusResponse,
} from "@ticket/shared";
import { AUTO_REPLY_CASES } from "@ticket/core";
import { refusesAgentAndDemo, screenReads } from "../test/boundary";
import { asCaller } from "../test/caller";
import { seedColleagues } from "../test/fixtures";
import { prisma, resetDb } from "../test/pg";
import { serveRouter } from "../test/route-app";

/* ── The world behind the router ─────────────────────────────────────────── */

// **The seam under test in spike #209**, second shape. No `mock.module` here:
// the router is handed its configuration, so this file owns it outright.
//
// A **thunk**, after a captured `boolean` was tried and measured: `serveRouter`
// mounts once for the whole file, so a boolean frozen at `createEvalsRouter`
// takes this file from 34 pass / 0 fail to 32 pass / 2 fail. The thunk answers
// per request without putting a mutable field on the config object.
//
// Note what this ends up being: `() => configured` is the same one-line
// closure the `mock.module("../evals/config", ...)` factory held. The switch
// is identical; only the registry is gone.
let configured = true;
const config = { evalConfigured: () => configured };

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
await mock.module("../jobs/eval-run", () => ({
  ...evalRunModule,
  enqueueEvalRun: async (
    runId: number,
    corpus: EvalCorpus,
    caseIds: string[],
  ) => {
    enqueued.push({ runId, corpus, caseIds });
  },
}));

const { createEvalsRouter } = await import("./evals");

const evalsRouter = createEvalsRouter(config);
const url = serveRouter("/api/evals", evalsRouter);

/** The guards are the real ones (#366), and every route here is an admin's. */
const ADMIN = asCaller("admin");

beforeEach(async () => {
  await resetDb();
  await seedColleagues("admin");
  configured = true;
  enqueued = [];
});

/* ── Who it refuses (#367) ───────────────────────────────────────────────── */

refusesAgentAndDemo(url, evalsRouter, ["POST /runs"]);
screenReads(url, evalsRouter, ADMIN_SCREEN.evals, ["GET /runs", "GET /status"]);

async function post(body: unknown = {}) {
  return fetch(url("/runs"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...ADMIN },
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
    expect(await res.json()).toEqual({
      error: "Couldn't start the run — no AI provider is configured.",
    });
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
    cacheable: 4,
    verdicts: Array.from({ length: 5 }, () => ({
      outcome: PIPELINE_OUTCOME.declined,
      decline: "notCovered",
      matched: true,
    })),
    ...overrides,
  };
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

/**
 * The list, of one corpus (#234).
 *
 * The corpus is a query parameter now, and an absent one reads as frozen — so
 * every test above that calls this bare is asking for the frozen series, which
 * is what they were already seeding.
 */
async function runs(corpus?: EvalCorpus): Promise<EvalRunsResponse> {
  const res = await fetch(url(corpus ? `/runs?corpus=${corpus}` : "/runs"), {
    headers: ADMIN,
  });
  return (await res.json()) as EvalRunsResponse;
}

/**
 * One metric off a run on the page — the newest unless a test says otherwise.
 *
 * `at` is a signed index into `runs`, so `-1` is the oldest run drawn: the
 * comparison tests care about the newest, and the one about a predecessor that
 * fell off the end of the page cares about the last card on it.
 */
function metricOf(
  body: EvalRunsResponse,
  metric: EvalMetric,
  at = 0,
): EvalMetricRow {
  const row = body.runs.at(at)?.metrics.find((m) => m.metric === metric);
  if (!row) throw new Error(`No ${metric} on the run`);
  return row;
}

describe("GET /runs", () => {
  test("is empty, and says whether a run could be started at all", async () => {
    configured = false;

    const res = await fetch(url("/runs"), { headers: ADMIN });
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

    const res = await fetch(url("/runs"), { headers: ADMIN });
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

  test("marks a run failing exactly when the sidebar does", async () => {
    // R8 and #608: one verdict, the card's badge and the sidebar's mark. A
    // decline-accuracy miss with nothing escaped, so the mark says failing
    // rather than the louder escaped; then a run that passes clears both.
    await finishedRun({ caught: 4, matches: 2, startedAt: sept(1) });

    const body = await runs();

    expect(body.runs[0]?.failing).toBe(true);
    expect((await status()).health).toBe(EVAL_HEALTH.failing);
    // And the run itself did not fail. A failed run fell over and has no
    // numbers; this one finished and its numbers are the answer.
    expect(body.runs[0]?.status).toBe(EVAL_RUN_STATUS.completed);

    await finishedRun({ caught: 4, startedAt: sept(2) });

    expect((await runs()).runs[0]?.failing).toBe(false);
    expect((await status()).health).toBe(EVAL_HEALTH.passing);
  });

  test("reports the cache denominator the run recorded, deriving nothing", async () => {
    // One repeat per case is what warms it, so the denominator is not the
    // number of repeats — a cold run would otherwise read as 20% cached
    // forever. **That rule is applied by `runCase` and only there** (#223);
    // this route reads the column, and the two numbers on the wire are the two
    // the run wrote.
    //
    // The row is written so that `Σ max(repeats - 1, 0)` over its cases — the
    // expression this route used to compute the denominator with — gives 4 and
    // the stored counter gives 8. Nothing a worker writes looks like this; it
    // is built this way so the assertion can only pass if the route stopped
    // deriving. A fixture where the two agree would pass either way, which is
    // how one rule in two modules stayed invisible for as long as it did.
    await prisma.evalRun.create({
      data: {
        corpus: EVAL_CORPUS.frozen,
        status: EVAL_RUN_STATUS.completed,
        finishedAt: new Date(),
        repeats: 5,
        cachedRepeats: 8,
        cacheable: 8,
        results: {
          create: [
            caseResult({ caseId: "off-corpus", repeats: 3, cachedRepeats: 4 }),
            caseResult({ caseId: "api-access", repeats: 3, cachedRepeats: 4 }),
          ],
        },
      },
    });

    const res = await fetch(url("/runs"), { headers: ADMIN });
    const body = (await res.json()) as EvalRunsResponse;

    expect(body.runs[0]?.cacheable).toBe(8);
    expect(body.runs[0]?.cachedRepeats).toBe(8);
    // And the case's own pair travels with it, so a reader can see which case
    // stopped hitting the cache rather than only that the run did.
    expect(body.runs[0]?.results[0]?.cacheable).toBe(4);
  });

  test("a verdicts column that is not the shape this build writes does not throw", async () => {
    // `Json` makes no promise about its contents, and the migration that
    // introduced it backfilled rows written by an older build. A page whose
    // whole job is saying what happened must not 500 on one of them.
    // The 200 is the claim only this seam can make; that such a column parses
    // to no repeats is asserted against values in `evals/stored-verdict.test.ts`.
    await prisma.evalRun.create({
      data: {
        corpus: EVAL_CORPUS.frozen,
        status: EVAL_RUN_STATUS.completed,
        finishedAt: new Date(),
        results: { create: caseResult({ verdicts: { not: "an array" } }) },
      },
    });

    const res = await fetch(url("/runs"), { headers: ADMIN });
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

/** What a run on the page says the run before it made of `metric`. */
function previousOf(body: EvalRunsResponse, metric: EvalMetric, at = 0) {
  return metricOf(body, metric, at).previous;
}

/* ── What the sidebar is told (#608) ─────────────────────────────────────── */

async function status(): Promise<EvalStatusResponse> {
  const res = await fetch(url("/status"), { headers: ADMIN });
  return (await res.json()) as EvalStatusResponse;
}

describe("GET /status", () => {
  test("is null while the frozen corpus has no completed run", async () => {
    expect(await status()).toEqual({ health: null });
  });

  test("is passing when the latest frozen run meets every threshold", async () => {
    await finishedRun({ caught: 4 });

    expect((await status()).health).toBe(EVAL_HEALTH.passing);
  });

  test("is failing when the latest frozen run is below a threshold", async () => {
    // Decline accuracy at 2 of 5, with nothing escaped: a missed threshold, not
    // a defect.
    await finishedRun({ caught: 4, matches: 2 });

    expect((await status()).health).toBe(EVAL_HEALTH.failing);
  });

  test("is escaped when the latest frozen run let a payload through", async () => {
    // Below the catch rate too, and the louder reading wins.
    await finishedRun({ caught: 3, escaped: 1 });

    expect((await status()).health).toBe(EVAL_HEALTH.escaped);
  });

  test("reads the thresholds the run recorded", async () => {
    // Decline accuracy at 2 of 5 fails this build's bar and passes the one the
    // run stamped. What the rule is belongs to `isRunFailing`; this holds that
    // the query hands it the stamped column at all.
    await finishedRun({
      caught: 4,
      matches: 2,
      thresholds: { [EVAL_METRIC.declineAccuracy]: 0.4 },
    });

    expect((await status()).health).toBe(EVAL_HEALTH.passing);
  });

  test("clears when a later frozen run passes", async () => {
    await finishedRun({ caught: 3, escaped: 1, startedAt: sept(1) });
    await finishedRun({ caught: 4, startedAt: sept(2) });

    expect((await status()).health).toBe(EVAL_HEALTH.passing);
  });

  test("is neither set nor cleared by a live run (R4)", async () => {
    await finishedRun({ caught: 4, startedAt: sept(1) });
    await finishedRun({
      caught: 3,
      escaped: 1,
      corpus: EVAL_CORPUS.live,
      startedAt: sept(2),
    });
    expect((await status()).health).toBe(EVAL_HEALTH.passing);

    await finishedRun({ caught: 3, escaped: 1, startedAt: sept(3) });
    await finishedRun({
      caught: 4,
      corpus: EVAL_CORPUS.live,
      startedAt: sept(4),
    });
    expect((await status()).health).toBe(EVAL_HEALTH.escaped);
  });

  test("reads past a run in flight or one that fell over", async () => {
    // Neither has numbers to judge (the same gate `metrics` is behind), so the
    // last judgement stands until a run finishes properly.
    await finishedRun({ caught: 3, escaped: 1, startedAt: sept(1) });
    await finishedRun({
      status: EVAL_RUN_STATUS.failed,
      error: "provider unreachable",
      startedAt: sept(2),
    });
    await finishedRun({ status: EVAL_RUN_STATUS.running, startedAt: sept(3) });

    expect((await status()).health).toBe(EVAL_HEALTH.escaped);
  });
});

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
    // The predecessor's own rate, as a fraction — 5 of 5, against this run's 3
    // of 5. The subtraction is the page's, over the two figures it draws, so
    // that a caption can never round the other way from the numbers above it.
    expect(previousOf(body, EVAL_METRIC.declineAccuracy)?.value).toBeCloseTo(
      1,
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

    // Asked for by name since #234, which is the other half of the same rule:
    // the frozen run is not merely skipped as a predecessor, it is not on this
    // page at all.
    const body = await runs(EVAL_CORPUS.live);

    expect(body.runs[0]?.id).toBe(live.id);
    expect(body.runs[0]?.previous).toBeNull();
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
    // The good run's 5 of 5, not the failed one's 0 of 1 — the value says which
    // run was read as well as the id does.
    expect(previousOf(body, EVAL_METRIC.declineAccuracy)?.value).toBeCloseTo(
      1,
      6,
    );
  });

  test("finds the previous run even when it has fallen off the end of the page", async () => {
    // A series longer than the window this route reads — the nightly is frozen,
    // so this is where the frozen series lands after three weeks. Without the
    // lookup past the page the oldest run drawn would quietly stop being comparable at
    // exactly the point somebody most wants to know whether something moved.
    //
    // 4 of 5, where every run in the way is 5 of 5: the value that comes back
    // names which run was read, not only the id beside it.
    const oldest = await finishedRun({
      startedAt: sept(1),
      attempts: 5,
      matches: 4,
    });
    for (let day = 2; day <= EVAL_RUN_LIMIT + 1; day += 1) {
      await finishedRun({ startedAt: sept(day) });
    }

    const body = await runs();

    // The oldest run is nowhere on the page, which is the whole point.
    expect(body.runs).toHaveLength(EVAL_RUN_LIMIT);
    expect(body.runs.map((r) => r.id)).not.toContain(oldest.id);

    // The oldest run *drawn*, which is the one whose predecessor is off-page.
    expect(body.runs.at(-1)?.previous?.id).toBe(oldest.id);
    expect(
      previousOf(body, EVAL_METRIC.declineAccuracy, -1)?.value,
    ).toBeCloseTo(0.8, 6);
  });
});

/* ── A case's recent history, and the fall flag (#607, #712) ─────────────── */

/**
 * A finished run answering the cases a test names, each with its own matches.
 *
 * Only the counters a history reads are made to agree — the run's `matches`
 * and `attempts` are the cases' sums, so its decline accuracy is what the
 * trailing average pools. The verdicts stay `caseResult`'s five matched
 * repeats: nothing in a history reads them. `abandoned` names the cases with
 * repeats the provider left unanswered, and how many.
 */
async function seriesRun(
  startedAt: Date,
  cases: Record<string, number>,
  overrides: {
    corpus?: EvalCorpus;
    status?: EvalRunStatus;
    abandoned?: Record<string, number>;
  } = {},
) {
  const entries = Object.entries(cases);
  const abandonedOf = (caseId: string) => overrides.abandoned?.[caseId] ?? 0;

  return prisma.evalRun.create({
    data: {
      corpus: overrides.corpus ?? EVAL_CORPUS.frozen,
      status: overrides.status ?? EVAL_RUN_STATUS.completed,
      startedAt,
      finishedAt: new Date(),
      repeats: 5,
      attempts: entries.length * 5,
      matches: entries.reduce((sum, [, matches]) => sum + matches, 0),
      abandoned: entries.reduce((sum, [id]) => sum + abandonedOf(id), 0),
      thresholds: EVAL_THRESHOLD,
      results: {
        create: entries.map(([caseId, matches]) =>
          caseResult({ caseId, matches, abandoned: abandonedOf(caseId) }),
        ),
      },
    },
  });
}

/** One case's row off a run on the page — the newest unless told otherwise. */
function caseOf(body: EvalRunsResponse, caseId: string, at = 0) {
  const row = body.runs.at(at)?.results.find((r) => r.caseId === caseId);
  if (!row) throw new Error(`No ${caseId} on the run`);
  return row;
}

/** A history drawn as its matches, gaps as null, to keep assertions short. */
function matchesOf(body: EvalRunsResponse, caseId: string, at = 0) {
  return caseOf(body, caseId, at).history.map(
    (split) => split?.matches ?? null,
  );
}

describe("GET /runs — a case's recent history (#607)", () => {
  test("leaves a run in flight or one that fell over out of every history", async () => {
    await seriesRun(sept(1), { "off-corpus": 5 });
    await seriesRun(
      sept(2),
      { "off-corpus": 0 },
      { status: EVAL_RUN_STATUS.failed },
    );
    await seriesRun(sept(3), { "off-corpus": 4 });
    await seriesRun(
      sept(4),
      { "off-corpus": 1 },
      { status: EVAL_RUN_STATUS.running },
    );

    const body = await runs();

    // The run in flight draws no history of its own, as it draws no metrics.
    expect(caseOf(body, "off-corpus", 0).history).toEqual([]);
    expect(caseOf(body, "off-corpus", 0).fell).toBeNull();
    expect(matchesOf(body, "off-corpus", 1)).toEqual([5, 4]);
  });

  test("never mixes a live run into a frozen history (R4)", async () => {
    await seriesRun(sept(1), { "off-corpus": 5 });
    await seriesRun(sept(2), { "off-corpus": 0 }, { corpus: EVAL_CORPUS.live });
    await seriesRun(sept(3), { "off-corpus": 4 });

    expect(matchesOf(await runs(), "off-corpus")).toEqual([5, 4]);
    expect(matchesOf(await runs(EVAL_CORPUS.live), "off-corpus")).toEqual([0]);
  });

  test("reaches back past the end of the page for the oldest card's history", async () => {
    for (let day = 1; day <= EVAL_RUN_LIMIT + 1; day += 1) {
      await seriesRun(sept(day), { "off-corpus": day === 1 ? 2 : 5 });
    }

    const body = await runs();

    expect(body.runs).toHaveLength(EVAL_RUN_LIMIT);
    expect(matchesOf(body, "off-corpus", -1)).toEqual([2, 5]);
  });
});

describe("GET /runs — the trailing average (#607)", () => {
  function trailingOf(body: EvalRunsResponse, at = 0) {
    return metricOf(body, EVAL_METRIC.declineAccuracy, at).trailing;
  }

  test("leaves a run in flight, one that fell over and a live run out of it", async () => {
    await seriesRun(sept(1), { "off-corpus": 5 });
    await seriesRun(
      sept(2),
      { "off-corpus": 0 },
      { status: EVAL_RUN_STATUS.failed },
    );
    await seriesRun(sept(3), { "off-corpus": 0 }, { corpus: EVAL_CORPUS.live });
    await seriesRun(sept(4), { "off-corpus": 5 });
    await seriesRun(sept(5), { "off-corpus": 5 });
    await seriesRun(
      sept(6),
      { "off-corpus": 0 },
      { status: EVAL_RUN_STATUS.running },
    );

    const body = await runs();

    expect(trailingOf(body, 1)).toEqual({ value: 1, runs: 3 });
  });
});

describe("GET /runs — a case that fell below its own history (#607, #712)", () => {
  test("leaves a run that fell over and a live run out of the runs before", async () => {
    // Read with them, the 0/5s would put the rate at 10 of 20 and 0/5
    // tonight at 3% likely; without them it is 10 of 10.
    await seriesRun(sept(1), { "off-corpus": 5 });
    await seriesRun(
      sept(2),
      { "off-corpus": 0 },
      { status: EVAL_RUN_STATUS.failed },
    );
    await seriesRun(sept(2), { "off-corpus": 0 }, { corpus: EVAL_CORPUS.live });
    await seriesRun(sept(3), { "off-corpus": 5 });
    await seriesRun(sept(4), { "off-corpus": 0 });

    expect(caseOf(await runs(), "off-corpus").fell).toMatchObject({
      matches: 10,
      runs: 2,
    });
  });

  test("reads the oldest card against runs off the end of the page", async () => {
    // The oldest card drawn is day 3, and both runs before it are off the page.
    for (let day = 1; day <= EVAL_RUN_LIMIT + 2; day += 1) {
      await seriesRun(sept(day), { "off-corpus": day === 3 ? 0 : 5 });
    }

    const body = await runs();

    expect(caseOf(body, "off-corpus", -1).fell?.runs).toBe(2);
    expect(caseOf(body, "off-corpus", 0).fell).toBeNull();
  });
});

/* ── One corpus at a time (#234) ─────────────────────────────────────────── */

describe("GET /runs — the corpus filter", () => {
  test("answers the frozen series when the caller names none", async () => {
    // The same reading the start route gives an absent corpus, and for the same
    // reason: a frozen run's numbers move only when the code does, so a live
    // run is a thing to ask for on purpose rather than to get by accident.
    const frozen = await finishedRun({ startedAt: sept(1) });
    await finishedRun({ corpus: EVAL_CORPUS.live, startedAt: sept(2) });

    const body = await runs();

    expect(body.corpus).toBe(EVAL_CORPUS.frozen);
    expect(body.runs.map((r) => r.id)).toEqual([frozen.id]);
  });

  test("answers only the series the caller asked for", async () => {
    // R4 made structural: the two are never averaged, and a list that
    // interleaved them invites reading a red frozen run and a red live run as
    // one trend.
    await finishedRun({ startedAt: sept(1) });
    const live = await finishedRun({
      corpus: EVAL_CORPUS.live,
      startedAt: sept(2),
    });

    const body = await runs(EVAL_CORPUS.live);

    expect(body.corpus).toBe(EVAL_CORPUS.live);
    expect(body.runs.map((r) => r.id)).toEqual([live.id]);
  });

  test("caps the page within the corpus, not across both", async () => {
    // The half that is easy to get wrong. The nightly is frozen, so a cap
    // applied across both series would let twenty nights of them push the whole
    // live series off the page — and the live series would vanish from the
    // screen without anything saying so.
    for (let day = 1; day <= EVAL_RUN_LIMIT; day += 1) {
      await finishedRun({ startedAt: sept(day) });
    }
    const live = await finishedRun({
      corpus: EVAL_CORPUS.live,
      startedAt: sept(1),
    });

    expect((await runs()).runs).toHaveLength(EVAL_RUN_LIMIT);
    expect((await runs(EVAL_CORPUS.live)).runs.map((r) => r.id)).toEqual([
      live.id,
    ]);
  });

  test("refuses a corpus nothing names", async () => {
    // 400 rather than a silent fallback to frozen: a hand-typed `?corpus=fozen`
    // answered with the frozen series would be a page captioned with a corpus
    // nobody asked for.
    const res = await fetch(url("/runs?corpus=fozen"), { headers: ADMIN });

    expect(res.status).toBe(400);
  });

  test("says whether any run exists at all when this series has none", async () => {
    // The one thing a filtered list cannot say about itself, and what separates
    // the two empty states on screen: an admin who has only ever run live must
    // not be told, on load, that the harness has never been used.
    await finishedRun({ corpus: EVAL_CORPUS.live });

    const empty = await runs();

    expect(empty.runs).toEqual([]);
    expect(empty.anyRuns).toBe(true);
  });

  test("says so when there is genuinely nothing anywhere", async () => {
    const body = await runs();

    expect(body.runs).toEqual([]);
    expect(body.anyRuns).toBe(false);
  });
});
