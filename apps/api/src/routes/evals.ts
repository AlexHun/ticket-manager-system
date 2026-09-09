import { Router } from "express";
import type { Request, Response } from "express";
import {
  asAutoReplyDecline,
  EVAL_CORPUS,
  EVAL_METRIC,
  EVAL_RUN_LIMIT,
  EVAL_RUN_STATUS,
  EVAL_THRESHOLD,
  isOutputCheckDecline,
  PIPELINE_OUTCOME,
  type AutoReplyDecline,
  type EvalCaseResultRow,
  type EvalCheckRow,
  type EvalMetric,
  type EvalMetricRow,
  type EvalReachedRow,
  type EvalRunRow,
  type EvalRunsResponse,
  type EvalRunStartedResponse,
  type PipelineOutcome,
} from "@ticket/shared";
import { autoReplyCaseById, startEvalRunSchema } from "@ticket/core";
import { prisma } from "../db";
import { isEvalConfigured } from "../evals/config";
import { startEvalRun } from "../evals/start-run";
import { ALL_EVAL_CASE_IDS } from "../jobs/eval-run";
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
 * One metric, judged against what this run recorded (R8).
 *
 * `denominator === 0` gives a null value rather than a zero or a one, and that
 * is the whole reason this returns a shape instead of a number. The catch rate
 * over a run where the model planted no payload is **unmeasured**, and the two
 * wrong readings pull in opposite directions: zero would light up as a
 * catastrophe on a healthy desk, and one would draw a perfect score as evidence
 * the safety checks work when nothing ever tested them. `meets` is true for it,
 * because a metric with no measurement cannot fall below anything — and the
 * page prints the denominator beside every figure so the difference is legible.
 */
function metricRow(
  metric: EvalMetric,
  numerator: number,
  denominator: number,
  thresholds: Record<string, number>,
): EvalMetricRow {
  // A run that recorded no threshold for this metric is judged by the constant
  // this build carries. That is every row written before the column existed, and
  // it is the only honest reading of an absent key — the alternative is a zero
  // that reads as a bar nothing could fail.
  const threshold = thresholds[metric] ?? EVAL_THRESHOLD[metric];
  const value = denominator === 0 ? null : numerator / denominator;

  return {
    metric,
    value,
    numerator,
    denominator,
    threshold,
    meets: value === null || value >= threshold,
  };
}

/**
 * The thresholds a run was judged against, read back defensively.
 *
 * `Json`, so Postgres promises nothing about the shape, and the column carries
 * `{}` on every row written before it existed. Anything unreadable falls
 * through to this build's constants in `metricRow` above.
 */
function thresholdsFrom(value: unknown): Record<string, number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, number] => typeof entry[1] === "number",
    ),
  );
}

/**
 * Which of the two output checks caught each payload, most frequent first (R9).
 *
 * Read out of the stored `verdicts` rather than off a column, because it is the
 * one thing a per-case total cannot say: `caught: 3` says the checks held three
 * times and not *which* comparison did the holding — which is precisely the
 * distinction the 7-of-9 and 10-of-10 measurements drew, and the thing worth
 * knowing before anybody proposes relaxing one of them.
 *
 * Only repeats flagged `caught` are counted, so a payload declined for some
 * other reason — the model refusing to answer at all — cannot inflate a check's
 * tally with a decline that read no reply.
 */
function checksFrom(results: { verdicts: unknown }[]): EvalCheckRow[] {
  const counts = new Map<AutoReplyDecline, number>();

  for (const result of results) {
    for (const entry of Array.isArray(result.verdicts) ? result.verdicts : []) {
      const verdict = entry as { decline?: unknown; caught?: unknown };
      if (verdict.caught !== true) continue;

      const decline = asAutoReplyDecline(
        typeof verdict.decline === "string" ? verdict.decline : null,
      );
      // A build that has no wording for the reason cannot label a bar with it,
      // and an unlabelled bar in a safety breakdown is worse than a missing one.
      if (decline === null || !isOutputCheckDecline(decline)) continue;

      counts.set(decline, (counts.get(decline) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([decline, count]): EvalCheckRow => ({ decline, count }))
    .sort((a, b) => b.count - a.count);
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

    // The row, the job and the event, in the one order that works — see
    // `../evals/start-run`, which the nightly sweep opens its runs through too.
    // The four decisions in there are the ones that go quietly out of step when
    // two callers each write them out.
    const runId = await startEvalRun(corpus, caseIds);

    res.status(202).json({ runId });
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
      runs: runs.map((run): EvalRunRow => {
        const thresholds = thresholdsFrom(run.thresholds);
        // Only on a run that has closed. A rate over the third of the set that
        // has finished is not a smaller version of the answer, it is a
        // different number — and a threshold applied to one would go red on a
        // run that is merely young. Empty is what the page draws nothing from.
        const metrics =
          run.status === EVAL_RUN_STATUS.running
            ? []
            : [
                // The catch rate first, because it is the one ADR-0004 stands
                // on and the only one whose failure is a defect.
                metricRow(
                  EVAL_METRIC.catchRate,
                  run.caught,
                  run.caught + run.escaped,
                  thresholds,
                ),
                metricRow(
                  EVAL_METRIC.declineAccuracy,
                  run.matches,
                  run.attempts,
                  thresholds,
                ),
              ];

        return {
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
          caught: run.caught,
          escaped: run.escaped,
          checks: checksFrom(run.results),
          metrics,
          // Marked failing, shown failing, and nothing else happens (R8, R11):
          // no issue, no notification, and nothing that could turn a pull request
          // red. A slow statistical suite wired to a gate is a suite somebody
          // switches off, which is the failure this is written to avoid.
          failing: metrics.some((metric) => !metric.meets),
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
            caught: result.caught,
            escaped: result.escaped,
            reached: reachedFrom(result.verdicts),
          })),
        };
      }),
    });
  },
);
