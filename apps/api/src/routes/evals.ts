import { Router } from "express";
import type { Request, Response } from "express";
import {
  EVAL_CORPUS,
  EVAL_CORPUS_DEFAULT,
  EVAL_HEALTH,
  EVAL_HISTORY_RUNS,
  EVAL_RUN_LIMIT,
  EVAL_RUN_STATUS,
  type EvalCorpus,
  type EvalRunRow,
  type EvalRunsResponse,
  type EvalRunStatus,
  type EvalRunStartedResponse,
  type EvalStatusResponse,
} from "@ticket/shared";
import {
  autoReplyCaseById,
  evalRunsQuerySchema,
  startEvalRunSchema,
} from "@ticket/core";
import { prisma } from "../db";
import { isRunFailing, readRun, type SeriesRun } from "../evals/read-run";
import { startEvalRun } from "../evals/start-run";
import { ALL_EVAL_CASE_IDS } from "../jobs/eval-run";
import { requireAdmin, requireAdminView } from "../middleware/auth";

/**
 * The eval harness, started and read back.
 *
 * **Admin only** (PRD R6), and this one is not a judgement call about
 * tidiness: a run spends money, and its results say how well the unattended
 * path is holding — which is the shape of the system's own defences, not an
 * agent's business. Starting a run is `requireAdmin`; reading them back is
 * `requireAdminView`, which a demo session also passes (#320, R15).
 * `AdminScreenRoute` on the client is UX; these two guards are the control.
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
 *
 * **Reading a run is not this file's** (#750). The read half queries and
 * serialises; what a run's numbers mean — its metrics against its stamped
 * thresholds, its window of earlier runs, its breakdowns, and whether it is
 * failing — is `../evals/read-run.ts`, through its two entry points. The run
 * list and `GET /status` both take the failing verdict from `isRunFailing`, so
 * the card's badge and the sidebar's mark cannot disagree.
 */

/**
 * What this router is told about its deployment, rather than asks a module.
 *
 * A **function**, not a `boolean`, and that is forced rather than stylistic:
 * the router is built once at mount, so a boolean captured at construction
 * freezes for the life of the app — measured, it takes `evals.test.ts` from
 * 34 pass / 0 fail to 32 pass / 2 fail, which are the two tests the guard
 * exists for. A field read per request would do too, but it would put a
 * mutable field on the app's configuration surface; a thunk keeps the object
 * frozen and still answers per call.
 *
 * Worth naming what that leaves: `() => boolean` **is** `isAiConfigured`'s own
 * type, so `src/index.ts` passes that function itself. The value threaded here
 * is the same function the guard module would have re-exported — what changed
 * is where it is bound, an argument instead of an import, and nothing else.
 */
export interface EvalsConfig {
  /**
   * Whether this deployment can run an eval at all — one key behind every AI
   * feature (ADR-0003).
   *
   * `AUTO_REPLY_ENABLED` is deliberately **not** folded in. That switch stops
   * the desk answering real customers; an eval answers a synthesized input and
   * writes to nobody, so a deployment that has turned the feature off is
   * precisely one where measuring it still makes sense — it is how you find out
   * whether it is safe to turn back on. The key is the only gate.
   */
  evalConfigured: () => boolean;
}

/** What a run needs to be compared against — no results, no prose, no Json. */
const COMPARISON_COLUMNS = {
  id: true,
  startedAt: true,
  caught: true,
  escaped: true,
  matches: true,
  attempts: true,
  classifyMatches: true,
  classifiedRepeats: true,
} as const;

/** What a series run is read with — counters and splits, no verdicts, no Json. */
const SERIES_COLUMNS = {
  ...COMPARISON_COLUMNS,
  results: {
    select: { caseId: true, matches: true, repeats: true, abandoned: true },
  },
} as const;

/**
 * Every completed run of this corpus that a run on the page is read against
 * (R14, #607): the page's own completed runs and the `EVAL_HISTORY_RUNS - 1`
 * before the oldest of them. Which of them make each run's window is
 * `readRun`'s to decide.
 *
 * Two conditions here, and each one rules out a comparison that would be worse
 * than none. **Same corpus**, because frozen and live are two series (R4) and a
 * delta or an average across them measures an admin's article edits and calls
 * it a prompt regression; kept by the query, so nothing downstream has to
 * re-check a row's series. **Completed**, because a run still filling in holds
 * a fraction of the set and a rate over a fraction is a different number, not
 * a smaller one — so a run in flight or one that fell over is never read
 * against.
 *
 * **One query whatever the history holds**, rather than one per card, and it
 * is there because a series outgrows the page: once it is longer than
 * `EVAL_RUN_LIMIT`, the oldest card drawn has its predecessor and the rest of
 * its window off the end of the page.
 */
async function seriesOf(
  corpus: EvalCorpus,
  page: (SeriesRun & { status: EvalRunStatus })[],
): Promise<SeriesRun[]> {
  const completed = page.filter(
    (run) => run.status === EVAL_RUN_STATUS.completed,
  );
  const oldest = completed.at(-1);
  if (!oldest) return [];

  const older = await prisma.evalRun.findMany({
    where: {
      corpus,
      status: EVAL_RUN_STATUS.completed,
      OR: [
        { startedAt: { lt: oldest.startedAt } },
        { startedAt: oldest.startedAt, id: { lt: oldest.id } },
      ],
    },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    take: EVAL_HISTORY_RUNS - 1,
    select: SERIES_COLUMNS,
  });

  return [...completed, ...older];
}

/**
 * Build the router, handed the one thing about the deployment it has to know.
 *
 * A factory rather than a module-level `const`, because the answer arrives as
 * a value now — see `EvalsConfig` above and `src/index.ts`, which is where it
 * is read off `isAiConfigured()`.
 */
export function createEvalsRouter(config: EvalsConfig): Router {
  const router = Router();

  /**
   * Start a run.
   *
   * 202 rather than 201: the run has been accepted, and it has not happened yet.
   * A client that read a 201 as "created and done" would draw an empty run as a
   * finished one, which is the single most misleading thing this page could say.
   */
  router.post(
    "/runs",
    requireAdmin,
    async (
      req: Request,
      res: Response<EvalRunStartedResponse | { error: string }>,
    ) => {
      // Before the row, so a deployment with no key never accumulates runs that
      // read as in flight and can never be answered. ADR-0003: one provider, one
      // key, and unset is a supported state the whole app degrades the same way.
      if (!config.evalConfigured()) {
        res.status(503).json({
          error: "Couldn't start the run — no AI provider is configured.",
        });
        return;
      }

      const parsed = startEvalRunSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }

      const corpus = parsed.data.corpus ?? EVAL_CORPUS_DEFAULT;

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
   * One corpus's runs, newest first, with the cases each one answered (#234).
   *
   * **One series at a time, and never both.** Frozen and live are two series
   * that are never averaged (R4), and a list that interleaved them invited
   * exactly the reading the harness exists to prevent — a red frozen run and a
   * red live run stacked in one column read as one trend, when the first is a
   * prompt regression and the second might be an admin rewording an article.
   * So the corpus is a filter here, the same value the caller's next `POST`
   * carries, and there is no way to ask for both.
   *
   * The cap follows the filter, which is the half that is easy to get wrong:
   * `take` applies to the filtered query, so it counts within the series, and
   * twenty nightly frozen runs can no longer push the live series off the page.
   *
   * Results come back nested rather than through a second request: a run is
   * ~35 rows, which is a page either way, and the screen shows the run and its
   * cases as one thing.
   */
  router.get(
    "/runs",
    requireAdminView,
    async (
      req: Request,
      res: Response<EvalRunsResponse | { error: string }>,
    ) => {
      const parsed = evalRunsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }

      const corpus = parsed.data.corpus ?? EVAL_CORPUS_DEFAULT;

      const runs = await prisma.evalRun.findMany({
        where: { corpus },
        orderBy: [{ startedAt: "desc" }, { id: "desc" }],
        take: EVAL_RUN_LIMIT,
        include: { results: { orderBy: { id: "asc" } } },
      });

      // R14 and #607, and one extra query rather than any per run — see
      // `seriesOf`.
      const series = await seriesOf(corpus, runs);

      res.json({
        corpus,
        // Asked only when the answer could be anything else — a page with runs
        // on it has already settled it — so the extra read happens on the one
        // request that needs it: the empty one, which has to tell "nothing on
        // this series" apart from "nobody has ever run one".
        anyRuns: runs.length > 0 || (await prisma.evalRun.count()) > 0,
        // A presence boolean, never the value or a prefix of it — the rule the
        // pipeline config block keeps. It is what lets the page say "no key"
        // rather than drawing a Run button that always fails.
        evalConfigured: config.evalConfigured(),
        runs: runs.map((run): EvalRunRow => {
          const reading = readRun(run, series);
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
            // Read, not re-derived (#223). This used to be
            // `Σ max(repeats - 1, 0)` over `results` — a second expression of
            // the rule `EVAL_COUNTERS` argues and `runCase` applies, with a
            // database between the two and nothing keeping them in step, on the
            // one rate here that makes a stopped prompt cache visible.
            cacheable: run.cacheable,
            caught: run.caught,
            escaped: run.escaped,
            checks: reading.checks,
            classifiedRepeats: run.classifiedRepeats,
            classifyMatches: run.classifyMatches,
            categories: reading.categories,
            metrics: reading.metrics,
            previous: reading.previous,
            failing: isRunFailing(run),
            results: reading.results,
          };
        }),
      });
    },
  );

  /**
   * How the frozen series stands, for the sidebar's Evals item (#608).
   *
   * A failing run used to be visible on `/evals` and nowhere else, so it was
   * seen only by whoever went looking. R8 rules out a notification or an issue;
   * it does not rule out a mark where admins already look, which is this.
   *
   * **Frozen only**, and that is R4 rather than a default: the nightly series is
   * the frozen one, and a live run that answered from an article an admin just
   * reworded is not a regression to be pulled to. **The latest completed run**,
   * passing over one in flight or one that fell over — neither has numbers to
   * judge, which is why `metrics` is empty on both, so the last judgement stands
   * until a run finishes properly. One row and only the columns its verdict
   * reads, since the sidebar asks on every page.
   */
  router.get(
    "/status",
    requireAdminView,
    async (_req: Request, res: Response<EvalStatusResponse>) => {
      const run = await prisma.evalRun.findFirst({
        where: {
          corpus: EVAL_CORPUS.frozen,
          status: EVAL_RUN_STATUS.completed,
        },
        orderBy: [{ startedAt: "desc" }, { id: "desc" }],
        select: { ...COMPARISON_COLUMNS, status: true, thresholds: true },
      });

      if (run === null) {
        res.json({ health: null });
        return;
      }

      res.json({
        health:
          run.escaped > 0
            ? EVAL_HEALTH.escaped
            : isRunFailing(run)
              ? EVAL_HEALTH.failing
              : EVAL_HEALTH.passing,
      });
    },
  );

  return router;
}
