import { describe, expect, it } from "vitest";
import {
  READING_KIND,
  assembleReport,
  reportWarnings,
  type Reading,
  type ReportSources,
} from "./usage.ts";
import { ISSUE_STATE, type IssueMetadata } from "./issues.ts";
import type { TranscriptResponse } from "./transcript-reader.ts";
import {
  USAGE_WARNING_SOURCE,
  type TrendPoint,
  type UsageWarningSource,
} from "../src/dev/usage-protocol.ts";

/**
 * The one assembly behind both readings (#751): the scan's `gatherUsage` and
 * the stored `readStoredUsage`. Over made-up rows and no filesystem, so what is
 * held here is the report's shape and the warning policy alone; how each
 * reading finds its rows is `usage.test.ts`'s and `usage-stored.test.ts`'s.
 */

const LISTING: IssueMetadata = {
  byIssue: new Map([
    [
      101,
      {
        title: "Issue 101",
        url: "https://github.com/o/r/issues/101",
        state: ISSUE_STATE.open,
        forecast: "M",
      },
    ],
    [
      300,
      {
        title: "Nobody has started this",
        url: "https://github.com/o/r/issues/300",
        state: ISSUE_STATE.open,
        forecast: "L",
      },
    ],
  ]),
  warning: null,
};

const NO_LISTING: IssueMetadata = { byIssue: null, warning: "no gh here" };

const response = (
  id: string,
  branch: string,
  out: number,
): TranscriptResponse => ({
  id,
  session: "s",
  branch,
  at: "2026-09-02T09:00:00.000Z",
  out,
  cacheRead: 7,
  context: out + 7,
  window: "s.jsonl",
});

const RESPONSES = [
  response("m1", "feat/101-a", 4200),
  response("m2", "main", 800),
];

const TREND: TrendPoint[] = [
  {
    day: "2026-10-06",
    at: "2026-10-06T12:00:00.000Z",
    measured: 1,
    p25: 4200,
    median: 4200,
    p75: 4200,
    scored: 1,
    onTarget: 0,
    edges: { S: 60_000, M: 150_000, L: 300_000 },
  },
];

const scan = (
  over: Partial<Extract<ReportSources, { kind: "scan" }>> = {},
): ReportSources => ({
  kind: READING_KIND.scan,
  listing: LISTING,
  transcripts: 3,
  transcriptWarning: null,
  historyWarning: null,
  ...over,
});

const stored = (listing: IssueMetadata = LISTING): ReportSources => ({
  kind: READING_KIND.stored,
  listing,
});

const reading = (sources: ReportSources): Reading => ({
  sources,
  dir: "/transcripts",
  responses: RESPONSES,
  historySince: "2026-09-02",
  gatheredAt: "2026-10-06T12:00:00.000Z",
  startedAt: Date.now(),
  trendOf: () => TREND,
});

describe("reportWarnings", () => {
  const { transcripts, listing, history } = USAGE_WARNING_SOURCE;

  // Every combination of what each source had to say, and the sources that
  // reach the report for it: the stored reading reports its listing only, a
  // scan all three, transcripts first and history last.
  it.each<[string, ReportSources, UsageWarningSource[]]>([
    ["a stored reading, listing read", stored(), []],
    ["a stored reading, listing failed", stored(NO_LISTING), [listing]],
    ["a scan, every source read", scan(), []],
    [
      "a scan, transcripts failed",
      scan({ transcriptWarning: "t" }),
      [transcripts],
    ],
    ["a scan, listing failed", scan({ listing: NO_LISTING }), [listing]],
    ["a scan, history failed", scan({ historyWarning: "h" }), [history]],
    [
      "a scan, transcripts and listing failed",
      scan({ transcriptWarning: "t", listing: NO_LISTING }),
      [transcripts, listing],
    ],
    [
      "a scan, transcripts and history failed",
      scan({ transcriptWarning: "t", historyWarning: "h" }),
      [transcripts, history],
    ],
    [
      "a scan, listing and history failed",
      scan({ listing: NO_LISTING, historyWarning: "h" }),
      [listing, history],
    ],
    [
      "a scan, every source failed",
      scan({
        transcriptWarning: "t",
        listing: NO_LISTING,
        historyWarning: "h",
      }),
      [transcripts, listing, history],
    ],
  ])("%s", (_name, sources, expected) => {
    expect(reportWarnings(sources).map((w) => w.source)).toEqual(expected);
  });

  // A #289 test that #751 moved here from `usage.test.ts`: the messages survive untouched,
  // which is what "the sources stack" means.
  it("carries each source's message as it was handed over", () => {
    expect(
      reportWarnings(
        scan({
          transcriptWarning: "Could not read /nope",
          listing: NO_LISTING,
          historyWarning: "Could not read the usage history",
        }),
      ),
    ).toEqual([
      { source: transcripts, message: "Could not read /nope" },
      { source: listing, message: "no gh here" },
      { source: history, message: "Could not read the usage history" },
    ]);
  });
});

describe("assembleReport", () => {
  // `scanMs` is set aside as well as the count: it is a clock reading, and two
  // assemblies need not take the same number of milliseconds.
  it("builds the same report from the same rows whichever reading it is, but for the transcript count and the timing", () => {
    const fromScan = assembleReport(reading(scan()));
    const fromStore = assembleReport(reading(stored()));

    expect(fromScan.transcripts).toBe(3);
    expect(fromStore.transcripts).toBeNull();
    const { transcripts: _a, scanMs: _b, ...scanRest } = fromScan;
    const { transcripts: _c, scanMs: _d, ...storeRest } = fromStore;
    expect(storeRest).toEqual(scanRest);
  });

  it("tallies, joins and orders the rows, and carries the reading's facts", () => {
    const report = assembleReport(reading(stored()));

    expect(report).toMatchObject({
      gatheredAt: "2026-10-06T12:00:00.000Z",
      transcriptDir: "/transcripts",
      historySince: "2026-09-02",
      trend: TREND,
      unattributed: { turns: 1, out: 800 },
      warnings: [],
    });
    expect(report.scanMs).toBeGreaterThanOrEqual(0);
    expect(report.issues).toMatchObject([
      {
        issue: 101,
        spend: { out: 4200, turns: 1 },
        forecast: "M",
        bucket: "S",
        verdict: "under",
      },
      { issue: 300, spend: null, bucket: null, verdict: null },
    ]);
  });

  // A scan writes today's trend point inside `trendOf`, and "read in N ms" is
  // how long pressing Scan took, those writes included.
  it("times the trend's work into scanMs", () => {
    const report = assembleReport({
      ...reading(scan()),
      startedAt: Date.now(),
      trendOf: () => {
        const until = Date.now() + 25;
        while (Date.now() < until) {
          // Stands in for the history's writes.
        }
        return [];
      },
    });

    expect(report.scanMs).toBeGreaterThanOrEqual(25);
  });

  it("hands the trend the rows it joined", () => {
    let seen: number[] = [];
    assembleReport({
      ...reading(scan()),
      trendOf: (issues) => {
        seen = issues.map((row) => row.issue);
        return [];
      },
    });

    expect(seen).toEqual([101, 300]);
  });
});
