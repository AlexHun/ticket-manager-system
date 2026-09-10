import { Router } from "express";
import type { Request, Response } from "express";
import {
  asAutoReplyDecline,
  asPipelineOutcome,
  asTicketCategory,
  EVAL_CORPUS,
  EVAL_METRIC,
  EVAL_RUN_LIMIT,
  EVAL_RUN_STATUS,
  EVAL_THRESHOLD,
  isOutputCheckDecline,
  type AutoReplyDecline,
  type EvalCaseResultRow,
  type EvalCategoryRow,
  type EvalCheckRow,
  type EvalCorpus,
  type EvalFiledRow,
  type EvalMetric,
  type EvalMetricRow,
  type EvalPreviousMetric,
  type EvalReachedRow,
  type EvalRunCounters,
  type EvalRunRow,
  type EvalRunsResponse,
  type EvalRunStatus,
  type EvalRunStartedResponse,
  type TicketCategory,
} from "@ticket/shared";
import { autoReplyCaseById, startEvalRunSchema } from "@ticket/core";
import { prisma } from "../db";
import { startEvalRun } from "../evals/start-run";
import {
  parseStoredVerdicts,
  type StoredVerdict,
} from "../evals/stored-verdict";
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
 *
 * **The four breakdown builders are exported, and that is a testability
 * decision rather than an interface anybody calls** (#212). `reachedFrom`,
 * `filedFrom`, `categoriesFrom` and `checksFrom` are the rules this page is
 * really made of — which repeats collapse together, which way a tie sorts,
 * which pairs a category matrix draws — and while they were private the only
 * way to ask them anything was to write a run into Postgres and fetch it back
 * through the router. That is a slow way to state a rule about an array, and
 * it is a *misleading* one: a test that fails could be failing for the
 * router's reasons or the aggregate's, and nothing in it says which.
 *
 * Since they take parsed repeats (`evals/stored-verdict.ts`) rather than the
 * `Json` column, a caller can now build their input as a value, so the rules
 * are asserted as values in `evals.test.ts` and the route tests keep only what
 * needs the seam: the status code, the wire shape, and that an old run still
 * draws what it drew. Nothing outside this file and its test imports them, and
 * nothing should — `createEvalsRouter` is still the module's interface.
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

/**
 * A case's stored repeats, collapsed into distinct rows with counts.
 *
 * The shape both breakdowns on this page need, and the reason it is one
 * function: "five repeats" is never what a reader wants to see. Five identical
 * rows say one thing and take five lines to say it; the interesting case is the
 * one that went two different ways, and what is wanted then is *which* way and
 * how often. Sorted by count, so the first entry is what the case usually does.
 *
 * `rowOf` decides what a repeat counts as: a key to group on and the row to
 * carry, or `null` to leave the repeat out of the tally entirely. `count` is
 * added here rather than by the caller, which is what stops the two callers
 * disagreeing about whether a skipped repeat is a zero or an absence.
 *
 * It takes **parsed** repeats. The defensive reading the stored column needs is
 * not gone — it is in `evals/stored-verdict.ts`, beside the projection that
 * writes the column, where the one story about older shapes is told once
 * instead of at each `rowOf` in this file. What is left here is the grouping.
 */
function tally<T>(
  verdicts: StoredVerdict[],
  rowOf: (verdict: StoredVerdict) => { key: string; row: T } | null,
): (T & { count: number })[] {
  const rows = new Map<string, T & { count: number }>();

  for (const verdict of verdicts) {
    const made = rowOf(verdict);
    if (made === null) continue;

    const existing = rows.get(made.key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    rows.set(made.key, { ...made.row, count: 1 });
  }

  return [...rows.values()].sort((a, b) => b.count - a.count);
}

/**
 * The distinct places a case landed, and how often.
 *
 * An outcome this build has no wording for arrives as `notOffered` and an
 * unknown decline as null — decided by the parse, not here, so this page cannot
 * disagree with the other readers of the same column about what an unreadable
 * repeat means.
 */
export function reachedFrom(verdicts: StoredVerdict[]): EvalReachedRow[] {
  return tally(verdicts, (verdict) => ({
    key: `${verdict.outcome}:${verdict.decline ?? ""}`,
    row: {
      outcome: verdict.outcome,
      decline: verdict.decline,
      matched: verdict.matched,
    },
  }));
}

/**
 * The counters every metric is taken over, on any run.
 *
 * Structural rather than the Prisma row, because two different queries produce
 * it: the page of runs, which selects everything, and the narrow lookup for the
 * run before it (`COMPARISON_COLUMNS`), which selects eight columns and none of
 * the results.
 *
 * A `Pick` over the run-level counters rather than six restated fields, so a
 * counter renamed in `EVAL_COUNTERS` fails here rather than resolving to a
 * column that no longer exists. `COMPARISON_COLUMNS` needs no such treatment —
 * its rows are read as `PriorRun`, so a column dropped from that select is
 * already a compile error.
 */
type MetricCounts = Pick<
  EvalRunCounters,
  | "caught"
  | "escaped"
  | "matches"
  | "attempts"
  | "classifyMatches"
  | "classifiedRepeats"
>;

/** A run reduced to what the run after it needs in order to say what moved. */
interface PriorRun extends MetricCounts {
  id: number;
  startedAt: Date;
}

/**
 * Which counters each metric is a rate over.
 *
 * A `Record`, so a fourth metric is a compile error here until somebody says
 * what it counts — and, more to the point, **one definition read twice**: once
 * for the run being drawn and once for the run before it. Written out per
 * metric at each site, a delta could silently be a comparison between two
 * different arithmetics, which is the one way this feature could be wrong and
 * still look right.
 */
const METRIC_COUNTS: Record<
  EvalMetric,
  (run: MetricCounts) => { numerator: number; denominator: number }
> = {
  // Caught over *attempted*, never over repeats: a repeat where the model
  // ignored the payload is on neither side, because there was nothing to catch.
  [EVAL_METRIC.catchRate]: (run) => ({
    numerator: run.caught,
    denominator: run.caught + run.escaped,
  }),
  [EVAL_METRIC.declineAccuracy]: (run) => ({
    numerator: run.matches,
    denominator: run.attempts,
  }),
  // Its own denominator again: `classifiedRepeats` is what the classifier
  // answered, which is neither `attempts` nor the case count.
  [EVAL_METRIC.classifierAccuracy]: (run) => ({
    numerator: run.classifyMatches,
    denominator: run.classifiedRepeats,
  }),
};

/**
 * A rate, or null when nothing was measured.
 *
 * `denominator === 0` gives null rather than a zero or a one, and the two wrong
 * readings pull in opposite directions: zero would light up as a catastrophe on
 * a healthy desk, and one would draw a perfect score as evidence the safety
 * checks work when nothing ever tested them.
 */
function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

/**
 * One metric, judged against what this run recorded (R8) and read against the
 * run before it (R14).
 *
 * `meets` is true for an unmeasured value, because a metric with no measurement
 * cannot fall below anything — and the page prints the denominator beside every
 * figure so the difference is legible.
 */
function metricRow(
  metric: EvalMetric,
  run: MetricCounts,
  previous: PriorRun | null,
  thresholds: Record<string, number>,
): EvalMetricRow {
  // A run that recorded no threshold for this metric is judged by the constant
  // this build carries. That is every row written before the column existed, and
  // it is the only honest reading of an absent key — the alternative is a zero
  // that reads as a bar nothing could fail.
  const threshold = thresholds[metric] ?? EVAL_THRESHOLD[metric];
  const { numerator, denominator } = METRIC_COUNTS[metric](run);
  const value = rate(numerator, denominator);

  return {
    metric,
    value,
    numerator,
    denominator,
    threshold,
    meets: value === null || value >= threshold,
    previous: previous === null ? null : previousMetric(metric, previous),
  };
}

/**
 * What the run before this one made of the same metric (R14).
 *
 * Taken through `METRIC_COUNTS`, which is the point: the predecessor's rate is
 * computed by the same arithmetic as this run's, so a delta can never be a
 * comparison between two different definitions of the same word.
 *
 * **A value, not a difference.** Deciding which run is comparable belongs here;
 * subtracting belongs to the page, which rounds both figures to whole percents
 * before it prints them and must caption the numbers it actually drew. A
 * difference taken over the raw fractions can round the other way and contradict
 * them — see `EvalPreviousMetric`. An unmeasured metric stays null the whole way
 * out, never a zero.
 */
function previousMetric(
  metric: EvalMetric,
  previous: PriorRun,
): EvalPreviousMetric {
  const { numerator, denominator } = METRIC_COUNTS[metric](previous);

  return { value: rate(numerator, denominator) };
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

/**
 * For each run on the page, the completed run before it on the same corpus
 * (R14).
 *
 * Three conditions, and each one rules out a comparison that would be worse
 * than none. **Same corpus**, because frozen and live are two series (R4) and a
 * delta across them measures an admin's article edits and calls it a prompt
 * regression. **Completed**, because a run still filling in holds a fraction of
 * the set and a rate over a fraction is a different number, not a smaller one —
 * so a run in flight is skipped rather than compared against or used as a
 * predecessor. And **before**, on the same `[startedAt, id]` ordering the page
 * itself uses, so two runs started in the same second still have one answer.
 *
 * The page is walked oldest-first and each corpus's last seen run is carried
 * forward, which is one pass and no per-run query. The one thing that pass
 * cannot see is a predecessor that fell off the end of the page — and it will:
 * the nightly is frozen, so twenty nights of them push the previous *live* run
 * out of the window and the whole live series would quietly stop being
 * comparable. So each corpus gets one anchor lookup for the run immediately
 * older than the page, which is two queries whatever the history holds.
 */
async function previousRuns(
  page: (PriorRun & { corpus: EvalCorpus; status: EvalRunStatus })[],
): Promise<Map<number, PriorRun>> {
  const previous = new Map<number, PriorRun>();
  // "The newest completed run of this corpus seen so far", walking oldest-first
  // — which starts out as the run immediately older than the page itself.
  const newestSeen = await anchorRuns(page.at(-1));

  for (const run of [...page].reverse()) {
    // Skipped both ways: a run in flight or one that fell over is neither
    // compared against a predecessor nor allowed to become one, which is what
    // stops a half-finished run anchoring the series it interrupted.
    if (run.status !== EVAL_RUN_STATUS.completed) continue;

    const prior = newestSeen.get(run.corpus);
    if (prior) previous.set(run.id, prior);
    newestSeen.set(run.corpus, run);
  }

  return previous;
}

/**
 * The completed run immediately older than the page, one per corpus.
 *
 * Two queries whatever the history holds, and they are what keep the answer
 * independent of `EVAL_RUN_LIMIT` — see the note on `previousRuns`. The
 * `[startedAt, id]` tie-break mirrors the page's own `orderBy` exactly; a
 * lookup that compared `startedAt` alone would skip a run started in the same
 * second and hand back the one before it.
 */
async function anchorRuns(
  oldest: { id: number; startedAt: Date } | undefined,
): Promise<Map<EvalCorpus, PriorRun>> {
  const anchors = new Map<EvalCorpus, PriorRun>();
  if (!oldest) return anchors;

  await Promise.all(
    Object.values(EVAL_CORPUS).map(async (corpus) => {
      const run = await prisma.evalRun.findFirst({
        where: {
          corpus,
          status: EVAL_RUN_STATUS.completed,
          OR: [
            { startedAt: { lt: oldest.startedAt } },
            { startedAt: oldest.startedAt, id: { lt: oldest.id } },
          ],
        },
        orderBy: [{ startedAt: "desc" }, { id: "desc" }],
        select: COMPARISON_COLUMNS,
      });
      if (run) anchors.set(corpus, run);
    }),
  );

  return anchors;
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
 * Where one case's repeats were actually filed, counted (R15).
 *
 * Read out of the stored `verdicts` for the same reason `reachedFrom` is:
 * "4 of 5 as expected" is the rate, and *which* category the fifth one went to
 * is the finding. Sorted by count, so the first entry is what the classifier
 * usually does with this email.
 *
 * A repeat with no category was one the classifier could not answer, one on a
 * case it is not scored against, or one written before slice 4 existed; it
 * appears here as a null so a reader can see the denominator shrink rather than
 * wonder why five repeats add to three. `matched` is read from the row's own
 * expectation rather than recomputed against the case set, which is the whole
 * point of denormalising it.
 */
export function filedFrom(
  verdicts: StoredVerdict[],
  expected: TicketCategory | null,
): EvalFiledRow[] {
  return tally(verdicts, ({ category }) => {
    // Nothing was asked, so there is nothing to report — the `null` return is
    // what keeps the repeat out of the tally rather than counting it as a
    // filing of nowhere. Distinct from a null *answer*, which is a repeat the
    // provider could not answer and is worth showing; the two are
    // indistinguishable on the row, so the honest reading is the quieter one: a
    // case with no expectation reports no filings at all.
    if (category === null && expected === null) return null;

    return {
      key: category ?? "",
      row: {
        category,
        matched: category !== null && category === expected,
      },
    };
  });
}

/**
 * What was filed where across a whole run, most frequent first (R15).
 *
 * A pair — expected and actual — rather than a tally of categories, because the
 * useful question about a classifier is never "how many Generals" but **which
 * category is being mistaken for which**. On this desk that is not academic:
 * the category gate is the only control between a refund request and an
 * unattended reply, so "Refund → General ×4" is the single most alarming line
 * this page can draw, and a bare per-category count could not draw it.
 *
 * Built from the per-case rows so it never disagrees with them.
 */
export function categoriesFrom(
  results: { expectedCategory: string | null; verdicts: StoredVerdict[] }[],
): EvalCategoryRow[] {
  const rows = new Map<string, EvalCategoryRow>();

  for (const result of results) {
    const expected = asTicketCategory(result.expectedCategory);
    if (expected === null) continue;

    for (const filed of filedFrom(result.verdicts, expected)) {
      const key = `${expected}:${filed.category ?? ""}`;
      const existing = rows.get(key);
      if (existing) {
        existing.count += filed.count;
        continue;
      }
      rows.set(key, {
        expected,
        actual: filed.category,
        count: filed.count,
        matched: filed.matched,
      });
    }
  }

  return [...rows.values()].sort((a, b) => b.count - a.count);
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
export function checksFrom(
  results: { verdicts: StoredVerdict[] }[],
): EvalCheckRow[] {
  const counts = new Map<AutoReplyDecline, number>();

  for (const result of results) {
    for (const { caught, decline } of result.verdicts) {
      if (!caught) continue;

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
  router.get(
    "/runs",
    requireAdmin,
    async (_req: Request, res: Response<EvalRunsResponse>) => {
      const runs = await prisma.evalRun.findMany({
        orderBy: [{ startedAt: "desc" }, { id: "desc" }],
        take: EVAL_RUN_LIMIT,
        include: { results: { orderBy: { id: "asc" } } },
      });

      // R14, and it is two queries rather than one per run — see `previousRuns`.
      const previousByRun = await previousRuns(runs);

      res.json({
        // A presence boolean, never the value or a prefix of it — the rule the
        // pipeline config block keeps. It is what lets the page say "no key"
        // rather than drawing a Run button that always fails.
        evalConfigured: config.evalConfigured(),
        runs: runs.map((run): EvalRunRow => {
          const thresholds = thresholdsFrom(run.thresholds);
          // The `Json` column read back through the module that also writes it,
          // once per row rather than once per breakdown: the three below all
          // read the same repeats, and three parses would be three chances to
          // disagree about what an older row says.
          const results = run.results.map((result) => ({
            ...result,
            verdicts: parseStoredVerdicts(result.verdicts),
          }));
          // Null on every run that is not `completed`, because `previousRuns`
          // skips those — the same gate `metrics` is behind, and for the same
          // reason: there is nothing yet to compare.
          const previous = previousByRun.get(run.id) ?? null;
          // Only on a run that finished properly, and `completed` rather than
          // "not running" — the two states this excludes are excluded for the
          // same reason. A rate over the third of the set that has been answered
          // is not a smaller version of the answer, it is a different number, and
          // a threshold applied to one goes red on a run that is merely young or
          // merely interrupted. A `failed` run is exactly that second case: its
          // queue gave up part way, so it holds whatever fraction it got through,
          // and drawing "Failing" over it would put the wrong word on a card
          // whose real news is that the provider was unreachable. Empty is what
          // the page draws nothing from.
          const metrics =
            run.status === EVAL_RUN_STATUS.completed
              ? [
                  // The catch rate first, because it is the one ADR-0004 stands
                  // on and the only one whose failure is a defect.
                  metricRow(EVAL_METRIC.catchRate, run, previous, thresholds),
                  metricRow(
                    EVAL_METRIC.declineAccuracy,
                    run,
                    previous,
                    thresholds,
                  ),
                  // Last, and over its own denominator: `classifiedRepeats` is
                  // the classifier answered, which is neither `attempts` nor the
                  // case count. A run from before this metric existed has both
                  // halves at zero and reports no accuracy rather than a zero —
                  // `metricRow` is what makes that the honest reading.
                  metricRow(
                    EVAL_METRIC.classifierAccuracy,
                    run,
                    previous,
                    thresholds,
                  ),
                ]
              : [];

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
            // Read, not re-derived (#223). One repeat per case is what warms the
            // cache and can never be a hit, so the denominator is not
            // `attempts` — but that rule is applied once, by `runCase`, and
            // summed here like every other counter. This used to be
            // `Σ max(repeats - 1, 0)` over `results`, a second expression of the
            // same rule that nothing kept in step with the first, on the one
            // rate in this codebase that makes a stopped prompt cache visible.
            // Summing it with the rest also fixes a smaller thing: the
            // derivation filled in while `cachedRepeats` stayed zero until the
            // run closed, so a run halfway through drew 0%, which is what the
            // regression looks like.
            cacheable: run.cacheable,
            caught: run.caught,
            escaped: run.escaped,
            checks: checksFrom(results),
            classifiedRepeats: run.classifiedRepeats,
            classifyMatches: run.classifyMatches,
            categories: categoriesFrom(results),
            metrics,
            // Which run those deltas are against, said once for the card rather
            // than three times over (R14). Non-null on exactly the runs whose
            // metrics carry a `previous`, because both come from this variable.
            previous:
              previous === null
                ? null
                : {
                    id: previous.id,
                    startedAt: previous.startedAt.toISOString(),
                  },
            // Marked failing, shown failing, and nothing else happens (R8, R11):
            // no issue, no notification, and nothing that could turn a pull request
            // red. A slow statistical suite wired to a gate is a suite somebody
            // switches off, which is the failure this is written to avoid.
            failing: metrics.some((metric) => !metric.meets),
            results: results.map((result): EvalCaseResultRow => ({
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
              cacheable: result.cacheable,
              caught: result.caught,
              escaped: result.escaped,
              expectedCategory: asTicketCategory(result.expectedCategory),
              classifiedRepeats: result.classifiedRepeats,
              classifyMatches: result.classifyMatches,
              filed: filedFrom(
                result.verdicts,
                asTicketCategory(result.expectedCategory),
              ),
              reached: reachedFrom(result.verdicts),
            })),
          };
        }),
      });
    },
  );

  return router;
}
