import type { AutoReplyDecline } from "./auto-reply.ts";
import type {
  EvalCaseCounters,
  EvalCorpus,
  EvalMetric,
  EvalRunStatus,
} from "./evals.ts";
import type { PipelineOutcome } from "./pipeline.ts";
import type { TicketCategory } from "./tickets.ts";

/**
 * What one case did when it was answered.
 *
 * `expected` is copied onto the row rather than looked up from the case set at
 * read time, and that is deliberate: the case set is edited by hand, and a run
 * from three weeks ago has to keep saying what *it* was measured against. A
 * row that re-derived its own expectation would silently agree with whatever
 * the file says today, which is the failure mode a stored result exists to
 * prevent.
 *
 * `outcome` and `decline` are plain strings in the database, narrowed here by
 * the API — same arrangement as `Ticket.autoReplyDecline`, and for the same
 * reason: they are display-only and grow a value every time a safety check is
 * added to `ai/auto-reply.ts`. `null` on the wire means "a reason this build
 * has no wording for", which is better than rendering a raw column at an admin.
 *
 * What it carries is a **rate and not a verdict** (R3). One answer from a model
 * is a coin toss reported as a fact; `matches` out of `repeats` is the thing a
 * threshold can be set against and the thing a later run can be compared with.
 */
export interface EvalCaseResultRow extends EvalCaseCounters {
  id: number;
  caseId: string;
  caseName: string;
  adversarial: boolean;
  expectedOutcome: PipelineOutcome;
  expectedDecline: AutoReplyDecline | null;
  expectedCategory: TicketCategory | null;
  filed: EvalFiledRow[];
  reached: EvalReachedRow[];
  /**
   * This case's split on each of the last `EVAL_HISTORY_RUNS` completed runs of
   * the series, oldest first and ending with this run (#607, R14).
   *
   * One run is five repeats, and five repeats cannot tell a case that has
   * stopped working from one that had a bad night; a week of nightly runs is
   * thirty-five. **A null is a run that did not answer this case** — a case
   * added since — and it is a gap, never a zero: a zero would read as the case
   * failing every repeat on a run that never asked it.
   *
   * Empty on a run that has not completed, which has no place in a series yet —
   * the same gate `EvalRunRow.metrics` is behind.
   */
  history: (EvalCaseSplit | null)[];
  /**
   * Set when this case matched enough fewer repeats than it did on the run a
   * week earlier to be flagged, and null otherwise (#607). How many is
   * `FALL_MATCHES` in `apps/api/src/routes/evals.ts`, decided there alone.
   *
   * Null too when there is no week-earlier run, or the case was not on it:
   * no flag rather than a guess. Display only — nothing notifies (R8, R11).
   */
  fell: EvalCaseFall | null;
}

/** One case's split on one run, as its history draws it (#607). */
export interface EvalCaseSplit {
  runId: number;
  matches: number;
  repeats: number;
}

/**
 * What a case matched on the run a week earlier, carried only when it has
 * fallen since (#607).
 *
 * The week-earlier run is the latest completed run on the same corpus that
 * started at least seven days before this one. Named on the row, run and date,
 * because "down from 5/5" is a claim somebody will want to go and check.
 */
export interface EvalCaseFall extends EvalCaseSplit {
  startedAt: string;
}

/**
 * One metric, its threshold, and whether it cleared it (R8).
 *
 * The threshold travels with the number rather than being looked up by the
 * page, and travels **from the run's own row** rather than from the constant
 * this build happens to carry: a run kept for months has to keep saying what it
 * was judged against, or editing `EVAL_THRESHOLD` would silently re-colour
 * every result in the history.
 *
 * `value` is null when nothing was measured — the catch rate over a run where
 * the model planted no payload at all. Null is not zero and it is not a hundred
 * percent: it is "this run says nothing about that", and `meets` is true for it
 * because a metric with no measurement cannot fail one. The page shows the
 * denominator beside every figure so an unmeasured metric cannot be read as a
 * clean one.
 */
export interface EvalMetricRow {
  metric: EvalMetric;
  /** The rate, or null when the denominator was zero. */
  value: number | null;
  numerator: number;
  denominator: number;
  /** What this run was judged against, as recorded when it started. */
  threshold: number;
  /** False only when a measured value fell below its threshold. */
  meets: boolean;
  /**
   * How this metric moved since the previous run on the same corpus (R14).
   *
   * Non-null on exactly the runs whose `EvalRunRow.previous` is non-null — both
   * are built from one predecessor, in one place, so the two cannot drift. The
   * split is by *what the reader needs where*: which run the comparison is
   * against, and when it ran, is one fact about the card and is said once;
   * how far each of three numbers moved is three facts and belongs beside each
   * number.
   */
  previous: EvalPreviousMetric | null;
  /**
   * The metric over the last `EVAL_HISTORY_RUNS` completed runs of the series,
   * this one included (#607, R14).
   *
   * Null with fewer than two runs before this one: an "average" of one or two
   * runs is the run-to-run noise it exists to smooth, drawn as a trend.
   */
  trailing: EvalTrailingMetric | null;
}

/**
 * One metric pooled over a window of runs (#607).
 *
 * **Pooled, not a mean of rates**: the numerators summed over the
 * denominators summed, through the same arithmetic as a single run's rate. A
 * mean of rates would weigh a catch rate over one payload the same as one over
 * nine, and has nothing to say about a run that measured none; pooling leaves
 * that run out of both sides, as one run's own rate leaves out an unanswered
 * repeat.
 */
export interface EvalTrailingMetric {
  /** Null when no run in the window measured this metric. */
  value: number | null;
  /** How many runs the window held, this one included. */
  runs: number;
}

/**
 * What the previous run on the same corpus made of one metric (R14).
 *
 * **A value, and deliberately not a difference.** The server decides *which*
 * run is comparable — that rule is worth writing down once — but the page owns
 * the subtraction, because the only defensible delta is the one between the two
 * numbers actually on screen. Every rate here is drawn as a whole percent; a
 * difference taken over the raw fractions and rounded on its own can disagree
 * with them, and "90%" beside "84%" captioned "-5pp" is a screen arguing with
 * itself in front of the person it is meant to inform. One rounding rule,
 * applied once, on the side that does the rendering.
 *
 * **Null is the interesting case and it is not zero.** That run may have
 * measured nothing: the catch rate over a night where the model planted no
 * payload is `null`, and so is a metric from before it existed. Subtracting one
 * of those as a zero would report a 100-point collapse on the safety metric the
 * first quiet night, which is the PRD's "cries wolf, then gets ignored" risk
 * arriving through the one door meant to catch it. Null here means "that run
 * says nothing about this", and the page says exactly that.
 */
export interface EvalPreviousMetric {
  /** The previous run's rate for this metric, or null when it measured none. */
  value: number | null;
}

/**
 * The run whose numbers this one is read against (R14).
 *
 * The previous **completed** run on the **same corpus**, and every word there is
 * load-bearing. Same corpus, because frozen and live are two series and a delta
 * across them would measure an admin's article edits and call it a prompt
 * regression (R4). Completed, because a run still filling in — or one whose
 * queue gave up part way — holds a fraction of the set, and a rate over a
 * fraction is not a smaller version of the answer; comparing against one would
 * manufacture a swing out of nothing but timing.
 *
 * Null on the first run of a corpus, which the page says out loud rather than
 * drawing three metrics with nothing beside them.
 */
export interface EvalPreviousRun {
  id: number;
  startedAt: string;
}

/**
 * How often each output check was the one that caught a payload (R9).
 *
 * The breakdown the hand-measured runs already drew — the money sentence and
 * the planted link are two different vectors stopped by two different string
 * comparisons — and the thing a bare catch rate cannot say: which check is
 * carrying the load, and therefore which one it would cost most to weaken.
 * Only the two output checks appear here; a payload declined for any other
 * reason was never in a draft to be caught.
 */
export interface EvalCheckRow {
  decline: AutoReplyDecline;
  count: number;
}

/**
 * One distinct category a case was filed under, and how often.
 *
 * `category` is null for a repeat the classifier could not answer. Those are
 * outside `classifiedRepeats` and therefore outside the rate — they are here so a
 * reader can see that the denominator shrank rather than wondering why five
 * repeats add up to three.
 */
export interface EvalFiledRow {
  category: TicketCategory | null;
  count: number;
  /** Whether this is the category the case expected. Never true for null. */
  matched: boolean;
}

/**
 * What was filed where, across a whole run (R15).
 *
 * A pair rather than a single count, because the useful question about a
 * classifier is never "how many Generals" — it is **which category is being
 * mistaken for which**. "Refund → General ×4" says the one thing that matters
 * about a desk whose category gate is the only control standing between a
 * refund request and an unattended reply.
 *
 * **The whole matrix travels, matched pairs included** — this is what was filed
 * where, not what is worth drawing. `EvalsPage` renders only the pairs that
 * disagree, deliberately: on a healthy run every pair matches, and a list that
 * opened with "General → General ×60" would bury the one line that matters
 * under the sixty that do not. Which rows to draw is a decision for a reader of
 * this type, and a different reader — a trend line across runs, say — wants the
 * half the page discards.
 */
export interface EvalCategoryRow {
  expected: TicketCategory;
  /** Null for repeats the classifier could not answer. */
  actual: TicketCategory | null;
  count: number;
  matched: boolean;
}

/** One distinct place a case landed, and how often. */
export interface EvalReachedRow {
  outcome: PipelineOutcome;
  decline: AutoReplyDecline | null;
  count: number;
  /** Whether landing here is what the case said would happen. */
  matched: boolean;
}

/** One run, with every case it answered. */
export interface EvalRunRow {
  id: number;
  corpus: EvalCorpus;
  status: EvalRunStatus;
  startedAt: string;
  finishedAt: string | null;
  /** Why the run itself fell over. Null on every run that reached a verdict. */
  error: string | null;
  /** How many times each case was answered. Five, and recorded rather than assumed. */
  repeats: number;
  /**
   * Repeats answered, and how many landed where their case said.
   *
   * `matches / attempts` is decline accuracy — the PRD's second metric, and the
   * one whose target is `TBD` until a run produces a baseline. Zero while a run
   * is still in flight: a fraction of a run is not a smaller version of the
   * answer, it is a different number, and drawing one would invite reading it.
   */
  attempts: number;
  matches: number;
  /**
   * Repeats the provider could not answer.
   *
   * Kept out of `matches` and shown separately, because an outage is not the
   * model getting things wrong. A run with a high count here has measured the
   * provider's availability and nothing else.
   */
  abandoned: number;
  /** Estimated USD for the whole run (R10). An estimate; nothing bills off it. */
  usd: number;
  /**
   * Repeats after each case's first that were served partly from the prompt
   * cache, out of `cacheable`.
   *
   * The auto-reply's cost rests on this and it stops engaging silently — a run
   * of zero here on a finished run is the regression nothing else in this app
   * would show (`ai-features.md`).
   */
  cachedRepeats: number;
  /**
   * How many repeats could have hit the cache: one per case is what warms it.
   *
   * Summed from the case results like every other counter, never re-derived
   * from `repeats` at read time — see `EVAL_COUNTERS`, where that rule is
   * argued and where the single place it is applied is named.
   */
  cacheable: number;
  /**
   * Payloads caught, and payloads that reached an accepted reply (R9).
   *
   * `caught / (caught + escaped)` is the safety catch rate. The denominator is
   * not the adversarial repeats: a repeat where the model ignored the payload
   * is on neither side, because there was nothing to catch. That is the
   * arithmetic the hand-measured 7-of-9 and 10-of-10 runs used, and it is what
   * stops a run where the model happened to behave from reading as a run where
   * the checks held.
   */
  caught: number;
  escaped: number;
  /** Which check caught them, most frequent first. Empty when none were. */
  checks: EvalCheckRow[];
  /**
   * Repeats the classifier answered, and how many it filed as expected (R15).
   *
   * `classifyMatches / classifiedRepeats` is classifier accuracy. The
   * denominator is neither the repeats nor the cases: two cases are not
   * classifiable at all (one expects classification to have *failed*, the other
   * carries no inbound message), and a repeat the provider could not answer is
   * left out rather than counted against the model.
   */
  classifiedRepeats: number;
  classifyMatches: number;
  /**
   * What was filed where, most frequent first. Empty when nothing was
   * classified.
   */
  categories: EvalCategoryRow[];
  /**
   * Every metric with the threshold it was judged against (R8).
   *
   * Empty while a run is in flight: a rate over the third of the set that has
   * finished is not a smaller version of the answer, and a threshold applied to
   * one would go red on a run that is merely young.
   */
  metrics: EvalMetricRow[];
  /**
   * The run these numbers are compared with, or null when there is none (R14).
   *
   * Always null while a run is in flight or after one fell over, for the same
   * reason `metrics` is empty then: there is nothing to compare. See
   * `EvalPreviousRun` for why "previous completed run on the same corpus" is
   * three separate conditions rather than one.
   */
  previous: EvalPreviousRun | null;
  /**
   * Whether any measured metric fell below its threshold.
   *
   * **Not the same thing as `status: "failed"`**, and the distinction is the
   * point. A failed run fell over — the provider was unreachable, the queue ran
   * out of retries — and has no numbers. A failing run finished and its numbers
   * are bad, which is the answer this harness exists to give.
   */
  failing: boolean;
  results: EvalCaseResultRow[];
}

export interface EvalRunsResponse {
  /**
   * Whether this deployment can run an eval at all — one key behind every AI
   * feature (ADR-0003), so an unkeyed deployment cannot start one. A presence
   * boolean, never the value: same rule the pipeline config block keeps.
   */
  evalConfigured: boolean;
  /**
   * Which series these runs are, echoed back from the request (#234).
   *
   * The page shows one corpus at a time and never both, so a response that did
   * not say which one it is would be a list nobody could caption. Echoed rather
   * than assumed, because the request may name none and the default lives on
   * the server too (`EVAL_CORPUS_DEFAULT`).
   */
  corpus: EvalCorpus;
  /**
   * Whether this deployment has ever recorded a run, **in any corpus**.
   *
   * The one thing a filtered list cannot say about itself, and what separates
   * the two empty states: "nobody has run one yet" wants the sentence that
   * explains what a run is, and "nothing on this series" wants the sentence
   * that says the other series is one control away. Without it an admin who
   * has only ever run live would be told, on load, that the harness has never
   * been used.
   */
  anyRuns: boolean;
  /** Newest first, and all of one corpus. */
  runs: EvalRunRow[];
}

/** The reply to `POST /api/evals/runs`: the run is queued, not finished. */
export interface EvalRunStartedResponse {
  runId: number;
}

/**
 * What the latest completed run on the frozen corpus says, for the sidebar's
 * Evals item (#608).
 *
 * Three values rather than `failing: boolean`, because the two bad answers are
 * different in kind and are drawn differently: a missed threshold is a score,
 * an escaped payload is a defect (`run.escaped`, the one number on `/evals`
 * that is not a measurement). `escaped` wins over `failing`: while the catch
 * rate's bar is 100%, a run with an escape is below it too, and whatever bar a
 * run recorded, an escape is the louder reading and the true one.
 */
export const EVAL_HEALTH = {
  passing: "passing",
  failing: "failing",
  escaped: "escaped",
} as const;

export type EvalHealth = (typeof EVAL_HEALTH)[keyof typeof EVAL_HEALTH];

/** The reply to `GET /api/evals/status`. */
export interface EvalStatusResponse {
  /**
   * Null while the frozen corpus has no completed run, which is no mark: there
   * is nothing to be below a threshold yet.
   */
  health: EvalHealth | null;
}

/**
 * How many runs `GET /api/evals/runs` carries — **per corpus** (#234).
 *
 * The cap is applied inside the series the request asked for, not across both,
 * which is what stops twenty nightly frozen runs pushing the whole live series
 * off the page. Named here because the page quotes it when the list is full.
 */
export const EVAL_RUN_LIMIT = 20;

/**
 * How many completed runs a case's history and a metric's trailing average
 * reach back over, the run itself included (#607).
 *
 * Seven, which is a week of the nightly series: 35 repeats of a case, enough
 * to tell a real split from a wrong expectation, where one run's five is not.
 */
export const EVAL_HISTORY_RUNS = 7;
