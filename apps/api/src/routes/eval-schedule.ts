import { Router } from "express";
import type { Request, Response } from "express";
import { fromPrisma } from "pg-boss";
import {
  EVAL_MISSED_PLAN_WINDOW_HOURS,
  EVAL_PLAN_HORIZON_DAYS,
  EVAL_PLANNED_RUN_GRACE_MINUTES,
  EVAL_PLANNED_RUN_LIMIT,
  EVAL_PLANNED_RUN_STATUS,
  type EvalCorpus,
  type EvalPlannedRunRow,
  type EvalPlannedRunStatus,
  type EvalScheduleResponse,
  type EvalScheduleRow,
} from "@ticket/shared";
import { evalScheduleSchema, planEvalRunSchema } from "@ticket/core";
import { prisma } from "../db";
import { EVAL_SCHEDULE_DEFAULT, EVAL_SCHEDULE_ID } from "../evals/schedule";
import { applyEvalSchedule } from "../evals/schedule-queue";
import {
  cancelPlannedRunJob,
  enqueuePlannedRun,
} from "../jobs/eval-planned-run";
import { requireAdmin, sessionOf } from "../middleware/auth";
import type { EvalsConfig } from "./evals";

/**
 * When eval runs happen: the standing schedule, and the runs planned for a
 * particular afternoon (#236).
 *
 * **Two halves of one panel, and they are different things on purpose.** The
 * schedule fires forever, is frozen-corpus only, and is paused rather than
 * deleted. A planned run fires once, may name either corpus, and is cancelled
 * rather than paused. `CONTEXT.md` carries both verbs with the object each one
 * takes, because the failure mode here is a confirmation dialog rather than a
 * type error — one verb across the two is how an admin comes to believe that
 * pausing the schedule stops tonight's run. It does not. **Nothing stops a run
 * already in flight**: a run that has started runs to completion
 * (`docs/adr/0021`), and there is no control here or anywhere that ends one.
 *
 * **A router of its own rather than four more handlers on `./evals`.** That
 * file is the read model for what a run measured — nine projection functions
 * over stored verdicts — and this one writes two small tables and talks to the
 * queue. They share a mount path and nothing else; splitting them also keeps
 * each test file on the specifiers it actually needs, which is the narrow-seam
 * rule this repo keeps for measured reasons (testing-api.md).
 *
 * **Admin only, on every route**, matching the rest of the harness: a planned
 * run spends money, and retiming the schedule decides when the deployment
 * spends it. `AdminRoute` on the client is UX; these guards are the control.
 */

/** The row shape the panel reads a schedule as. */
function scheduleRowOf(row: {
  hour: number;
  minute: number;
  paused: boolean;
  updatedAt: Date;
  updatedByName: string | null;
}): EvalScheduleRow {
  return {
    hour: row.hour,
    minute: row.minute,
    paused: row.paused,
    updatedAt: row.updatedAt.toISOString(),
    updatedByName: row.updatedByName,
  };
}

/**
 * The row shape the panel reads a planned run as.
 *
 * Typed on the enums rather than on `string`, so nothing here casts: Prisma's
 * generated enums are the same string unions `@ticket/shared` declares, and a
 * widened parameter is what would force a cast that a later divergence could
 * then hide.
 */
function plannedRowOf(row: {
  id: number;
  corpus: EvalCorpus;
  runAt: Date;
  status: EvalPlannedRunStatus;
  plannedByName: string | null;
  runId: number | null;
}): EvalPlannedRunRow {
  return {
    id: row.id,
    corpus: row.corpus,
    runAt: row.runAt.toISOString(),
    status: row.status,
    plannedByName: row.plannedByName,
    runId: row.runId,
  };
}

/**
 * What is coming, and what recently did not happen.
 *
 * `planned` is the list's reason to exist. `missed` is here for a day
 * afterwards because it is the only way an admin learns that the run they
 * expected this morning did not start — a row that simply vanished would read
 * as a plan that fired. Cancelled plans are absent: that is a decision already
 * taken. Fired plans are absent too, because what they became is a run, and the
 * runs list above draws those.
 *
 * **It marks an overdue plan missed before reading**, and that write in a read
 * path is deliberate. `jobs/eval-planned-run.ts` marks a plan missed when its
 * job is *delivered* late — but a job that never arrives at all (a queue reset,
 * a deployment that lost its key, a job swept away) leaves nothing to deliver,
 * and the row would sit `planned` with a date in the past forever, drawn as
 * "Upcoming" on a panel whose whole job is saying what is coming. It is the
 * pairing `recoverStuck` is: a claim and the thing that undoes it are one
 * design, not two. A sweep would be the other shape, and it would be a
 * scheduled queue whose entire body is this one `updateMany` — so the read that
 * would notice does it instead, idempotently, in the same statement shape the
 * worker uses.
 */
async function plannedRuns(): Promise<EvalPlannedRunRow[]> {
  const since = new Date(
    Date.now() - EVAL_MISSED_PLAN_WINDOW_HOURS * 60 * 60 * 1000,
  );

  await prisma.evalPlannedRun.updateMany({
    where: {
      status: EVAL_PLANNED_RUN_STATUS.planned,
      runAt: {
        lt: new Date(Date.now() - EVAL_PLANNED_RUN_GRACE_MINUTES * 60 * 1000),
      },
    },
    data: { status: EVAL_PLANNED_RUN_STATUS.missed },
  });

  const rows = await prisma.evalPlannedRun.findMany({
    where: {
      OR: [
        { status: EVAL_PLANNED_RUN_STATUS.planned },
        { status: EVAL_PLANNED_RUN_STATUS.missed, runAt: { gte: since } },
      ],
    },
    orderBy: [{ runAt: "asc" }, { id: "asc" }],
    take: EVAL_PLANNED_RUN_LIMIT,
    select: {
      id: true,
      corpus: true,
      runAt: true,
      status: true,
      plannedByName: true,
      runId: true,
    },
  });

  return rows.map(plannedRowOf);
}

export function createEvalScheduleRouter(config: EvalsConfig): Router {
  const router = Router();

  /** The arrangement in force, and what is coming. */
  router.get(
    "/schedule",
    requireAdmin,
    async (_req: Request, res: Response<EvalScheduleResponse>) => {
      const stored = await prisma.evalSchedule.findUnique({
        where: { id: EVAL_SCHEDULE_ID },
        select: {
          hour: true,
          minute: true,
          paused: true,
          updatedAt: true,
          updatedByName: true,
        },
      });

      res.json({
        evalConfigured: config.evalConfigured(),
        // The seeded row is what a migrated database has, so the second branch
        // is one a deployment reaches only after somebody deleted it by hand —
        // and the honest answer there is the time the sweep is actually
        // keeping, which is the constant the boot path falls back to as well.
        // Read off `EVAL_SCHEDULE_DEFAULT` rather than through
        // `readEvalSchedule()`, which would re-query the row this handler has
        // already read, on every request, to answer a question it can only ask
        // when that row is absent.
        schedule: stored
          ? scheduleRowOf(stored)
          : {
              ...EVAL_SCHEDULE_DEFAULT,
              updatedAt: new Date(0).toISOString(),
              updatedByName: null,
            },
        plannedRuns: await plannedRuns(),
      });
    },
  );

  /**
   * Retime the schedule, or pause and resume it.
   *
   * **One write path for both**, because pausing keeps the time: "pause" and
   * "retime" are two edits to one arrangement, and two routes would leave a
   * window where the row and the queue disagreed about which of them happened
   * last.
   *
   * The row is written first and the queue told afterwards. That order is the
   * recoverable one: a stored time the queue has not heard about yet is put
   * right by the next boot, which reads this row rather than the constant,
   * whereas a queue retimed against a row that failed to write would keep a
   * time nothing records.
   */
  router.patch(
    "/schedule",
    requireAdmin,
    async (
      req: Request,
      res: Response<EvalScheduleRow | { error: string }>,
    ) => {
      const parsed = evalScheduleSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }

      const { user } = sessionOf(res);
      const values = parsed.data;

      const row = await prisma.evalSchedule.upsert({
        where: { id: EVAL_SCHEDULE_ID },
        create: {
          id: EVAL_SCHEDULE_ID,
          ...values,
          updatedById: user.id,
          updatedByName: user.name,
        },
        update: { ...values, updatedById: user.id, updatedByName: user.name },
        select: {
          hour: true,
          minute: true,
          paused: true,
          updatedAt: true,
          updatedByName: true,
        },
      });

      // Skipped where there is no key, and not because it would be wasteful:
      // `jobs/index.ts` does not register the nightly at all on a keyless
      // deployment, so there is no queue to put a cron on and pg-boss would
      // answer with an error about a queue that does not exist. The row is
      // still the record, and the boot that follows a key being added reads it.
      if (config.evalConfigured()) {
        await applyEvalSchedule(values);
      }

      res.json(scheduleRowOf(row));
    },
  );

  /**
   * Plan one run for a future time.
   *
   * **Either corpus**, unlike the schedule. The objection to unattended live
   * runs is about a red result appearing in a trend nobody chose to start; a
   * named person picking Live for a specific afternoon has chosen it.
   *
   * **No guard against planning a run close to another.** The run worker takes
   * one at a time, so a second simply waits its turn, and "two runs a few
   * minutes apart" is a fair description of what happened. What *is* bounded is
   * how far ahead — see `EVAL_PLAN_HORIZON_DAYS`, where the ceiling is the
   * queue's own retention rather than a product opinion.
   *
   * The row and its deferred job commit together, the pairing every enqueue in
   * this codebase keeps: a row with no job would sit `planned` forever, and a
   * job with no row would fire into nothing.
   */
  router.post(
    "/planned-runs",
    requireAdmin,
    async (
      req: Request,
      res: Response<EvalPlannedRunRow | { error: string }>,
    ) => {
      // Before the row, so a keyless deployment never accumulates plans that
      // read as coming and can never be answered. ADR-0003: one provider, one
      // key, and unset is a supported state the whole app degrades the same way.
      if (!config.evalConfigured()) {
        res.status(503).json({
          error: "No AI provider is configured, so an eval cannot run.",
        });
        return;
      }

      const parsed = planEvalRunSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? "Invalid request",
        });
        return;
      }

      const { corpus, runAt } = parsed.data;
      const horizon = Date.now() + EVAL_PLAN_HORIZON_DAYS * 24 * 60 * 60 * 1000;
      if (runAt.getTime() > horizon) {
        res.status(400).json({
          error: `A run can be planned at most ${EVAL_PLAN_HORIZON_DAYS} days ahead.`,
        });
        return;
      }

      const { user } = sessionOf(res);

      const row = await prisma.$transaction(async (tx) => {
        const created = await tx.evalPlannedRun.create({
          data: {
            corpus,
            runAt,
            plannedById: user.id,
            plannedByName: user.name,
          },
          select: { id: true },
        });

        // The id is kept because cancelling has to release the job: a row that
        // said cancelled while the queue still held its job would open a run at
        // the planned time anyway.
        const jobId = await enqueuePlannedRun(
          created.id,
          runAt,
          fromPrisma(tx),
        );

        return await tx.evalPlannedRun.update({
          where: { id: created.id },
          data: { jobId },
          select: {
            id: true,
            corpus: true,
            runAt: true,
            status: true,
            plannedByName: true,
            runId: true,
          },
        });
      });

      // 201 rather than 202: unlike a run, what was created here *is* the whole
      // of what was asked for. Nothing is in flight yet, which is the entire
      // difference between a plan and a run.
      res.status(201).json(plannedRowOf(row));
    },
  );

  /**
   * Cancel a planned run.
   *
   * **This is also how re-timing works** — cancel and plan again, never an
   * in-place edit. One write path, one queued job, and no window where the row
   * and the queue disagree about when it fires.
   *
   * The row is flipped first, conditionally on still being `planned`, so two
   * admins clicking at once means the second matches nothing and answers 404
   * rather than cancelling twice. Releasing the job comes after and is the
   * belt to that braces: the handler re-reads the row and does nothing unless
   * it is still `planned`, so a cancel the queue never heard about costs a
   * delivery and not a run.
   */
  router.delete(
    "/planned-runs/:id",
    requireAdmin,
    async (req: Request, res: Response<{ ok: true } | { error: string }>) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }

      const plan = await prisma.evalPlannedRun.findUnique({
        where: { id },
        select: { jobId: true },
      });

      const { count } = await prisma.evalPlannedRun.updateMany({
        where: { id, status: EVAL_PLANNED_RUN_STATUS.planned },
        data: { status: EVAL_PLANNED_RUN_STATUS.cancelled },
      });

      if (count === 0) {
        res.status(404).json({ error: "No planned run to cancel" });
        return;
      }

      if (plan?.jobId) {
        await cancelPlannedRunJob(plan.jobId);
      }

      res.json({ ok: true });
    },
  );

  return router;
}
