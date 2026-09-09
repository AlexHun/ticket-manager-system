/**
 * Unit tests for `apps/api/src/jobs/eval-nightly.ts`.
 *
 * The clock's half of the harness (PRD R13). What the sweep is responsible for
 * is small and entirely about *which* run it opens — the frozen corpus, the
 * whole set — and it is worth a test for the reason `sweeps.test.ts` gives for
 * the other four: what a scheduled job does is invisible in production until
 * the day it has quietly been doing the wrong thing for a month.
 *
 * `run` is reached as a plain function call because the spec is a value
 * (`backend.md`, #158). Nothing here waits for a cron, and no queue is started.
 *
 * **`../evals/start-run` is the seam.** Opening a run is a row, a job and an
 * event in one order, and that arrangement is asserted where it lives, against
 * a real database, in `routes/evals.test.ts` — restating it here would be this
 * file failing for the router's reasons. What is left is the only thing this
 * module decides.
 *
 * **The stub delegates to the real module until a test asks it not to**, which
 * is the `jobs/sweeps.test.ts` arrangement and is not optional here. It is not
 * a specifier this file owns alone: `routes/evals.ts` reaches the same module,
 * and `mock.module`'s registry is one process wide with nothing resetting it
 * between files — so a factory that unconditionally recorded instead of running
 * would take the router's own front door away in whichever load order put this
 * file first. Measured, not guessed: it took six of that file's tests red on
 * the first run of the whole suite, and green on its own. A fake whose default
 * is indistinguishable from the real module cannot make the ordering matter.
 */

import { beforeEach, expect, mock, test } from "bun:test";
import { EVAL_CORPUS, type EvalCorpus } from "@ticket/shared";
import { AUTO_REPLY_CASES } from "@ticket/core";

let started: { corpus: EvalCorpus; caseIds: string[] }[] = [];
/** Set by `watchRuns()` for one test, cleared in `beforeEach`. */
let watching = false;

// Spread into a plain object *now*, before the mock is registered: `mock.module`
// replaces the live namespace, so a factory that spreads the import binding is
// spreading itself.
const startRunModule = { ...(await import("../evals/start-run")) };

mock.module("../evals/start-run", () => ({
  ...startRunModule,
  startEvalRun: async (corpus: EvalCorpus, caseIds: string[]) => {
    if (!watching) return startRunModule.startEvalRun(corpus, caseIds);

    started.push({ corpus, caseIds });
    return started.length;
  },
}));

const { EVAL_NIGHTLY_SWEEP } = await import("./eval-nightly");

/** Record what the sweep opens, instead of writing a row and enqueueing it. */
function watchRuns(): void {
  watching = true;
}

beforeEach(() => {
  started = [];
  watching = false;
});

test("opens one run a night against the frozen corpus", async () => {
  // Frozen and never live (R13, R4). A live run's numbers move when an admin
  // edits an article, so an unattended trend line built on one would drift for
  // reasons no diff explains — and the whole value of a nightly is that a move
  // in it means the *code* moved.
  watchRuns();
  await EVAL_NIGHTLY_SWEEP.run();

  expect(started).toHaveLength(1);
  expect(started[0]?.corpus).toBe(EVAL_CORPUS.frozen);
});

test("answers the whole set, not a subset", async () => {
  // The pinned-subset option exists for the E2E suite and for an admin
  // re-running the one case that moved. A nightly that quietly answered a
  // subset would produce rates that are not comparable with the run before it,
  // which is the one thing a stored series has to be.
  watchRuns();
  await EVAL_NIGHTLY_SWEEP.run();

  expect(started[0]?.caseIds).toEqual(AUTO_REPLY_CASES.map((c) => c.id));
});

test("is a spec, so a tick is a function call and the cron is readable", () => {
  // The property #158 bought, and the reason every sweep here has a test at
  // all: before the specs were values these were closures handed straight to
  // `boss.work`, reachable only by standing up a queue and waiting.
  expect(EVAL_NIGHTLY_SWEEP.name).toBe("eval-nightly");
  // Once a day at a fixed hour, not `@daily` and not every few hours: a run
  // costs real money against a real provider, and the trend line is read a day
  // at a time.
  expect(EVAL_NIGHTLY_SWEEP.cron.split(" ")).toHaveLength(5);
  expect(EVAL_NIGHTLY_SWEEP.cron).not.toContain("*/");
});
