/**
 * Unit tests for `apps/api/src/jobs/eval-planned-run.ts`.
 *
 * The moment a plan stops being one (#236), and the two ways it never gets
 * there. What this worker decides is small and entirely about *whether* to open
 * a run — a cancelled plan opens nothing, a late one opens nothing and says so,
 * and a duplicate delivery opens nothing twice — and every one of those is
 * invisible in production until the afternoon it went the other way.
 *
 * `handle` and `onExhausted` are reached as plain function calls because the
 * spec is a value (`backend.md`, #158). Nothing here waits for a queue.
 *
 * **`../evals/start-run` is the seam**, and the stub **delegates to the real
 * module until a test asks it not to** — the arrangement `jobs/eval-nightly.ts`
 * and `jobs/sweeps.ts` both keep, and it is not optional. Three files reach
 * that specifier and `mock.module`'s registry is one process wide with nothing
 * resetting it between them, so a factory that unconditionally recorded would
 * take `routes/evals.ts`'s own front door away in whichever load order put this
 * file first. A fake whose default is indistinguishable from the real module
 * cannot make the ordering matter.
 *
 * What is deliberately *not* asserted here is the row-job-event order inside
 * `startEvalRun`. That arrangement is asserted where it lives, against a real
 * database, in `routes/evals.test.ts`; restating it would be this file failing
 * for the router's reasons.
 */

import { beforeEach, expect, mock, test } from "bun:test";
import {
  EVAL_CORPUS,
  EVAL_PLANNED_RUN_GRACE_MINUTES,
  EVAL_PLANNED_RUN_STATUS,
  type EvalCorpus,
} from "@ticket/shared";
import { AUTO_REPLY_CASES } from "@ticket/core";
import { prisma, resetDb } from "../test/pg";

let started: { corpus: EvalCorpus; caseIds: string[] }[] = [];
/** Set by `watchRuns()` for one test, cleared in `beforeEach`. */
let watching = false;
/** The ids the stub handed back, so a test can assert what was linked. */
let startedRunIds: number[] = [];

// Spread into a plain object *now*, before the mock is registered: `mock.module`
// replaces the live namespace, so a factory that spreads the import binding is
// spreading itself.
const startRunModule = { ...(await import("../evals/start-run")) };

mock.module("../evals/start-run", () => ({
  ...startRunModule,
  startEvalRun: async (corpus: EvalCorpus, caseIds: string[]) => {
    if (!watching) return startRunModule.startEvalRun(corpus, caseIds);

    started.push({ corpus, caseIds });
    // A real row, not an invented id: `EvalPlannedRun.runId` is a foreign key
    // onto `eval_run`, so a stub answering with a number nothing names would
    // fail the link this file is here to assert — which is itself something a
    // hand-written client could not have told us (ADR-0014).
    const { id } = await prisma.evalRun.create({
      data: { corpus, repeats: 1 },
      select: { id: true },
    });
    startedRunIds.push(id);
    return id;
  },
}));

const { EVAL_PLANNED_RUN_WORKER } = await import("./eval-planned-run");

/** Record what the worker opens, instead of writing a row and enqueueing it. */
function watchRuns(): void {
  watching = true;
}

const MINUTE = 60 * 1000;

/** A plan due `dueInMs` from now — negative for one whose time has passed. */
async function seedPlan(
  dueInMs: number,
  overrides: {
    corpus?: EvalCorpus;
    status?: (typeof EVAL_PLANNED_RUN_STATUS)[keyof typeof EVAL_PLANNED_RUN_STATUS];
  } = {},
): Promise<number> {
  const { id } = await prisma.evalPlannedRun.create({
    data: {
      corpus: overrides.corpus ?? EVAL_CORPUS.live,
      runAt: new Date(Date.now() + dueInMs),
      status: overrides.status ?? EVAL_PLANNED_RUN_STATUS.planned,
      plannedByName: "Ada Admin",
    },
    select: { id: true },
  });
  return id;
}

/** The whole row, as the assertions below want to read it. */
async function planById(id: number) {
  return await prisma.evalPlannedRun.findUniqueOrThrow({ where: { id } });
}

beforeEach(async () => {
  started = [];
  startedRunIds = [];
  watching = false;
  await resetDb();
});

test("a plan whose time has come opens a run and is linked to it", async () => {
  watchRuns();
  const id = await seedPlan(-MINUTE, { corpus: EVAL_CORPUS.live });

  await EVAL_PLANNED_RUN_WORKER.handle({ plannedRunId: id });

  // Either corpus, unlike the standing schedule. The objection to unattended
  // live runs is about a red result appearing in a trend nobody chose to start,
  // and a named person picking Live for a specific afternoon has chosen it.
  expect(started).toEqual([
    { corpus: EVAL_CORPUS.live, caseIds: AUTO_REPLY_CASES.map((c) => c.id) },
  ]);

  const plan = await planById(id);
  expect(plan.status).toBe(EVAL_PLANNED_RUN_STATUS.fired);
  // Written after the run exists rather than before, so a plan naming a run id
  // is a plan whose run is on the page.
  expect(plan.runId).toBe(startedRunIds[0]!);
});

test("a cancelled plan opens nothing, even when its job arrives", async () => {
  // Cancelling flips the row and then releases the queued job, in that order —
  // so a delivery that was already in flight is the ordinary case rather than
  // an edge one, and this is what makes that ordering safe.
  watchRuns();
  const id = await seedPlan(-MINUTE, {
    status: EVAL_PLANNED_RUN_STATUS.cancelled,
  });

  await EVAL_PLANNED_RUN_WORKER.handle({ plannedRunId: id });

  expect(started).toEqual([]);
  expect((await planById(id)).status).toBe(EVAL_PLANNED_RUN_STATUS.cancelled);
});

test("a delivery that arrives twice opens one run", async () => {
  // Delivery is at-least-once, and a run is ~175 calls against a real provider.
  // The claim is a conditional `updateMany` off `planned`, so the second
  // arrival matches nothing and pays for nothing.
  watchRuns();
  const id = await seedPlan(-MINUTE);

  await EVAL_PLANNED_RUN_WORKER.handle({ plannedRunId: id });
  await EVAL_PLANNED_RUN_WORKER.handle({ plannedRunId: id });

  expect(started).toHaveLength(1);
});

test("a plan late but inside the grace window still fires", async () => {
  // A restart or an overrunning deploy is exactly what the window is for: a run
  // that fires a few minutes late is still recognisably the run somebody asked
  // for.
  watchRuns();
  const id = await seedPlan(-(EVAL_PLANNED_RUN_GRACE_MINUTES - 1) * MINUTE);

  await EVAL_PLANNED_RUN_WORKER.handle({ plannedRunId: id });

  expect(started).toHaveLength(1);
  expect((await planById(id)).status).toBe(EVAL_PLANNED_RUN_STATUS.fired);
});

test("a plan past its grace window is missed and starts nothing", async () => {
  // The app was down, or a deploy overran by hours. Firing then would charge
  // for a full set at a moment nobody chose and stamp a trend point whose date
  // means nothing — so it spends nothing, and the row says why.
  watchRuns();
  const id = await seedPlan(-(EVAL_PLANNED_RUN_GRACE_MINUTES + 1) * MINUTE);

  await EVAL_PLANNED_RUN_WORKER.handle({ plannedRunId: id });

  expect(started).toEqual([]);
  const plan = await planById(id);
  expect(plan.status).toBe(EVAL_PLANNED_RUN_STATUS.missed);
  expect(plan.runId).toBeNull();
});

test("a firing that exhausts its retries leaves the plan missed", async () => {
  // The terminal path, which otherwise never runs on a good day. `planned`
  // would be a row promising a run that nothing is coming to open — missed is
  // the true statement, and the one the panel can draw.
  const id = await seedPlan(MINUTE);

  await EVAL_PLANNED_RUN_WORKER.onExhausted({ plannedRunId: id });

  expect((await planById(id)).status).toBe(EVAL_PLANNED_RUN_STATUS.missed);
});

test("a plan that already fired is left alone by an exhaustion", async () => {
  // `updateMany` off `planned` again: an exhaustion arriving after a late
  // success must not overwrite a plan that did open a run.
  const id = await seedPlan(-MINUTE, {
    status: EVAL_PLANNED_RUN_STATUS.fired,
  });

  await EVAL_PLANNED_RUN_WORKER.onExhausted({ plannedRunId: id });

  expect((await planById(id)).status).toBe(EVAL_PLANNED_RUN_STATUS.fired);
});

test("is a spec, so both halves are function calls", () => {
  expect(EVAL_PLANNED_RUN_WORKER.name).toBe("eval-planned-run");
  // One at a time, which is not the ceiling it looks like: this handler writes
  // two rows and hands the expensive part to `EVAL_RUN_QUEUE`, whose own
  // concurrency of one is what actually serialises a run.
  expect(EVAL_PLANNED_RUN_WORKER.concurrency).toBe(1);
});
