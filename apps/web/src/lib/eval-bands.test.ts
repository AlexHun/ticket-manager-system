import { describe, expect, test } from "vitest";
import {
  EVAL_METRIC,
  EVAL_THRESHOLD,
  type EvalMetric,
  type EvalMetricRow,
} from "@ticket/shared";
import {
  EVAL_BAND,
  judgeAbandoned,
  judgeCache,
  judgeMetric,
} from "./eval-bands";

/**
 * How `/evals` decides good from bad.
 *
 * The claims worth pinning are the ones a future edit would break silently: the
 * band comes from the threshold **on the row** rather than from this build's
 * constant, the catch rate has no marginal band, and a number that measured
 * nothing is left unjudged rather than given a flattering band.
 */

function metricRow(
  metric: EvalMetric,
  overrides: Partial<EvalMetricRow> = {},
): EvalMetricRow {
  return {
    metric,
    value: 1,
    numerator: 5,
    denominator: 5,
    threshold: EVAL_THRESHOLD[metric],
    meets: true,
    previous: null,
    ...overrides,
  };
}

describe("a judged metric", () => {
  test("is banded against the threshold stored on the run, not the current constant", () => {
    // The whole reason the threshold is snapshotted. This run was judged
    // against 60%, so 70% is clear of it — even though the build now demands
    // 80%, against which the same figure would be below the bar entirely.
    const row = metricRow(EVAL_METRIC.declineAccuracy, {
      value: 0.7,
      numerator: 70,
      denominator: 100,
      threshold: 0.6,
      meets: true,
    });

    expect(judgeMetric(row)).toEqual({
      band: EVAL_BAND.good,
      label: "clear",
    });
    // And the constant this build carries would have said otherwise.
    expect(EVAL_THRESHOLD[EVAL_METRIC.declineAccuracy]).toBeGreaterThan(0.7);
  });

  test("is marginal within five points above its threshold", () => {
    const row = metricRow(EVAL_METRIC.classifierAccuracy, {
      value: 0.83,
      numerator: 83,
      denominator: 100,
      threshold: 0.8,
    });

    expect(judgeMetric(row)?.band).toBe(EVAL_BAND.marginal);
  });

  test("is still marginal at exactly five points above", () => {
    // "Within five points above it" includes the fifth, so 85% over a stored
    // 80% is the last marginal value rather than the first clear one. Written
    // down because floating point makes this edge easy to get wrong twice:
    // `0.8 + 0.05` is `0.8500000000000001`.
    const row = metricRow(EVAL_METRIC.classifierAccuracy, {
      value: 0.85,
      numerator: 85,
      denominator: 100,
      threshold: 0.8,
    });

    expect(judgeMetric(row)?.band).toBe(EVAL_BAND.marginal);
  });

  test("is clear once it is past five points", () => {
    const row = metricRow(EVAL_METRIC.classifierAccuracy, {
      value: 0.86,
      numerator: 86,
      denominator: 100,
      threshold: 0.8,
    });

    expect(judgeMetric(row)?.band).toBe(EVAL_BAND.good);
  });

  test("takes the bad band from the run's own `meets`, not a comparison of its own", () => {
    // `meets` is what puts the Failing badge on the card. A tile that
    // recomputed the same question from a rounded rate could disagree with it.
    const row = metricRow(EVAL_METRIC.declineAccuracy, {
      value: 0.799,
      numerator: 799,
      denominator: 1000,
      meets: false,
    });

    expect(judgeMetric(row)).toEqual({
      band: EVAL_BAND.bad,
      label: "missed",
    });
  });

  test("renders the catch rate binary, with no marginal band", () => {
    // ADR-0004: a fail-closed check that catches 96% of payloads is a bug
    // rather than a score, so there is no "nearly caught it" to draw.
    const met = metricRow(EVAL_METRIC.catchRate, {
      value: 1,
      numerator: 4,
      denominator: 4,
    });
    const missed = metricRow(EVAL_METRIC.catchRate, {
      value: 0.75,
      numerator: 3,
      denominator: 4,
      meets: false,
    });

    expect(judgeMetric(met)).toEqual({ band: EVAL_BAND.good, label: "met" });
    expect(judgeMetric(missed)?.band).toBe(EVAL_BAND.bad);
  });

  test("is left unjudged when it measured nothing", () => {
    // A green 100% over a run where the model planted no payload would be the
    // most misleading thing this page could say.
    const row = metricRow(EVAL_METRIC.catchRate, {
      value: null,
      numerator: 0,
      denominator: 0,
    });

    expect(judgeMetric(row)).toBeNull();
  });
});

describe("the prompt cache", () => {
  test("is bad only when it never engaged", () => {
    // `ai-features.md`: caching engages silently and stops just as silently, and
    // a run of zero is the regression. A partial hit rate is a warm cache.
    expect(judgeCache({ cachedRepeats: 0, cacheable: 4 })?.band).toBe(
      EVAL_BAND.bad,
    );
    expect(judgeCache({ cachedRepeats: 1, cacheable: 4 })?.band).toBe(
      EVAL_BAND.good,
    );
  });

  test("is left unjudged when no repeat could have hit it", () => {
    // One repeat per case is what warms the cache, so `cacheable` of zero says
    // nothing either way — which is also what an old run stored before the
    // counters existed looks like.
    expect(judgeCache({ cachedRepeats: 0, cacheable: 0 })).toBeNull();
  });
});

describe("unanswered repeats", () => {
  test("are marginal rather than bad", () => {
    // An outage is not the model getting things wrong, and drawing it in the
    // same red as a missed threshold would say it was.
    expect(judgeAbandoned({ abandoned: 3, attempts: 60 })?.band).toBe(
      EVAL_BAND.marginal,
    );
    expect(judgeAbandoned({ abandoned: 0, attempts: 60 })?.band).toBe(
      EVAL_BAND.good,
    );
  });

  test("are left unjudged on a run that attempted nothing", () => {
    expect(judgeAbandoned({ abandoned: 0, attempts: 0 })).toBeNull();
  });
});
