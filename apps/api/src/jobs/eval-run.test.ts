/**
 * Unit tests for `apps/api/src/jobs/eval-run.ts`.
 *
 * The storing half of the eval harness: `EVAL_RUN_WORKER.handle` answering a
 * case and writing what it found, and `onExhausted` closing a run the ladder
 * gave up on. Both are reached as function calls because the spec is exported,
 * which is what makes the terminal path testable at all — it otherwise never
 * runs on a good day (`backend.md`, #154).
 *
 * `../evals/runner` is stubbed, so what is under test is the bookkeeping: the
 * expectations copied onto the row, the idempotency guard, and the event. The
 * translation it stands in for has its own file next to it.
 *
 * The database is real (`../test/pg`, ADR-0014), which is what lets the
 * "delivered twice" test mean something: the guard is a conditional
 * `updateMany`, and a fake client could only report that it was called with the
 * right `where`.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  AUTO_REPLY_DECLINE,
  EVAL_CORPUS,
  EVAL_RUN_STATUS,
  PIPELINE_OUTCOME,
  TICKET_EVENT,
  type TicketEvent,
} from "@ticket/shared";
import { SLICE_ONE_CASE_ID } from "@ticket/core";
import { prisma, resetDb } from "../test/pg";
import { subscribe } from "../events/hub";
import type { EvalCaseOutcome } from "../evals/runner";

/* ── The measuring half, replaced ────────────────────────────────────────── */

let nextOutcome: EvalCaseOutcome = {
  outcome: PIPELINE_OUTCOME.declined,
  decline: AUTO_REPLY_DECLINE.notCovered,
  matched: true,
};

let answered = 0;

// Spread, for the reason the note in `routes/evals.test.ts` records at length:
// a factory that does not spread the real module *is* that module for every
// file that loads it afterwards. Nothing depends on this one today —
// `evals/runner.test.ts` destructures `answerCase` while loading, so it holds
// the real function whatever is registered later — but "nothing depends on it
// today" is how the other one got written, and it cost a red CI run.
const runnerModule = await import("../evals/runner");

mock.module("../evals/runner", () => ({
  ...runnerModule,
  answerCase: async () => {
    answered += 1;
    return nextOutcome;
  },
}));

const { EVAL_RUN_WORKER } = await import("./eval-run");

/* ── Fixtures ────────────────────────────────────────────────────────────── */

async function newRun(): Promise<number> {
  const run = await prisma.evalRun.create({
    data: { corpus: EVAL_CORPUS.frozen },
  });
  return run.id;
}

/** Every event a subscriber heard, and the unsubscribe to call afterwards. */
function collect(): { heard: TicketEvent[]; stop: () => void } {
  const heard: TicketEvent[] = [];
  const stop = subscribe({
    role: "admin",
    send: (event) => heard.push(event),
    close: () => {},
  });
  return { heard, stop };
}

beforeEach(async () => {
  await resetDb();
  answered = 0;
  nextOutcome = {
    outcome: PIPELINE_OUTCOME.declined,
    decline: AUTO_REPLY_DECLINE.notCovered,
    matched: true,
  };
});

/* ── The happy path ──────────────────────────────────────────────────────── */

describe("handle", () => {
  test("writes the case result and closes the run", async () => {
    const runId = await newRun();

    await EVAL_RUN_WORKER.handle({ runId, caseId: SLICE_ONE_CASE_ID });

    const run = await prisma.evalRun.findUniqueOrThrow({
      where: { id: runId },
      include: { results: true },
    });

    expect(run.status).toBe(EVAL_RUN_STATUS.completed);
    expect(run.finishedAt).not.toBeNull();
    expect(run.results).toHaveLength(1);
    expect(run.results[0]).toMatchObject({
      caseId: SLICE_ONE_CASE_ID,
      actualOutcome: PIPELINE_OUTCOME.declined,
      actualDecline: AUTO_REPLY_DECLINE.notCovered,
      matched: true,
    });
  });

  test("copies the expectation onto the row rather than pointing at the case", async () => {
    // The case set is edited by hand, so a run from three weeks ago has to keep
    // saying what *it* was measured against. A row that re-derived its own
    // expectation would silently agree with whatever the file says today, which
    // is the drift a stored result exists to make visible.
    const runId = await newRun();

    await EVAL_RUN_WORKER.handle({ runId, caseId: SLICE_ONE_CASE_ID });

    const result = await prisma.evalCaseResult.findFirstOrThrow({
      where: { runId },
    });
    expect(result.expectedOutcome).toBe(PIPELINE_OUTCOME.declined);
    expect(result.expectedDecline).toBe(AUTO_REPLY_DECLINE.notCovered);
    expect(result.caseName).toBe("Nothing in the corpus covers it");
    expect(result.adversarial).toBe(false);
  });

  test("records a mismatch without failing the run", async () => {
    // A case landing somewhere unexpected is the answer, not an error. A run
    // that went red because a metric moved would be a run nobody could read.
    nextOutcome = {
      outcome: PIPELINE_OUTCOME.resolved,
      decline: null,
      matched: false,
    };
    const runId = await newRun();

    await EVAL_RUN_WORKER.handle({ runId, caseId: SLICE_ONE_CASE_ID });

    const run = await prisma.evalRun.findUniqueOrThrow({
      where: { id: runId },
      include: { results: true },
    });
    expect(run.status).toBe(EVAL_RUN_STATUS.completed);
    expect(run.error).toBeNull();
    expect(run.results[0]?.matched).toBe(false);
  });

  test("announces the finished run", async () => {
    const { heard, stop } = collect();
    const runId = await newRun();

    try {
      await EVAL_RUN_WORKER.handle({ runId, caseId: SLICE_ONE_CASE_ID });
    } finally {
      stop();
    }

    expect(heard).toEqual([
      {
        kind: TICKET_EVENT.eval_run_changed,
        runId,
        at: expect.any(String),
      },
    ]);
  });
});

/* ── At-least-once delivery ──────────────────────────────────────────────── */

describe("a job delivered twice", () => {
  test("finishes the run once and writes one result", async () => {
    const runId = await newRun();

    await EVAL_RUN_WORKER.handle({ runId, caseId: SLICE_ONE_CASE_ID });
    await EVAL_RUN_WORKER.handle({ runId, caseId: SLICE_ONE_CASE_ID });

    expect(await prisma.evalCaseResult.count({ where: { runId } })).toBe(1);
  });

  test("does not pay for a second model call", async () => {
    // The re-read is above the call, not below it: an eval is the one feature
    // whose whole cost is model calls, and a duplicate delivery that answers
    // the case again before discovering it has nothing to write is a bill.
    const runId = await newRun();

    await EVAL_RUN_WORKER.handle({ runId, caseId: SLICE_ONE_CASE_ID });
    await EVAL_RUN_WORKER.handle({ runId, caseId: SLICE_ONE_CASE_ID });

    expect(answered).toBe(1);
  });

  test("a run that has vanished is not an error", async () => {
    // A row deleted between the last attempt and this delivery must not fail
    // the job and send it round the ladder again.
    await expect(
      EVAL_RUN_WORKER.handle({ runId: 9999, caseId: SLICE_ONE_CASE_ID }),
    ).resolves.toBeUndefined();
  });
});

/* ── The terminal path ───────────────────────────────────────────────────── */

describe("onExhausted", () => {
  test("closes the run as failed and says so on the row", async () => {
    // Otherwise a run sits at "running" forever on a page whose whole job is
    // saying what happened — indistinguishable from a job still in flight.
    const runId = await newRun();

    await EVAL_RUN_WORKER.onExhausted({ runId, caseId: SLICE_ONE_CASE_ID });

    const run = await prisma.evalRun.findUniqueOrThrow({
      where: { id: runId },
    });
    expect(run.status).toBe(EVAL_RUN_STATUS.failed);
    expect(run.finishedAt).not.toBeNull();
    expect(run.error).toBeTruthy();
  });

  test("leaves a run that already finished alone", async () => {
    const runId = await newRun();
    await EVAL_RUN_WORKER.handle({ runId, caseId: SLICE_ONE_CASE_ID });

    await EVAL_RUN_WORKER.onExhausted({ runId, caseId: SLICE_ONE_CASE_ID });

    const run = await prisma.evalRun.findUniqueOrThrow({
      where: { id: runId },
    });
    expect(run.status).toBe(EVAL_RUN_STATUS.completed);
  });
});

/* ── An id nothing names ─────────────────────────────────────────────────── */

test("a case id the set does not carry fails the run rather than the job", async () => {
  // The case set is code and the id on the job is a string that outlived a
  // rename. Retrying cannot help, so this settles the run instead of climbing
  // the ladder to say the same thing five times.
  const runId = await newRun();

  await EVAL_RUN_WORKER.handle({ runId, caseId: "no-such-case" });

  const run = await prisma.evalRun.findUniqueOrThrow({ where: { id: runId } });
  expect(run.status).toBe(EVAL_RUN_STATUS.failed);
  expect(run.error).toContain("no-such-case");
  expect(answered).toBe(0);
});
