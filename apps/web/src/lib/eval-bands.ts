import {
  EVAL_METRIC,
  type EvalMetricRow,
  type EvalRunRow,
} from "@ticket/shared";

/**
 * How `/evals` colours a number, and the word that says the same thing.
 *
 * Before this, exactly one value on the page was coloured — a judged metric
 * below its threshold went red — so the screen gave no signal at all until
 * something was already broken. Every function here answers the same question
 * about a different number: is this good, nearly not, or bad.
 *
 * **A band is never the only cue.** Every judgement carries a `label`, and the
 * page prints it in the caption under the figure, so the judgement survives
 * colour-blindness, a greyscale screenshot and a screen reader. That is the
 * same rule `StatusPill` keeps on the dashboard, and for the same reason: this
 * theme is monochrome green, so a green figure sits in the hue family of half
 * the app.
 *
 * **`null` is an unjudged rendering and it is not a failure.** A metric that
 * measured nothing has nothing to be judged, and a green 100% where nothing was
 * ever tested would be the most misleading thing this page could say. The
 * caller draws the figure in the ordinary foreground and leaves the caption's
 * existing "no X in this run" reason to explain itself.
 *
 * The functions are pure and take the wire rows, so they are tested here rather
 * than through the page — the same split `kpi-status.ts` keeps from `StatTile`.
 */

/**
 * The three states a value on `/evals` can be in.
 *
 * No neutral member: a value with nothing to judge gets `null` rather than a
 * fourth band, so a caller cannot forget to handle the case where there is
 * nothing to judge at all. Ordered by severity.
 */
export const EVAL_BAND = {
  good: "good",
  marginal: "marginal",
  bad: "bad",
} as const;

export type EvalBand = (typeof EVAL_BAND)[keyof typeof EVAL_BAND];

export interface EvalJudgement {
  band: EvalBand;
  /**
   * The word the caption carries. One or two, and phrased for the number it
   * sits under rather than for the band — "missed" and "cache stalled" are the
   * same band and would be nonsense in each other's captions.
   */
  label: string;
}

/**
 * How far above its threshold a rate still counts as marginal, as a fraction.
 *
 * Percentage points, not a percentage of the threshold: 5pp above 80% is 85%,
 * and 5pp above 100% is nothing, which is the right answer for the one
 * threshold that sits at 1.0. It is a judgement call rather than a derived
 * constant, so it is named here rather than inlined — a band edge buried in a
 * comparison is a band edge nobody re-tunes.
 */
export const EVAL_MARGINAL_POINTS = 0.05;

/**
 * A rate as the whole number `/evals` prints for it.
 *
 * The page's single rounding rule, and it lives beside the band edge because
 * the two have to agree: a band computed on the raw fractions would put a
 * "marginal" caption under a figure drawn at the good side of the line, and
 * `0.8 + 0.05` is `0.8500000000000001` in binary floating point, so a value of
 * exactly 85% lands on the wrong side of a naive comparison. Rounding both to
 * the figures actually on screen settles both problems with one rule — the same
 * argument the delta caption already makes for subtracting drawn values rather
 * than raw ones.
 */
export function points(value: number): number {
  return Math.round(value * 100);
}

/**
 * One judged metric, banded against **the threshold stored on its run**.
 *
 * `row.threshold` and not `EVAL_THRESHOLD[row.metric]`, which is the whole
 * reason that value is snapshotted when a run starts: a run kept for months has
 * to keep being coloured against what it was actually judged against, or
 * editing the constant would silently re-colour the entire history.
 *
 * **The bad band is `row.meets`, not a comparison of our own.** The server
 * decides whether a run is failing from the raw fractions and puts the badge on
 * the card; recomputing the same question here from a rounded percentage is how
 * a tile would come to disagree with the badge above it. The price is a narrow
 * case that looks wrong and is not: 79.6% draws as "80%" and is still captioned
 * `missed`, because it is. Agreeing with the badge is worth more than agreeing
 * with the rounding, and the caption's own `needs 80%` is what lets a reader
 * see which side of the half-point it fell.
 *
 * **The catch rate is binary and takes no marginal band.** Its threshold is 1.0
 * because ADR-0004 makes a fail-closed check that catches 96% of payloads a bug
 * rather than a score, so there is no "nearly caught it" to draw — and 5pp above
 * 1.0 is unreachable anyway, which would make the marginal band the only one it
 * could ever be in.
 *
 * Null when the metric measured nothing — the catch rate over a run where the
 * model planted no payload.
 */
export function judgeMetric(row: EvalMetricRow): EvalJudgement | null {
  if (row.value === null) return null;
  if (!row.meets) return { band: EVAL_BAND.bad, label: "missed" };
  if (row.metric === EVAL_METRIC.catchRate) {
    return { band: EVAL_BAND.good, label: "met" };
  }
  // Inclusive: five points above the bar is *within* five points of it, so 85%
  // against a stored 80% is the last marginal value rather than the first clear
  // one.
  return points(row.value) <= points(row.threshold + EVAL_MARGINAL_POINTS)
    ? { band: EVAL_BAND.marginal, label: "marginal" }
    : { band: EVAL_BAND.good, label: "clear" };
}

/**
 * The prompt cache, which is judged on whether it engaged at all.
 *
 * No threshold and no marginal band, deliberately. The only claim this codebase
 * makes about this number is the one in `ai-features.md`: prompt caching
 * engages silently and stops just as silently, and "a run of `cached=0` on a
 * feature that should be hitting it is that regression". A hit rate of 40% is a
 * warm cache and a busy provider; a hit rate of zero is the alarm. Inventing a
 * floor between them would be colouring an opinion.
 *
 * Null when no repeat could have hit the cache — one repeat per case is what
 * warms it, so a single-repeat run has a `cacheable` of zero and says nothing
 * about caching either way. That is also what an old run stored before the
 * counters existed looks like, and it renders unbanded rather than as a stalled
 * cache.
 */
export function judgeCache(
  run: Pick<EvalRunRow, "cachedRepeats" | "cacheable">,
): EvalJudgement | null {
  if (run.cacheable === 0) return null;
  return run.cachedRepeats === 0
    ? { band: EVAL_BAND.bad, label: "cache stalled" }
    : { band: EVAL_BAND.good, label: "cache engaged" };
}

/**
 * Repeats nothing was decided about.
 *
 * **Marginal rather than bad, at any count.** An abandoned repeat is the
 * provider being unreachable, not the model getting things wrong — the
 * distinction `EVAL_COUNTERS` and ADR-0019 both exist to hold — so drawing it
 * in the same red as a missed threshold would put an outage and a regression in
 * the same colour on the same card. What it does say is that every rate beside
 * it was taken over a smaller denominator than the run asked for, which is
 * worth a colour.
 *
 * Null on a run that attempted nothing: zero unanswered out of zero asked is
 * not a clean night.
 *
 * The two labels are the sentences this tile already carried, moved rather than
 * rewritten. They said the judgement in words before there was a band to say it
 * in colour, so there is nothing to add — a word appended to them would be the
 * same claim twice. ("Verdict" in the good one is CONTEXT.md's other sense:
 * where a repeat landed, which is exactly what this counts.)
 */
export function judgeAbandoned(
  run: Pick<EvalRunRow, "abandoned" | "attempts">,
): EvalJudgement | null {
  if (run.attempts === 0) return null;
  return run.abandoned === 0
    ? { band: EVAL_BAND.good, label: "every repeat reached a verdict" }
    : { band: EVAL_BAND.marginal, label: "repeats where nothing was decided" };
}
