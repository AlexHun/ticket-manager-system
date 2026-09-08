/**
 * Unit tests for `apps/api/src/routes/evals.ts`.
 *
 * The router only, on a real Express app over a real database (`../test/pg`,
 * ADR-0014). Three things it is responsible for and nothing else can be: the
 * run row exists before the response returns, the request does not block on the
 * run, and a deployment with no key refuses instead of queueing work that will
 * never be done.
 *
 * Two seams, and each is deliberately a specifier nothing else in this suite
 * owns. `../evals/config` is the one-line guard `isEvalConfigured()` exists for
 * — reading `../ai/provider` directly here would put a second *stateful* stub
 * on a specifier `jobs/sweeps.test.ts` already owns, and the registry keeps one
 * of two (testing.md, #174). `../jobs/eval-run` stands in for the enqueue,
 * because `getBoss()` throws with no queue running — and it is mocked rather
 * than `../jobs/boss`, which `jobs/sweeps.test.ts` owns under a path that
 * resolves to the same module.
 */

import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  EVAL_CORPUS,
  EVAL_RUN_STATUS,
  PIPELINE_OUTCOME,
  type EvalRunsResponse,
  type EvalRunStartedResponse,
} from "@ticket/shared";
import { SLICE_ONE_CASE_ID } from "@ticket/core";
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

let enqueued: { runId: number; caseId: string }[] = [];
mock.module("../jobs/eval-run", () => ({
  enqueueEvalRun: async (runId: number, caseId: string) => {
    enqueued.push({ runId, caseId });
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
    // exists. Slice 1 only ever writes `frozen`.
    expect(run.corpus).toBe(EVAL_CORPUS.frozen);
  });

  test("enqueues the run it just recorded", async () => {
    const res = await post();
    const body = (await res.json()) as EvalRunStartedResponse;

    expect(enqueued).toEqual([
      { runId: body.runId, caseId: SLICE_ONE_CASE_ID },
    ]);
  });

  test("takes the case to run from the body", async () => {
    const res = await post({ caseId: "planted-link" });

    expect(res.status).toBe(202);
    expect(enqueued[0]?.caseId).toBe("planted-link");
  });

  test("refuses a case id nothing names, and records no run", async () => {
    const res = await post({ caseId: "no-such-case" });

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
        results: {
          create: {
            caseId: SLICE_ONE_CASE_ID,
            caseName: "Nothing in the corpus covers it",
            adversarial: false,
            expectedOutcome: PIPELINE_OUTCOME.declined,
            expectedDecline: "notCovered",
            actualOutcome: PIPELINE_OUTCOME.declined,
            actualDecline: "notCovered",
            matched: true,
          },
        },
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
      caseId: SLICE_ONE_CASE_ID,
      expectedDecline: "notCovered",
      actualDecline: "notCovered",
      matched: true,
    });
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
          create: {
            caseId: "x",
            caseName: "x",
            adversarial: false,
            expectedOutcome: PIPELINE_OUTCOME.declined,
            expectedDecline: "somethingFromTheFuture",
            actualOutcome: "alsoFromTheFuture",
            actualDecline: null,
            matched: false,
          },
        },
      },
    });

    const res = await fetch(url("/runs"));
    const body = (await res.json()) as EvalRunsResponse;

    expect(body.runs[0]?.results[0]?.expectedDecline).toBeNull();
    // An outcome is not nullable on the wire, so an unrecognised one falls back
    // to the honest "nothing is scheduled and nothing happened".
    expect(body.runs[0]?.results[0]?.actualOutcome).toBe(
      PIPELINE_OUTCOME.notOffered,
    );
  });
});
