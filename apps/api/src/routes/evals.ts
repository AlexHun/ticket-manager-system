import { Router } from "express";
import type { Request, Response } from "express";
import { fromPrisma } from "pg-boss";
import {
  asAutoReplyDecline,
  EVAL_CORPUS,
  EVAL_RUN_LIMIT,
  PIPELINE_OUTCOME,
  type EvalCaseResultRow,
  type EvalReachedRow,
  type EvalRunRow,
  type EvalRunsResponse,
  type EvalRunStartedResponse,
  type PipelineOutcome,
} from "@ticket/shared";
import { autoReplyCaseById, startEvalRunSchema } from "@ticket/core";
import { prisma } from "../db";
import { isEvalConfigured } from "../evals/config";
import { publishEvalRunChanged } from "../events/ticket-events";
import {
  ALL_EVAL_CASE_IDS,
  enqueueEvalRun,
  EVAL_REPEATS,
} from "../jobs/eval-run";
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
 * The write half creates a row and returns. It does **not** wait for the run: a
 * full set is ~175 model calls and several minutes, so an admin holding an HTTP
 * connection open for it is a request a proxy closes and a page that cannot say
 * what is happening. The row and the job are written in one transaction so they
 * share a fate (the pattern `ingest.ts` uses to enqueue classification), and the
 * run fills in over `/api/events` as each case finishes.
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
function asPipelineOutcome(value: unknown): PipelineOutcome {
  return (
    Object.values(PIPELINE_OUTCOME).find((outcome) => outcome === value) ??
    PIPELINE_OUTCOME.notOffered
  );
}

/**
 * The five repeats, collapsed into the distinct places the case landed.
 *
 * Five identical rows say one thing and take five lines to say it; the
 * interesting case is the one that went two different ways, and what a reader
 * needs then is *which* way and how often. Sorted by count, so the first entry
 * is what the case usually does.
 *
 * Reads the stored `verdicts` array defensively — it is `Json`, so Postgres
 * makes no promise about its shape, and a row written by an older build (or by
 * the backfill in this slice's migration) is a shape this code did not write.
 * Anything unreadable becomes `notOffered`, the same way an unknown decline
 * becomes null, rather than throwing on a page whose whole job is to say what
 * happened.
 */
function reachedFrom(verdicts: unknown): EvalReachedRow[] {
  const rows = new Map<string, EvalReachedRow>();

  for (const entry of Array.isArray(verdicts) ? verdicts : []) {
    const verdict = entry as {
      outcome?: unknown;
      decline?: unknown;
      matched?: unknown;
    };
    const outcome = asPipelineOutcome(verdict.outcome);
    const decline = asAutoReplyDecline(
      typeof verdict.decline === "string" ? verdict.decline : null,
    );
    const key = `${outcome}:${decline ?? ""}`;

    const existing = rows.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    rows.set(key, {
      outcome,
      decline,
      count: 1,
      matched: verdict.matched === true,
    });
  }

  return [...rows.values()].sort((a, b) => b.count - a.count);
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

    const corpus = parsed.data.corpus ?? EVAL_CORPUS.frozen;

    // Ids are resolved *here* rather than in the worker's schema, because the
    // case set is data in `@ticket/core` and a schema that imported it would
    // make every consumer of any schema in that package carry it. A bad id is
    // the caller's mistake and is worth a 400 rather than a run that fails
    // several minutes later with nothing to show.
    const caseIds = parsed.data.caseIds ?? ALL_EVAL_CASE_IDS;
    const unknown = caseIds.filter((id) => autoReplyCaseById(id) === null);
    if (unknown.length > 0) {
      res.status(400).json({ error: `No such case: ${unknown.join(", ")}` });
      return;
    }

    const run = await prisma.$transaction(async (tx) => {
      const created = await tx.evalRun.create({
        data: {
          corpus,
          // Stamped on the row rather than left to be assumed from the constant
          // this build happens to carry: a rate read months later means nothing
          // without the denominator it was taken over.
          repeats: EVAL_REPEATS,
        },
        select: { id: true },
      });
      // Inside the transaction, through the same connection, so the row and the
      // job commit together. A job with no row would find nothing to write to;
      // a row with no job would sit at "running" forever.
      await enqueueEvalRun(created.id, corpus, caseIds, fromPrisma(tx));
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
 * Results come back nested rather than through a second request: a run is
 * ~35 rows, which is a page either way, and the screen shows the run and its
 * cases as one thing.
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
        repeats: run.repeats,
        attempts: run.attempts,
        matches: run.matches,
        abandoned: run.abandoned,
        usd: run.usd,
        cachedRepeats: run.cachedRepeats,
        // One repeat per case is what warms the cache and can never be a hit,
        // so the denominator is not `attempts`. Derived from the rows that exist
        // rather than from `cases × (repeats - 1)`, so a run still filling in
        // reports the fraction it has actually measured.
        cacheable: run.results.reduce(
          (total, result) => total + Math.max(result.repeats - 1, 0),
          0,
        ),
        results: run.results.map((result): EvalCaseResultRow => ({
          id: result.id,
          caseId: result.caseId,
          caseName: result.caseName,
          adversarial: result.adversarial,
          expectedOutcome: asPipelineOutcome(result.expectedOutcome),
          expectedDecline: asAutoReplyDecline(result.expectedDecline),
          repeats: result.repeats,
          matches: result.matches,
          abandoned: result.abandoned,
          usd: result.usd,
          cachedRepeats: result.cachedRepeats,
          reached: reachedFrom(result.verdicts),
        })),
      })),
    });
  },
);
