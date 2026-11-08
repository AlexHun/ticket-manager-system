/**
 * Unit tests for `apps/api/src/evals/read-run.ts`.
 *
 * Its two entry points, asked with runs built as values: no database, no HTTP,
 * no mock. The rules a card on `/evals` is made of — which repeats collapse
 * together, which way a tie sorts, which runs make a window, pooled versus
 * mean, a gap versus a zero — are stated here as values (#212, #607, #750).
 * `routes/evals.test.ts` keeps what needs the seam: status codes, the guards,
 * and which runs the queries hand over.
 */

import { describe, expect, test } from "bun:test";
import {
  AUTO_REPLY_DECLINE,
  EVAL_HISTORY_RUNS,
  EVAL_METRIC,
  EVAL_RUN_STATUS,
  EVAL_THRESHOLD,
  PIPELINE_OUTCOME,
  TICKET_CATEGORY,
  type EvalMetric,
  type EvalMetricRow,
} from "@ticket/shared";
import {
  isRunFailing,
  readRun,
  type RunReading,
  type SeriesRun,
  type SeriesSplit,
  type StoredCaseResult,
  type StoredRun,
} from "./read-run";
import type { StoredVerdict } from "./stored-verdict";

/* ── Runs as values ──────────────────────────────────────────────────────── */

/** A day in September 2026, so a test can order runs without a clock. */
function sept(day: number): Date {
  return new Date(`2026-09-${String(day).padStart(2, "0")}T10:00:00Z`);
}

/** One stored repeat, with whatever this test wants to say about it. */
function repeat(overrides: Partial<StoredVerdict> = {}): StoredVerdict {
  return {
    outcome: PIPELINE_OUTCOME.declined,
    decline: AUTO_REPLY_DECLINE.notCovered,
    matched: true,
    caught: false,
    escaped: false,
    category: null,
    ...overrides,
  };
}

/** A stored case result: five matched repeats of `off-corpus`. */
function caseValue(
  overrides: Partial<StoredCaseResult> = {},
): StoredCaseResult {
  return {
    id: 1,
    caseId: "off-corpus",
    caseName: "Nothing in the corpus covers it",
    adversarial: false,
    expectedOutcome: PIPELINE_OUTCOME.declined,
    expectedDecline: AUTO_REPLY_DECLINE.notCovered,
    repeats: 5,
    matches: 5,
    abandoned: 0,
    usd: 0.001,
    cachedRepeats: 4,
    cacheable: 4,
    caught: 0,
    escaped: 0,
    expectedCategory: null,
    classifiedRepeats: 0,
    classifyMatches: 0,
    verdicts: Array.from({ length: 5 }, () => repeat()),
    ...overrides,
  };
}

/** A completed run on the page, judged against this build's thresholds. */
function runValue(overrides: Partial<StoredRun> = {}): StoredRun {
  return {
    id: 1,
    startedAt: sept(1),
    status: EVAL_RUN_STATUS.completed,
    thresholds: EVAL_THRESHOLD,
    caught: 0,
    escaped: 0,
    matches: 5,
    attempts: 5,
    classifyMatches: 0,
    classifiedRepeats: 0,
    results: [caseValue()],
    ...overrides,
  };
}

/** A completed run of the series, with only what a window reads. */
function seriesValue(
  id: number,
  startedAt: Date,
  overrides: Partial<SeriesRun> = {},
): SeriesRun {
  return {
    id,
    startedAt,
    caught: 0,
    escaped: 0,
    matches: 5,
    attempts: 5,
    classifyMatches: 0,
    classifiedRepeats: 0,
    results: [{ caseId: "off-corpus", matches: 5, repeats: 5, abandoned: 0 }],
    ...overrides,
  };
}

/** The last run of `series` read as the card, against the runs before it. */
function readLast(series: SeriesRun[]): RunReading {
  const last = series.at(-1)!;
  return readRun(
    runValue({
      ...last,
      results: last.results.map((split, i) => caseValue({ id: i, ...split })),
    }),
    series.slice(0, -1),
  );
}

/** One metric off a reading. */
function metricOf(reading: RunReading, metric: EvalMetric): EvalMetricRow {
  const row = reading.metrics.find((m) => m.metric === metric);
  if (!row) throw new Error(`No ${metric} on the run`);
  return row;
}

/** One case's row off a reading. */
function caseOf(reading: RunReading, caseId = "off-corpus") {
  const row = reading.results.find((r) => r.caseId === caseId);
  if (!row) throw new Error(`No ${caseId} on the run`);
  return row;
}

/** A run of one case whose repeats were filed where this test says. */
function classifiedRun(
  expectedCategory: string | null,
  filed: (string | null)[],
): StoredRun {
  const classifiedRepeats = filed.filter((c) => c !== null).length;
  const classifyMatches = filed.filter((c) => c === expectedCategory).length;
  return runValue({
    classifiedRepeats,
    classifyMatches,
    results: [
      caseValue({
        expectedCategory,
        classifiedRepeats,
        classifyMatches,
        verdicts: filed.map((category) => ({ ...repeat(), category })),
      }),
    ],
  });
}

/* ── The metrics ─────────────────────────────────────────────────────────── */

describe("readRun — the metrics", () => {
  test("takes the catch rate over payloads attempted, not over repeats", () => {
    // R9, and the denominator is the whole argument. A repeat where the model
    // ignored the payload is on neither side of this — there was nothing to
    // catch — so a run where it happened to behave must not read as a run where
    // the checks held. Same arithmetic as the hand-measured 7-of-9.
    const metric = metricOf(
      readRun(runValue({ caught: 3, escaped: 1 }), []),
      EVAL_METRIC.catchRate,
    );

    expect(metric).toMatchObject({ numerator: 3, denominator: 4 });
    expect(metric.value).toBeCloseTo(0.75, 6);
  });

  test("reports no catch rate at all when no payload was attempted", () => {
    // Null, and not 100%. "The model planted nothing this run" is not evidence
    // that the checks work, and a screen that drew it as a perfect score would
    // be the most misleading thing on the page.
    const metric = metricOf(readRun(runValue(), []), EVAL_METRIC.catchRate);

    expect(metric.value).toBeNull();
    // A metric with no measurement cannot fall below a threshold.
    expect(metric.meets).toBe(true);
  });

  test("judges a run against the thresholds it recorded, not today's", () => {
    // The reason the column exists. A run kept for months has to keep saying
    // what it was judged against, or editing `EVAL_THRESHOLD` silently
    // re-colours every result somebody has already taken a decision off.
    const metric = metricOf(
      readRun(
        runValue({
          caught: 3,
          escaped: 1,
          thresholds: { [EVAL_METRIC.catchRate]: 0.5 },
        }),
        [],
      ),
      EVAL_METRIC.catchRate,
    );

    expect(metric.threshold).toBe(0.5);
    expect(metric.meets).toBe(true);
  });

  test("falls back to this build's threshold for a run that recorded none", () => {
    // Every row written before the column existed, which carries `{}`; and a
    // `Json` column that is not an object at all reads the same way. The
    // alternative is a zero that reads as a threshold nothing could fail.
    for (const thresholds of [{}, null, "nonsense", [0.1]]) {
      expect(
        metricOf(readRun(runValue({ thresholds }), []), EVAL_METRIC.catchRate)
          .threshold,
      ).toBe(EVAL_THRESHOLD[EVAL_METRIC.catchRate]);
    }
  });

  test("takes classifier accuracy over the repeats it answered", () => {
    // R15. Four of five filed as expected.
    const metric = metricOf(
      readRun(
        classifiedRun(TICKET_CATEGORY.General, [
          TICKET_CATEGORY.General,
          TICKET_CATEGORY.General,
          TICKET_CATEGORY.General,
          TICKET_CATEGORY.General,
          TICKET_CATEGORY.Other,
        ]),
        [],
      ),
      EVAL_METRIC.classifierAccuracy,
    );

    expect(metric).toMatchObject({ numerator: 4, denominator: 5 });
    expect(metric.value).toBeCloseTo(0.8, 6);
  });

  test("leaves a repeat the classifier could not answer out of the rate", () => {
    // An outage is not the model getting things wrong. Two of two, not two of
    // three — the same split `abandoned` draws on the other metric.
    const metric = metricOf(
      readRun(
        classifiedRun(TICKET_CATEGORY.General, [
          TICKET_CATEGORY.General,
          TICKET_CATEGORY.General,
          null,
        ]),
        [],
      ),
      EVAL_METRIC.classifierAccuracy,
    );

    expect(metric).toMatchObject({ numerator: 2, denominator: 2 });
  });

  test("reports no classifier accuracy on a run that predates it", () => {
    // Both halves zero. Null rather than a zero, which would draw a
    // catastrophe on a run that never asked.
    const metric = metricOf(
      readRun(runValue(), []),
      EVAL_METRIC.classifierAccuracy,
    );

    expect(metric.value).toBeNull();
    expect(metric.meets).toBe(true);
  });

  test("draws no metrics, and compares nothing, on a run in flight or one that fell over", () => {
    // A rate over the fraction of the set that was answered is not a smaller
    // version of the answer, it is a different number — and drawn on a failed
    // run it would put "Failing" on a card whose real news is that the
    // provider was unreachable.
    for (const status of [EVAL_RUN_STATUS.running, EVAL_RUN_STATUS.failed]) {
      const reading = readRun(
        runValue({ id: 2, startedAt: sept(2), status, caught: 3, escaped: 1 }),
        [seriesValue(1, sept(1))],
      );

      expect(reading.metrics).toEqual([]);
      expect(reading.previous).toBeNull();
      expect(caseOf(reading).history).toEqual([]);
      expect(caseOf(reading).fell).toBeNull();
    }
  });
});

/* ── Failing (R8, #608) ──────────────────────────────────────────────────── */

describe("isRunFailing", () => {
  test("is true when a measured metric is below the threshold it recorded", () => {
    expect(isRunFailing(runValue({ caught: 3, escaped: 1 }))).toBe(true);
    expect(isRunFailing(runValue({ matches: 2 }))).toBe(true);
  });

  test("is false when every metric meets it, or measured nothing", () => {
    expect(isRunFailing(runValue({ caught: 4 }))).toBe(false);
    expect(isRunFailing(runValue())).toBe(false);
  });

  test("judges against the thresholds the run recorded", () => {
    expect(
      isRunFailing(
        runValue({
          matches: 2,
          thresholds: { [EVAL_METRIC.declineAccuracy]: 0.4 },
        }),
      ),
    ).toBe(false);
  });

  test("is false on a run in flight or one that fell over", () => {
    // Neither has numbers to judge, which is why `readRun` draws them none.
    for (const status of [EVAL_RUN_STATUS.running, EVAL_RUN_STATUS.failed]) {
      expect(isRunFailing(runValue({ status, caught: 3, escaped: 1 }))).toBe(
        false,
      );
    }
  });

  test("agrees with the rows `readRun` draws, whatever the window", () => {
    // The card draws the rows and the badge; the sidebar asks only this. One
    // rule, or the mark and the badge could disagree about the same run.
    const window = [seriesValue(1, sept(1)), seriesValue(2, sept(2))];
    for (const run of [
      runValue({ id: 3, startedAt: sept(3), caught: 3, escaped: 1 }),
      runValue({ id: 3, startedAt: sept(3), caught: 4 }),
      runValue({ id: 3, startedAt: sept(3), matches: 2 }),
    ]) {
      expect(isRunFailing(run)).toBe(
        readRun(run, window).metrics.some((metric) => !metric.meets),
      );
    }
  });
});

/* ── Against the runs before it (R14, #607) ──────────────────────────────── */

describe("readRun — the previous run", () => {
  test("names the run before it and what that run made of each metric", () => {
    const reading = readLast([
      seriesValue(1, sept(1), { matches: 5 }),
      seriesValue(2, sept(2), { matches: 3 }),
    ]);

    expect(reading.previous).toEqual({
      id: 1,
      startedAt: sept(1).toISOString(),
    });
    // The predecessor's own rate, as a fraction. The subtraction is the
    // page's, over the two figures it draws, so a caption can never round the
    // other way from the numbers above it.
    expect(
      metricOf(reading, EVAL_METRIC.declineAccuracy).previous?.value,
    ).toBeCloseTo(1, 6);
  });

  test("the first run of a series is compared against nothing", () => {
    const reading = readLast([seriesValue(1, sept(1))]);

    expect(reading.previous).toBeNull();
    expect(metricOf(reading, EVAL_METRIC.declineAccuracy).previous).toBeNull();
  });

  test("names the run even when neither run measured the metric", () => {
    // Null on both sides, never a zero, which would say the two runs agreed
    // about something neither of them measured.
    const reading = readLast([
      seriesValue(1, sept(1)),
      seriesValue(2, sept(2)),
    ]);

    expect(reading.previous).not.toBeNull();
    expect(metricOf(reading, EVAL_METRIC.catchRate).previous).toEqual({
      value: null,
    });
  });

  test("reads only the runs before it, in whatever order they arrive", () => {
    // The route hands every card the same series, newer runs and the card
    // itself included; the window is decided on `[startedAt, id]`, so two runs
    // started in the same second still have one answer.
    const reading = readRun(runValue({ id: 3, startedAt: sept(2) }), [
      seriesValue(5, sept(3), { matches: 0 }),
      seriesValue(1, sept(1), { matches: 1 }),
      seriesValue(3, sept(2)),
      seriesValue(2, sept(2), { matches: 4 }),
      seriesValue(4, sept(2), { matches: 0 }),
    ]);

    expect(reading.previous?.id).toBe(2);
    expect(caseOf(reading).history.map((split) => split?.runId)).toEqual([
      1, 2, 3,
    ]);
  });
});

describe("readRun — a case's history", () => {
  /** A history drawn as its matches, gaps as null. */
  function matchesOf(reading: RunReading, caseId = "off-corpus") {
    return caseOf(reading, caseId).history.map(
      (split) => split?.matches ?? null,
    );
  }

  test("draws the last runs' splits, oldest first, ending with this one", () => {
    // Eight runs, so the window has something to leave out: the first one.
    const splits = [1, 5, 5, 4, 3, 5, 2, 0];
    const series = splits.map((matches, i) =>
      seriesValue(i + 1, sept(i + 1), {
        results: [{ caseId: "off-corpus", matches, repeats: 5, abandoned: 0 }],
      }),
    );
    const reading = readLast(series);

    expect(matchesOf(reading)).toEqual(splits.slice(-EVAL_HISTORY_RUNS));
    expect(caseOf(reading).history.at(-1)).toEqual({
      runId: 8,
      matches: 0,
      repeats: 5,
    });
  });

  test("draws a run that did not answer the case as a gap, not a zero", () => {
    const reading = readLast([
      seriesValue(1, sept(1), { results: [] }),
      seriesValue(2, sept(2)),
    ]);

    expect(caseOf(reading).history).toEqual([
      null,
      { runId: 2, matches: 5, repeats: 5 },
    ]);
  });
});

describe("readRun — the trailing average", () => {
  function trailingOf(series: SeriesRun[], metric: EvalMetric) {
    return metricOf(readLast(series), metric).trailing;
  }

  test("pools the window rather than averaging its rates", () => {
    // 1 of 1 and 0 of 3 payloads caught, then a quiet night: pooled, 1 of 4.
    // A mean of the two measured rates would say 50%, weighing one payload the
    // same as three.
    expect(
      trailingOf(
        [
          seriesValue(1, sept(1), { caught: 1 }),
          seriesValue(2, sept(2), { escaped: 3 }),
          seriesValue(3, sept(3)),
        ],
        EVAL_METRIC.catchRate,
      ),
    ).toEqual({ value: 0.25, runs: 3 });
  });

  test("keeps a repeat the classifier could not answer out of both sides", () => {
    // 4 of 5 classified, 3 of 3 (two unanswered) and 5 of 5: pooled over the
    // 13 it answered, 12 of 13 — never over the 15 repeats asked.
    expect(
      trailingOf(
        [
          seriesValue(1, sept(1), { classifyMatches: 4, classifiedRepeats: 5 }),
          seriesValue(2, sept(2), { classifyMatches: 3, classifiedRepeats: 3 }),
          seriesValue(3, sept(3), { classifyMatches: 5, classifiedRepeats: 5 }),
        ],
        EVAL_METRIC.classifierAccuracy,
      )?.value,
    ).toBe(12 / 13);
  });

  test("is null-valued when no run in the window measured the metric", () => {
    expect(
      trailingOf(
        [1, 2, 3].map((day) => seriesValue(day, sept(day))),
        EVAL_METRIC.catchRate,
      ),
    ).toEqual({ value: null, runs: 3 });
  });

  test("is absent with fewer than two runs before this one", () => {
    expect(
      trailingOf(
        [1, 2].map((day) => seriesValue(day, sept(day))),
        EVAL_METRIC.declineAccuracy,
      ),
    ).toBeNull();
  });
});

describe("readRun — a case that fell below its own history (#712)", () => {
  /** The case on one run: five repeats, `abandoned` of them unanswered. */
  function split(matches: number, abandoned = 0): SeriesSplit {
    return { caseId: "off-corpus", matches, repeats: 5, abandoned };
  }

  /**
   * The flag on tonight's split, one run a day before it. Each entry is a
   * run's matches, or a split for one with unanswered repeats.
   */
  function fellOn(before: (number | SeriesSplit)[], tonight: SeriesSplit) {
    const series = [...before, tonight].map((entry, i) =>
      seriesValue(i + 1, sept(i + 1), {
        results: [typeof entry === "number" ? split(entry) : entry],
      }),
    );
    return caseOf(readLast(series)).fell;
  }

  test("flags 5/5 to 0/5 on the first night, and the night after", () => {
    expect(fellOn([5, 5], split(0))).toEqual({
      matches: 10,
      answered: 10,
      runs: 2,
    });
    expect(fellOn([5, 5, 0], split(0))).not.toBeNull();
  });

  test("flags two misses on a case that always matched, and not one", () => {
    const always = [5, 5, 5, 5, 5, 5];

    expect(fellOn(always, split(3))).toEqual({
      matches: 30,
      answered: 30,
      runs: 6,
    });
    expect(fellOn(always, split(4))).toBeNull();
  });

  test("does not flag a swing chance explains at the case's own rate", () => {
    // 21 of 30, 70%, the shape of `certificate-missing` in production (#712).
    // 1/5 is 3.1% likely at that rate and 0/5 is 0.24%, either side of 1%.
    const flaky = [4, 3, 4, 3, 4, 3];

    expect(fellOn(flaky, split(1))).toBeNull();
    expect(fellOn(flaky, split(0))).not.toBeNull();
  });

  test("needs two runs before this one that answered the case", () => {
    expect(fellOn([5], split(0))).toBeNull();
    // A run without the case is not one of them.
    const reading = readLast([
      seriesValue(1, sept(1), { results: [] }),
      seriesValue(2, sept(2), { results: [split(5)] }),
      seriesValue(3, sept(3), { results: [split(0)] }),
    ]);
    expect(caseOf(reading).fell).toBeNull();
  });

  test("leaves out a run before that left the case mostly unanswered (#686)", () => {
    // 1 of 1 answered on each of two runs, then 3/5: a fall of two scaled up
    // from a single repeat a run, which says nothing about the case.
    expect(fellOn([split(1, 4), split(1, 4)], split(3))).toBeNull();
    // Beside two runs it can read, it counts for neither side.
    expect(fellOn([5, 5, split(0, 4)], split(0))).toEqual({
      matches: 10,
      answered: 10,
      runs: 2,
    });
  });

  test("does not read an outage as a fall when every answered repeat matched (#686)", () => {
    // Two runs at 5/5; tonight two repeats went unanswered and the other three
    // all matched. Raw matches are two down, and that is the provider.
    expect(fellOn([5, 5], split(3, 2))).toBeNull();
  });

  test("is null when tonight left the case mostly unanswered", () => {
    // Two answered, both missed: too few to say the case has stopped.
    expect(fellOn([5, 5], split(0, 3))).toBeNull();
  });

  test("keeps unanswered repeats out of both sides of the rate (#686)", () => {
    // Three of three answered on each run before, all matched; tonight 3/5.
    expect(fellOn([split(3, 2), split(3, 2)], split(3))).toEqual({
      matches: 6,
      answered: 6,
      runs: 2,
    });
    // Three answered tonight, one matched.
    expect(fellOn([5, 5], split(1, 2))).not.toBeNull();
  });
});

/* ── The per-repeat breakdowns ───────────────────────────────────────────── */

/** The one case of a run whose repeats are `verdicts`. */
function caseWith(verdicts: StoredVerdict[], expectedCategory?: string | null) {
  return caseOf(
    readRun(
      runValue({
        results: [
          caseValue({
            verdicts,
            ...(expectedCategory !== undefined ? { expectedCategory } : {}),
          }),
        ],
      }),
      [],
    ),
  );
}

describe("readRun — where a case landed", () => {
  test("collapses the repeats into the distinct places the case landed", () => {
    // Five identical rows say one thing five times; a case that split 3/2 is
    // the interesting one, and what a reader needs is which way and how often.
    const { reached } = caseWith([
      ...Array.from({ length: 3 }, () => repeat()),
      ...Array.from({ length: 2 }, () =>
        repeat({
          outcome: PIPELINE_OUTCOME.resolved,
          decline: null,
          matched: false,
        }),
      ),
    ]);

    // Most frequent first, so the head of the list is what the case usually does.
    expect(reached).toEqual([
      {
        outcome: PIPELINE_OUTCOME.declined,
        decline: AUTO_REPLY_DECLINE.notCovered,
        matched: true,
        count: 3,
      },
      {
        outcome: PIPELINE_OUTCOME.resolved,
        decline: null,
        matched: false,
        count: 2,
      },
    ]);
  });

  test("two declines for different reasons are two rows", () => {
    // "Expected declined, got declined for a completely different reason" is
    // the finding, and a tally keyed on the outcome alone could not draw it.
    expect(
      caseWith([
        repeat({ decline: AUTO_REPLY_DECLINE.notCovered }),
        repeat({ decline: AUTO_REPLY_DECLINE.unbackedCommitment }),
      ]).reached.map((row) => row.decline),
    ).toEqual([
      AUTO_REPLY_DECLINE.notCovered,
      AUTO_REPLY_DECLINE.unbackedCommitment,
    ]);
  });

  test("a clean answer and an escape on one payload case are two rows", () => {
    // Both are `resolved` with no reason, and only the clean one matches
    // (#714), so a row keyed on where they landed alone would draw the escape
    // as whichever came first.
    const answered = { outcome: PIPELINE_OUTCOME.resolved, decline: null };

    expect(
      caseWith([
        repeat({ ...answered, matched: false, escaped: true }),
        repeat({ ...answered, matched: true }),
        repeat({ ...answered, matched: true }),
      ]).reached.map((row) => [row.matched, row.count]),
    ).toEqual([
      [true, 2],
      [false, 1],
    ]);
  });

  test("no repeats is no rows, and a column that is not a list is no repeats", () => {
    // `Json` makes no promise, and the migration that introduced the column
    // backfilled rows written by an older build.
    expect(caseWith([]).reached).toEqual([]);
    expect(
      caseOf(
        readRun(
          runValue({ results: [caseValue({ verdicts: { not: "a list" } })] }),
          [],
        ),
      ).reached,
    ).toEqual([]);
  });

  test("a stored value this build has no wording for reads as its fallback", () => {
    // Rendering a raw column at an admin is worse than saying nothing. An
    // outcome is not nullable on the wire, so an unrecognised one falls back
    // to the honest "nothing is scheduled and nothing happened".
    const row = caseOf(
      readRun(
        runValue({
          results: [
            caseValue({
              expectedDecline: "somethingFromTheFuture",
              verdicts: [
                { outcome: "alsoFromTheFuture", decline: null, matched: false },
              ],
            }),
          ],
        }),
        [],
      ),
    );

    expect(row.expectedDecline).toBeNull();
    expect(row.reached[0]?.outcome).toBe(PIPELINE_OUTCOME.notOffered);
  });
});

describe("readRun — where a case was filed", () => {
  test("counts where the repeats actually went, most frequent first", () => {
    // R15. "4 of 5 as expected" is the rate; which category the fifth went to
    // is the finding.
    expect(
      caseWith(
        [
          ...Array.from({ length: 4 }, () =>
            repeat({ category: TICKET_CATEGORY.Refund }),
          ),
          repeat({ category: TICKET_CATEGORY.General }),
        ],
        TICKET_CATEGORY.Refund,
      ).filed,
    ).toEqual([
      { category: TICKET_CATEGORY.Refund, matched: true, count: 4 },
      { category: TICKET_CATEGORY.General, matched: false, count: 1 },
    ]);
  });

  test("a repeat the classifier could not answer shrinks the denominator", () => {
    // Shown as a null rather than dropped, so a reader can see why five repeats
    // add up to four instead of wondering.
    expect(
      caseWith(
        [repeat({ category: TICKET_CATEGORY.General }), repeat()],
        TICKET_CATEGORY.General,
      ).filed,
    ).toEqual([
      { category: TICKET_CATEGORY.General, matched: true, count: 1 },
      { category: null, matched: false, count: 1 },
    ]);
  });

  test("a case with no expectation reports no filings at all", () => {
    // A repeat with no category and a case that is not scored are
    // indistinguishable on the row, so a case that was never asked claims no
    // measurement rather than inventing one.
    expect(caseWith([repeat(), repeat()], null).filed).toEqual([]);
  });

  test("a filing against no expectation is never matched", () => {
    // It can never be a numerator with no denominator behind it.
    expect(
      caseWith([repeat({ category: TICKET_CATEGORY.Other })], null).filed,
    ).toEqual([{ category: TICKET_CATEGORY.Other, matched: false, count: 1 }]);
  });
});

describe("readRun — what was mistaken for what", () => {
  function categoriesOf(results: Partial<StoredCaseResult>[]) {
    return readRun(
      runValue({ results: results.map((result) => caseValue(result)) }),
      [],
    ).categories;
  }

  test("draws which category is being mistaken for which", () => {
    // "Refund → General ×4" is the single most alarming line this page can
    // draw: the category gate is the only control between a refund request and
    // an unattended reply.
    expect(
      categoriesOf([
        {
          expectedCategory: TICKET_CATEGORY.Refund,
          verdicts: Array.from({ length: 4 }, () =>
            repeat({ category: TICKET_CATEGORY.General }),
          ),
        },
        {
          expectedCategory: TICKET_CATEGORY.General,
          verdicts: [repeat({ category: TICKET_CATEGORY.General })],
        },
      ]),
    ).toEqual([
      {
        expected: TICKET_CATEGORY.Refund,
        actual: TICKET_CATEGORY.General,
        count: 4,
        matched: false,
      },
      {
        expected: TICKET_CATEGORY.General,
        actual: TICKET_CATEGORY.General,
        count: 1,
        matched: true,
      },
    ]);
  });

  test("sums one pair across the cases that reached it", () => {
    const refundFiledGeneral = {
      expectedCategory: TICKET_CATEGORY.Refund,
      verdicts: [repeat({ category: TICKET_CATEGORY.General })],
    };

    expect(categoriesOf([refundFiledGeneral, refundFiledGeneral])).toEqual([
      {
        expected: TICKET_CATEGORY.Refund,
        actual: TICKET_CATEGORY.General,
        count: 2,
        matched: false,
      },
    ]);
  });

  test("a result with no expectation is not in the matrix", () => {
    // Including a stored row this build cannot narrow: `expectedCategory` is a
    // text column, so an unrecognised one is the same as an absent one.
    expect(
      categoriesOf([
        {
          expectedCategory: null,
          verdicts: [repeat({ category: TICKET_CATEGORY.General })],
        },
        {
          expectedCategory: "somethingFromTheFuture",
          verdicts: [repeat({ category: TICKET_CATEGORY.General })],
        },
      ]),
    ).toEqual([]);
  });

  test("a run recorded before the classifier metric still reads the same", () => {
    // The literal shape every repeat written before slice 4 is in: three keys,
    // no `category` at all — not a null one. It reads as a filing nobody
    // measured, never as a zero on a rate or a case that went wrong.
    const reading = readRun(
      runValue({
        results: [
          caseValue({
            expectedCategory: TICKET_CATEGORY.General,
            verdicts: Array.from({ length: 5 }, () => ({
              outcome: PIPELINE_OUTCOME.declined,
              decline: AUTO_REPLY_DECLINE.notCovered,
              matched: true,
            })),
          }),
        ],
      }),
      [],
    );

    expect(caseOf(reading).filed).toEqual([
      { category: null, count: 5, matched: false },
    ]);
    expect(reading.categories).toEqual([
      {
        expected: TICKET_CATEGORY.General,
        actual: null,
        count: 5,
        matched: false,
      },
    ]);
    expect(caseOf(reading).reached).toEqual([
      {
        outcome: PIPELINE_OUTCOME.declined,
        decline: AUTO_REPLY_DECLINE.notCovered,
        matched: true,
        count: 5,
      },
    ]);
    expect(metricOf(reading, EVAL_METRIC.classifierAccuracy)).toMatchObject({
      value: null,
      denominator: 0,
    });
  });
});

describe("readRun — which check caught each payload", () => {
  function checksOf(...cases: StoredVerdict[][]) {
    return readRun(
      runValue({
        results: cases.map((verdicts, id) => caseValue({ id, verdicts })),
      }),
      [],
    ).checks;
  }

  test("says which check caught each payload, most frequent first", () => {
    // R9's second half. A bare catch rate cannot say which of the two string
    // comparisons is carrying the load, which is exactly what it would cost
    // most to weaken.
    expect(
      checksOf([
        ...Array.from({ length: 2 }, () =>
          repeat({
            decline: AUTO_REPLY_DECLINE.unbackedReference,
            caught: true,
          }),
        ),
        repeat({
          decline: AUTO_REPLY_DECLINE.unbackedCommitment,
          caught: true,
        }),
        repeat({ matched: false }),
      ]),
    ).toEqual([
      { decline: AUTO_REPLY_DECLINE.unbackedReference, count: 2 },
      { decline: AUTO_REPLY_DECLINE.unbackedCommitment, count: 1 },
    ]);
  });

  test("a decline that is not an output check cannot inflate a bar", () => {
    // A payload declined because the model refused to answer at all was never
    // in a draft to be caught, and a build with no wording for the reason
    // cannot label a bar with it either.
    expect(
      checksOf([
        repeat({ decline: AUTO_REPLY_DECLINE.notCovered, caught: true }),
        repeat({ decline: AUTO_REPLY_DECLINE.unavailable, caught: true }),
        repeat({ decline: null, caught: true }),
      ]),
    ).toEqual([]);
  });

  test("an output-check decline that was not caught is not a catch", () => {
    // `caught` is narrower than "declined by an output check": an ordinary
    // case thrown out by the money check is a decline-accuracy miss, not a
    // payload being caught. The test above cannot reach that — its uncaught
    // repeats all carry declines the output-check filter drops anyway, so it
    // stays green with the `caught` guard removed entirely.
    expect(
      checksOf([
        repeat({
          decline: AUTO_REPLY_DECLINE.unbackedCommitment,
          caught: false,
        }),
        repeat({ decline: AUTO_REPLY_DECLINE.unbackedReference, caught: true }),
      ]),
    ).toEqual([{ decline: AUTO_REPLY_DECLINE.unbackedReference, count: 1 }]);
  });

  test("counts across every case in the run", () => {
    const caught = repeat({
      decline: AUTO_REPLY_DECLINE.unbackedReference,
      caught: true,
    });

    expect(checksOf([caught], [caught])).toEqual([
      { decline: AUTO_REPLY_DECLINE.unbackedReference, count: 2 },
    ]);
  });
});
