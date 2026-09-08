import { Router } from "express";
import type { Request, Response } from "express";
import { fromPrisma } from "pg-boss";
import {
  asAutoReplyDecline,
  EVAL_CORPUS,
  EVAL_RUN_LIMIT,
  PIPELINE_OUTCOME,
  type EvalCaseResultRow,
  type EvalRunRow,
  type EvalRunsResponse,
  type EvalRunStartedResponse,
  type PipelineOutcome,
} from "@ticket/shared";
import {
  autoReplyCaseById,
  SLICE_ONE_CASE_ID,
  startEvalRunSchema,
} from "@ticket/core";
import { prisma } from "../db";
import { isEvalConfigured } from "../evals/config";
import { publishEvalRunChanged } from "../events/ticket-events";
import { enqueueEvalRun } from "../jobs/eval-run";
import { requireAdmin } from "../middleware/auth";

/**
 * The eval harness, started and read back.
 *
 * **Admin only, on every route** (PRD R6), and this one is not a judgement call
 * about tidiness: a run spends money, and its results say how well the
 * unattended path is holding — which is the shape of the system's own defences,
 * not an agent's business. `AdminRoute` on the client is UX; these two guards
 * are the control.
 *
 * The write half creates a row and returns. It does **not** wait for the run:
 * one case is a 30-second model call and slice 2's full set is minutes, so an
 * admin holding an HTTP connection open for it is a request a proxy closes and
 * a page that cannot say what is happening. The row and the job are written in
 * one transaction so they share a fate (the pattern `ingest.ts` uses to enqueue
 * classification), and the finished verdict arrives over `/api/events`.
 *
 * Nothing here reads or writes a ticket, a message, an activity row or the
 * outbox. That is not restraint, it is the shape of the thing (R12): the runner
 * hands a synthesized input straight to `autoReply`, which cannot reach those
 * tables. `eval_run` and `eval_case_result` are the only rows a run writes.
 */

export const evalsRouter = Router();

/**
 * A stored outcome, narrowed to one this build has wording for.
 *
 * The mirror of `asAutoReplyDecline` for the other pair of text columns, and it
 * exists for the same reason: they are plain text (see the note on
 * `EvalCaseResult`), so the type on the wire is a promise this route keeps
 * rather than one Postgres keeps for it.
 *
 * `notOffered` is the fallback rather than null, because an outcome is not
 * nullable on the wire and "nothing is scheduled and nothing happened" is the
 * honest reading of a value this build cannot name — the same choice
 * `/pipeline` makes for its one known blind spot.
 */
function asPipelineOutcome(value: string): PipelineOutcome {
  return (
    Object.values(PIPELINE_OUTCOME).find((outcome) => outcome === value) ??
    PIPELINE_OUTCOME.notOffered
  );
}

/**
 * Start a run.
 *
 * 202 rather than 201: the run has been accepted, and it has not happened yet.
 * A client that read a 201 as "created and done" would draw an empty run as a
 * finished one, which is the single most misleading thing this page could say.
 */
evalsRouter.post(
  "/runs",
  requireAdmin,
  async (
    req: Request,
    res: Response<EvalRunStartedResponse | { error: string }>,
  ) => {
    // Before the row, so a deployment with no key never accumulates runs that
    // read as in flight and can never be answered. ADR-0003: one provider, one
    // key, and unset is a supported state the whole app degrades the same way.
    if (!isEvalConfigured()) {
      res.status(503).json({
        error: "No AI provider is configured, so an eval cannot run.",
      });
      return;
    }

    const parsed = startEvalRunSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }

    // Slice 1 answers one case. The id is resolved *here* rather than in the
    // worker's schema, because the case set is data in `@ticket/core` and a
    // schema that imported it would make every consumer of any schema in that
    // package carry it. A bad id is the caller's mistake and is worth a 400
    // rather than a run that fails a minute later.
    const caseId = parsed.data.caseId ?? SLICE_ONE_CASE_ID;
    if (!autoReplyCaseById(caseId)) {
      res.status(400).json({ error: `No such case: ${caseId}` });
      return;
    }

    const run = await prisma.$transaction(async (tx) => {
      const created = await tx.evalRun.create({
        // Frozen, always, in slice 1 — but written rather than defaulted, so
        // the column is meaningful from the first row and the live option is a
        // parameter rather than a migration (R4).
        data: { corpus: EVAL_CORPUS.frozen },
        select: { id: true },
      });
      // Inside the transaction, through the same connection, so the row and the
      // job commit together. A job with no row would find nothing to write to;
      // a row with no job would sit at "running" forever.
      await enqueueEvalRun(created.id, caseId, fromPrisma(tx));
      return created;
    });

    // After the commit, never inside it (ADR-0015). This is what puts the new
    // run on an admin's screen without a reload.
    publishEvalRunChanged(run.id);

    res.status(202).json({ runId: run.id });
  },
);

/**
 * Every run, newest first, with the cases each one answered.
 *
 * Results come back nested rather than through a second request: a run in slice
 * 1 has one case and in slice 2 has thirty, which is a page of rows either way,
 * and the screen shows the run and its cases as one thing.
 */
evalsRouter.get(
  "/runs",
  requireAdmin,
  async (_req: Request, res: Response<EvalRunsResponse>) => {
    const runs = await prisma.evalRun.findMany({
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take: EVAL_RUN_LIMIT,
      include: { results: { orderBy: { id: "asc" } } },
    });

    res.json({
      // A presence boolean, never the value or a prefix of it — the rule the
      // pipeline config block keeps. It is what lets the page say "no key"
      // rather than drawing a Run button that always fails.
      evalConfigured: isEvalConfigured(),
      runs: runs.map((run): EvalRunRow => ({
        id: run.id,
        corpus: run.corpus,
        status: run.status,
        startedAt: run.startedAt.toISOString(),
        finishedAt: run.finishedAt?.toISOString() ?? null,
        error: run.error,
        results: run.results.map((result): EvalCaseResultRow => ({
          id: result.id,
          caseId: result.caseId,
          caseName: result.caseName,
          adversarial: result.adversarial,
          expectedOutcome: asPipelineOutcome(result.expectedOutcome),
          expectedDecline: asAutoReplyDecline(result.expectedDecline),
          actualOutcome: asPipelineOutcome(result.actualOutcome),
          actualDecline: asAutoReplyDecline(result.actualDecline),
          matched: result.matched,
        })),
      })),
    });
  },
);
