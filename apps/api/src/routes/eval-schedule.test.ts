/**
 * Unit tests for `apps/api/src/routes/eval-schedule.ts`.
 *
 * The router only, on a real Express app over a real database (`../test/pg`,
 * ADR-0014) — which is what makes the assertions worth making here: every claim
 * below is about a row, a status transition or a conditional write, and those
 * are Postgres' answers rather than a fake's.
 *
 * **Two seams, and each one exists because the alternative was measured.**
 *
 * `../evals/schedule-queue` is the narrow module the route re-asserts the cron
 * through. Replacing it outright is safe precisely because nothing else reaches
 * that specifier — which is the whole reason it is a module (`docs/adr/0016`).
 * A route that imported `../jobs/boss` instead would put this file on a
 * specifier `jobs/sweeps.test.ts` already owns with a *stateful* stub, and the
 * process-wide registry keeps one of two.
 *
 * `../jobs/eval-planned-run` is shared with `jobs/eval-planned-run.test.ts`, so
 * its factory **spreads the real module** and replaces only the two functions
 * that would reach `getBoss()` — `EVAL_PLANNED_RUN_WORKER` stays real, and that
 * file keeps its subject. The snapshot is taken eagerly, above the
 * registration, or the factory spreads itself.
 *
 * The `../middleware/auth` stub is deliberately the same shape as
 * `evals.test.ts`'s and `tutorials.test.ts`'s, for the reason in their headers.
 */

import type { NextFunction, Request, Response } from "express";
import { beforeEach, expect, mock, test } from "bun:test";
import {
  EVAL_CORPUS,
  EVAL_PLAN_HORIZON_DAYS,
  EVAL_PLANNED_RUN_STATUS,
  type EvalPlannedRunRow,
  type EvalScheduleResponse,
  type EvalScheduleRow,
} from "@ticket/shared";
import { prisma, resetDb } from "../test/pg";
import { COLLEAGUE, seedColleagues } from "../test/fixtures";
import { serveRouter } from "../test/route-app";
import type { EvalScheduleTime } from "../evals/schedule";

/* ── The world behind the router ─────────────────────────────────────────── */

const fakeGuard = (req: Request, res: Response, next: NextFunction) => {
  res.locals.session = {
    user: {
      id: req.header("x-test-user") ?? COLLEAGUE.admin.id,
      name: req.header("x-test-user-name") ?? COLLEAGUE.admin.name,
      email: req.header("x-test-user-email") ?? COLLEAGUE.admin.email,
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

let applied: EvalScheduleTime[] = [];
mock.module("../evals/schedule-queue", () => ({
  applyEvalSchedule: async (schedule: EvalScheduleTime) => {
    applied.push(schedule);
  },
}));

const plannedRunModule = {
  ...(await import("../jobs/eval-planned-run")),
};

let enqueued: { plannedRunId: number; runAt: Date }[] = [];
let cancelledJobs: string[] = [];
mock.module("../jobs/eval-planned-run", () => ({
  ...plannedRunModule,
  enqueuePlannedRun: async (plannedRunId: number, runAt: Date) => {
    enqueued.push({ plannedRunId, runAt });
    return `job-${plannedRunId}`;
  },
  cancelPlannedRunJob: async (jobId: string) => {
    cancelledJobs.push(jobId);
  },
}));

// A thunk rather than a boolean captured at construction, for the reason
// `evals.test.ts` measured: `serveRouter` mounts once for the whole file, so a
// frozen boolean would answer the same thing for every test in it.
let configured = true;
const config = { evalConfigured: () => configured };

const { createEvalScheduleRouter } = await import("./eval-schedule");

const url = serveRouter("/api/evals", createEvalScheduleRouter(config));

const ADMIN = {
  "content-type": "application/json",
  "x-test-user": COLLEAGUE.admin.id,
  "x-test-user-name": COLLEAGUE.admin.name,
};

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

beforeEach(async () => {
  await resetDb();
  await seedColleagues("admin");
  configured = true;
  applied = [];
  enqueued = [];
  cancelledJobs = [];
});

/** The whole panel, as the page asks for it. */
async function getPanel(): Promise<EvalScheduleResponse> {
  const res = await fetch(url("/schedule"), { headers: ADMIN });
  expect(res.status).toBe(200);
  return (await res.json()) as EvalScheduleResponse;
}

async function patchSchedule(body: unknown): Promise<globalThis.Response> {
  return await fetch(url("/schedule"), {
    method: "PATCH",
    headers: ADMIN,
    body: JSON.stringify(body),
  });
}

async function planRun(body: unknown): Promise<globalThis.Response> {
  return await fetch(url("/planned-runs"), {
    method: "POST",
    headers: ADMIN,
    body: JSON.stringify(body),
  });
}

/* ── The schedule ────────────────────────────────────────────────────────── */

test("reads the stored schedule and who last changed it", async () => {
  await prisma.evalSchedule.create({
    data: {
      id: 1,
      hour: 5,
      minute: 15,
      paused: true,
      updatedById: COLLEAGUE.admin.id,
      updatedByName: COLLEAGUE.admin.name,
    },
  });

  const panel = await getPanel();

  expect(panel.schedule.hour).toBe(5);
  expect(panel.schedule.minute).toBe(15);
  expect(panel.schedule.paused).toBe(true);
  // The panel says who and when, which is the difference between a setting and
  // an arrangement somebody owns.
  expect(panel.schedule.updatedByName).toBe(COLLEAGUE.admin.name);
});

test("falls back to the time the sweep keeps when no row exists", async () => {
  // `resetDb` empties the table the migration seeded, which is the same state a
  // deployment reaches if somebody deletes the row: the honest answer is the
  // time the sweep is actually keeping, not a blank panel.
  const panel = await getPanel();

  expect(panel.schedule.hour).toBe(3);
  expect(panel.schedule.minute).toBe(47);
  expect(panel.schedule.paused).toBe(false);
  expect(panel.schedule.updatedByName).toBeNull();
});

test("retiming stores the time and tells the queue", async () => {
  const res = await patchSchedule({ hour: 5, minute: 15, paused: false });
  expect(res.status).toBe(200);
  const row = (await res.json()) as EvalScheduleRow;
  expect(row.hour).toBe(5);

  const stored = await prisma.evalSchedule.findUniqueOrThrow({
    where: { id: 1 },
  });
  expect(stored.minute).toBe(15);
  // Who changed it, on the row rather than only in a log line.
  expect(stored.updatedById).toBe(COLLEAGUE.admin.id);
  expect(stored.updatedByName).toBe(COLLEAGUE.admin.name);

  // And it takes effect without a deploy, which is the whole point of the
  // ticket: the row is the record and the queue is told the moment it changes.
  expect(applied).toEqual([{ hour: 5, minute: 15, paused: false }]);
});

test("pausing keeps the time and takes the sweep off the clock", async () => {
  await patchSchedule({ hour: 5, minute: 15, paused: false });
  applied = [];

  const res = await patchSchedule({ hour: 5, minute: 15, paused: true });
  expect(res.status).toBe(200);

  const stored = await prisma.evalSchedule.findUniqueOrThrow({
    where: { id: 1 },
  });
  // There is no delete: an arrangement that is off is still the arrangement,
  // and resuming it must not need somebody to remember what it used to say.
  expect(stored.hour).toBe(5);
  expect(stored.minute).toBe(15);
  expect(stored.paused).toBe(true);
  expect(applied).toEqual([{ hour: 5, minute: 15, paused: true }]);
});

test("refuses a time that is not one", async () => {
  const res = await patchSchedule({ hour: 24, minute: 15, paused: false });

  expect(res.status).toBe(400);
  expect(await prisma.evalSchedule.count()).toBe(0);
  expect(applied).toEqual([]);
});

test("stores the schedule on a keyless deployment without touching the queue", async () => {
  // `jobs/index.ts` does not register the nightly at all without a key, so
  // there is no queue to put a cron on — pg-boss would answer with an error
  // about a queue that does not exist. The row is still the record, and the
  // boot that follows a key being added reads it.
  configured = false;

  const res = await patchSchedule({ hour: 6, minute: 0, paused: false });

  expect(res.status).toBe(200);
  expect(
    (await prisma.evalSchedule.findUniqueOrThrow({ where: { id: 1 } })).hour,
  ).toBe(6);
  expect(applied).toEqual([]);
});

/* ── Planned runs ────────────────────────────────────────────────────────── */

test("plans a run at a future time, against either corpus", async () => {
  const runAt = new Date(Date.now() + 2 * 60 * MINUTE);

  const res = await planRun({ corpus: EVAL_CORPUS.live, runAt });
  // 201, not 202: unlike a run, what was created here *is* the whole of what
  // was asked for — nothing is in flight yet.
  expect(res.status).toBe(201);
  const row = (await res.json()) as EvalPlannedRunRow;
  expect(row.corpus).toBe(EVAL_CORPUS.live);
  expect(row.status).toBe(EVAL_PLANNED_RUN_STATUS.planned);
  expect(row.plannedByName).toBe(COLLEAGUE.admin.name);
  // Not a run: it has measured nothing, so it names none (`docs/adr/0021`).
  expect(row.runId).toBeNull();

  const stored = await prisma.evalPlannedRun.findUniqueOrThrow({
    where: { id: row.id },
  });
  expect(stored.plannedById).toBe(COLLEAGUE.admin.id);
  // The job id is kept because cancelling has to release the job: a row saying
  // cancelled while the queue still held its job would open a run anyway.
  expect(stored.jobId).toBe(`job-${row.id}`);
  expect(enqueued).toHaveLength(1);
  expect(enqueued[0]?.runAt.getTime()).toBe(runAt.getTime());
});

test("refuses a plan for a moment that has passed", async () => {
  const res = await planRun({
    corpus: EVAL_CORPUS.frozen,
    runAt: new Date(Date.now() - MINUTE),
  });

  expect(res.status).toBe(400);
  expect(await prisma.evalPlannedRun.count()).toBe(0);
  expect(enqueued).toEqual([]);
});

test("refuses a plan further ahead than the queue would keep it", async () => {
  // The ceiling is pg-boss's own retention, not a product opinion: a deferred
  // job sits in the `created` state and a queue deletes one after 14 days, so a
  // plan three weeks out would sit `planned` forever with nothing coming.
  const res = await planRun({
    corpus: EVAL_CORPUS.frozen,
    runAt: new Date(Date.now() + (EVAL_PLAN_HORIZON_DAYS + 1) * DAY),
  });

  expect(res.status).toBe(400);
  expect(await prisma.evalPlannedRun.count()).toBe(0);
});

test("a keyless deployment cannot plan a run", async () => {
  configured = false;

  const res = await planRun({
    corpus: EVAL_CORPUS.frozen,
    runAt: new Date(Date.now() + 60 * MINUTE),
  });

  expect(res.status).toBe(503);
  // Before the row, so nothing accumulates plans that read as coming and can
  // never be answered.
  expect(await prisma.evalPlannedRun.count()).toBe(0);
});

test("plans two runs a few minutes apart without complaint", async () => {
  // Deliberately unguarded: the run worker takes one at a time, so a second
  // simply waits its turn, and "two runs a few minutes apart" is a fair
  // description of what happened.
  const first = await planRun({
    corpus: EVAL_CORPUS.frozen,
    runAt: new Date(Date.now() + 30 * MINUTE),
  });
  const second = await planRun({
    corpus: EVAL_CORPUS.frozen,
    runAt: new Date(Date.now() + 32 * MINUTE),
  });

  expect(first.status).toBe(201);
  expect(second.status).toBe(201);
  expect(enqueued).toHaveLength(2);
});

test("lists what is coming, soonest first, and never a run", async () => {
  const later = await planRun({
    corpus: EVAL_CORPUS.frozen,
    runAt: new Date(Date.now() + 3 * 60 * MINUTE),
  });
  const sooner = await planRun({
    corpus: EVAL_CORPUS.live,
    runAt: new Date(Date.now() + 60 * MINUTE),
  });

  const panel = await getPanel();

  expect(panel.plannedRuns.map((row) => row.id)).toEqual([
    ((await sooner.json()) as EvalPlannedRunRow).id,
    ((await later.json()) as EvalPlannedRunRow).id,
  ]);
});

test("keeps a recently missed plan in the list and drops the rest", async () => {
  // A missed plan is the only way an admin learns the run they expected did not
  // start; a row that vanished would read as one that fired. Cancelled and
  // fired plans are absent — one is a decision already taken, and what the
  // other became is a run, which the runs list draws.
  const common = { corpus: EVAL_CORPUS.frozen, plannedByName: "Ada Admin" };
  await prisma.evalPlannedRun.createMany({
    data: [
      {
        ...common,
        runAt: new Date(Date.now() - 60 * MINUTE),
        status: EVAL_PLANNED_RUN_STATUS.missed,
      },
      {
        ...common,
        runAt: new Date(Date.now() - 40 * DAY),
        status: EVAL_PLANNED_RUN_STATUS.missed,
      },
      {
        ...common,
        runAt: new Date(Date.now() + 60 * MINUTE),
        status: EVAL_PLANNED_RUN_STATUS.cancelled,
      },
      {
        ...common,
        runAt: new Date(Date.now() - 10 * MINUTE),
        status: EVAL_PLANNED_RUN_STATUS.fired,
      },
    ],
  });

  const panel = await getPanel();

  expect(panel.plannedRuns).toHaveLength(1);
  expect(panel.plannedRuns[0]?.status).toBe(EVAL_PLANNED_RUN_STATUS.missed);
});

test("an overdue plan nothing came for is marked missed on the way out", async () => {
  // The worker marks a plan missed when its job is *delivered* late. A job that
  // never arrives at all — a queue reset, a deployment that lost its key —
  // leaves nothing to deliver, and without this the row would sit `planned`
  // with a date in the past forever, drawn as "Upcoming" on a panel whose whole
  // job is saying what is coming.
  const { id } = await prisma.evalPlannedRun.create({
    data: {
      corpus: EVAL_CORPUS.frozen,
      runAt: new Date(Date.now() - 6 * 60 * MINUTE),
      plannedByName: COLLEAGUE.admin.name,
    },
    select: { id: true },
  });

  const panel = await getPanel();

  expect(panel.plannedRuns[0]?.id).toBe(id);
  expect(panel.plannedRuns[0]?.status).toBe(EVAL_PLANNED_RUN_STATUS.missed);
  // Written, not merely rendered: the next reader and the worker have to agree
  // with the panel about what became of this plan.
  expect(
    (await prisma.evalPlannedRun.findUniqueOrThrow({ where: { id } })).status,
  ).toBe(EVAL_PLANNED_RUN_STATUS.missed);
});

test("a plan still inside its grace window is left alone", async () => {
  // The window is what absorbs an ordinary restart, and a panel loaded during
  // one must not be the thing that decides the run is not happening.
  const { id } = await prisma.evalPlannedRun.create({
    data: {
      corpus: EVAL_CORPUS.frozen,
      runAt: new Date(Date.now() - MINUTE),
      plannedByName: COLLEAGUE.admin.name,
    },
    select: { id: true },
  });

  const panel = await getPanel();

  expect(panel.plannedRuns[0]?.status).toBe(EVAL_PLANNED_RUN_STATUS.planned);
  expect(
    (await prisma.evalPlannedRun.findUniqueOrThrow({ where: { id } })).status,
  ).toBe(EVAL_PLANNED_RUN_STATUS.planned);
});

test("cancelling a plan releases its queued job", async () => {
  const created = (await (
    await planRun({
      corpus: EVAL_CORPUS.frozen,
      runAt: new Date(Date.now() + 60 * MINUTE),
    })
  ).json()) as EvalPlannedRunRow;

  const res = await fetch(url(`/planned-runs/${created.id}`), {
    method: "DELETE",
    headers: ADMIN,
  });

  expect(res.status).toBe(200);
  expect(
    (
      await prisma.evalPlannedRun.findUniqueOrThrow({
        where: { id: created.id },
      })
    ).status,
  ).toBe(EVAL_PLANNED_RUN_STATUS.cancelled);
  // Both halves, or the queue would open a run at the planned time regardless.
  expect(cancelledJobs).toEqual([`job-${created.id}`]);

  // And it is gone from what is coming — it never becomes a run.
  expect((await getPanel()).plannedRuns).toEqual([]);
});

test("a second cancel matches nothing", async () => {
  // The flip is conditional on still being `planned`, so two admins clicking at
  // once means the second cancels nothing rather than cancelling twice.
  const created = (await (
    await planRun({
      corpus: EVAL_CORPUS.frozen,
      runAt: new Date(Date.now() + 60 * MINUTE),
    })
  ).json()) as EvalPlannedRunRow;

  const path = `/planned-runs/${created.id}`;
  const first = await fetch(url(path), { method: "DELETE", headers: ADMIN });
  const second = await fetch(url(path), { method: "DELETE", headers: ADMIN });

  expect(first.status).toBe(200);
  expect(second.status).toBe(404);
  expect(cancelledJobs).toHaveLength(1);
});

test("a plan that already fired cannot be cancelled", async () => {
  // There is no verb for ending a run in flight, because there is no such act
  // (`docs/adr/0021`). A plan that fired has become a run, and a cancel aimed
  // at it must not read as one.
  const { id } = await prisma.evalPlannedRun.create({
    data: {
      corpus: EVAL_CORPUS.frozen,
      runAt: new Date(Date.now() - MINUTE),
      status: EVAL_PLANNED_RUN_STATUS.fired,
    },
    select: { id: true },
  });

  const res = await fetch(url(`/planned-runs/${id}`), {
    method: "DELETE",
    headers: ADMIN,
  });

  expect(res.status).toBe(404);
  expect(cancelledJobs).toEqual([]);
});

test("refuses a planned-run id that is not one", async () => {
  const res = await fetch(url("/planned-runs/nonsense"), {
    method: "DELETE",
    headers: ADMIN,
  });

  expect(res.status).toBe(400);
});
