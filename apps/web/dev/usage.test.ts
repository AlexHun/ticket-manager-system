import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BUCKETS,
  TRANSCRIPT_DIR_ENV,
  bucketFor,
  gatherUsage,
  percentiles,
  resolveTranscriptDir,
  scanSpend,
  verdictFor,
} from "./usage.ts";
import { ISSUE_STATE, type IssueMeta, type IssueMetadata } from "./issues.ts";
import { USAGE_WARNING_SOURCE } from "../src/dev/usage-protocol.ts";

/**
 * An issue listing, without asking `gh` for one.
 *
 * Every `gatherUsage` call here passes one, and not only for speed: the second
 * parameter defaults to a real `gh` spawn, so a call that omitted it would make
 * this suite depend on the machine being authenticated and on what this
 * repository's issues happen to be titled today.
 *
 * Since #251 it decides the row *set* as well as what a row says: an entry left
 * at the default `OPEN` earns a row whether or not the transcripts mention it.
 * `ISSUE_STATE` rather than a bare `"OPEN"`, because that is now load-bearing
 * here and a mistyped literal would simply produce fewer rows than the test
 * describes.
 */
const known = (
  entries: Record<number, Partial<IssueMeta>> = {},
): IssueMetadata => ({
  byIssue: new Map(
    Object.entries(entries).map(([number, meta]) => [
      Number(number),
      {
        title: `Issue ${number}`,
        url: `https://github.com/o/r/issues/${number}`,
        state: ISSUE_STATE.open,
        forecast: null,
        ...meta,
      },
    ]),
  ),
  warning: null,
});

/** What `fetchIssueMetadata` returns when `gh` could not be asked. */
const noListing = (
  warning = "`gh` could not list this repository's issues",
): IssueMetadata => ({
  byIssue: null,
  warning,
});

/** One transcript record, in the shape Claude Code writes. */
const turn = (
  sessionId: string,
  gitBranch: string,
  out: number,
  cacheRead = 0,
) =>
  JSON.stringify({
    sessionId,
    gitBranch,
    message: {
      usage: { output_tokens: out, cache_read_input_tokens: cacheRead },
    },
  });

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "usage-fixture-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const write = (name: string, lines: string[]) =>
  writeFileSync(join(dir, name), lines.join("\n"), "utf8");

describe("scanSpend", () => {
  it("sums a session that spans two branches onto both issues", () => {
    write("s1.jsonl", [
      turn("s1", "feat/101-a", 100, 1000),
      turn("s1", "feat/101-a", 50, 500),
      turn("s1", "fix/102-b", 20, 200),
    ]);

    const { byIssue } = scanSpend(dir);

    expect(byIssue.get(101)).toEqual({
      turns: 2,
      out: 150,
      cacheRead: 1500,
      sessions: 1,
    });
    expect(byIssue.get(102)).toEqual({
      turns: 1,
      out: 20,
      cacheRead: 200,
      sessions: 1,
    });
  });

  it("collapses a second branch for the same issue onto one row", () => {
    write("s1.jsonl", [
      turn("s1", "feat/101-a", 100),
      turn("s2", "fix/101-followup", 25),
    ]);

    expect(scanSpend(dir).byIssue.get(101)).toEqual({
      turns: 2,
      out: 125,
      cacheRead: 0,
      sessions: 2,
    });
  });

  // #253: the tokens as well as the turns. Counting the turns and throwing
  // their output away was the whole of the old behaviour, and it is what made a
  // total that omits a large share of the work read as complete.
  it("totals turns on main and on no branch as unattributed, tokens included", () => {
    write("s1.jsonl", [
      turn("s1", "main", 100),
      turn("s1", "", 30),
      turn("s1", "feat/101-a", 10),
    ]);

    const { byIssue, unattributed } = scanSpend(dir);

    expect(unattributed).toEqual({ turns: 2, out: 130 });
    expect([...byIssue.keys()]).toEqual([101]);
    expect(byIssue.get(101)?.out).toBe(10);
  });

  // The other half of the same claim, and the one an issue's row would be wrong
  // about: what ran on `main` is reported beside the issues, never inside one.
  it("keeps unattributed tokens out of every issue's figures", () => {
    write("s1.jsonl", [
      turn("s1", "main", 5000, 50_000),
      turn("s1", "feat/101-a", 10, 200),
    ]);

    const { byIssue, unattributed } = scanSpend(dir);

    expect(unattributed).toEqual({ turns: 1, out: 5000 });
    expect(byIssue.get(101)).toEqual({
      turns: 1,
      out: 10,
      cacheRead: 200,
      sessions: 1,
    });
  });

  it("skips a malformed line without losing the rest of the file", () => {
    write("s1.jsonl", [
      turn("s1", "feat/101-a", 100),
      '{"sessionId":"s1","gitBranch":"feat/101-a","message":{"usa',
      "",
      turn("s1", "feat/101-a", 5),
    ]);

    expect(scanSpend(dir).byIssue.get(101)).toEqual({
      turns: 2,
      out: 105,
      cacheRead: 0,
      sessions: 1,
    });
  });

  it("ignores records with no usage, and files that are not transcripts", () => {
    write("s1.jsonl", [
      JSON.stringify({ sessionId: "s1", gitBranch: "feat/101-a" }),
      turn("s1", "feat/101-a", 7),
    ]);
    write("notes.txt", [turn("s1", "feat/999-nope", 1000)]);

    const { byIssue } = scanSpend(dir);
    expect([...byIssue.keys()]).toEqual([101]);
    expect(byIssue.get(101)).toEqual({
      turns: 1,
      out: 7,
      cacheRead: 0,
      sessions: 1,
    });
  });

  // A named branch carrying no issue number is a third case, and it is neither
  // attributed nor unattributed. `unattributed` means what ran on `main` or on
  // nothing; widening it to "everything outside an issue" would put a figure
  // under a label that does not describe it.
  it("drops a branch that names no issue, without calling it unattributed", () => {
    write("s1.jsonl", [turn("s1", "chore/tidy-up", 100)]);

    expect(scanSpend(dir).byIssue.size).toBe(0);
    expect(scanSpend(dir).unattributed).toEqual({ turns: 0, out: 0 });
  });
});

describe("gatherUsage", () => {
  it("reports one row per issue, output tokens descending", async () => {
    write("s1.jsonl", [
      turn("s1", "fix/102-b", 3000, 20_000),
      turn("s1", "feat/101-a", 12_000, 300_000),
      turn("s2", "feat/101-a", 8000, 100_000),
    ]);

    const report = await gatherUsage(dir, known());

    expect(report.issues).toEqual([
      {
        issue: 101,
        spend: { out: 20_000, turns: 2, sessions: 2, cacheRead: 400_000 },
        title: null,
        url: null,
        forecast: null,
        bucket: "S",
        verdict: null,
      },
      {
        issue: 102,
        spend: { out: 3000, turns: 1, sessions: 1, cacheRead: 20_000 },
        title: null,
        url: null,
        forecast: null,
        bucket: "S",
        verdict: null,
      },
    ]);
    expect(report.transcriptDir).toBe(dir);
    expect(report.transcripts).toBe(1);
    expect(report.warnings).toEqual([]);
  });

  // Ties are not hypothetical: two issues that both spent nothing attributable
  // sort equal on `out`, and an unstable order would make the page's rows jump
  // between two scans of an unchanged directory.
  it("breaks a tie on the issue number, so two scans agree", async () => {
    write("s1.jsonl", [
      turn("s1", "feat/202-b", 500),
      turn("s1", "feat/101-a", 500),
    ]);

    expect(
      (await gatherUsage(dir, known())).issues.map((row) => row.issue),
    ).toEqual([101, 202]);
  });

  it("stamps the reading with when it was gathered", async () => {
    write("s1.jsonl", [turn("s1", "feat/101-a", 10)]);
    const before = Date.now();

    const { gatheredAt, scanMs } = await gatherUsage(dir, known());

    expect(Date.parse(gatheredAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(gatheredAt)).toBeLessThanOrEqual(Date.now());
    expect(scanMs).toBeGreaterThanOrEqual(0);
  });

  // The ordinary state of a machine that has never run Claude Code here, and of
  // CI. A 500 from the middleware would read as the page being broken.
  it("warns rather than throwing when the directory is not there", async () => {
    const missing = join(dir, "nope");

    const report = await gatherUsage(missing, known());

    expect(report.issues).toEqual([]);
    expect(report.transcripts).toBe(0);
    expect(report.transcriptDir).toBe(missing);
    // Zeroes rather than a 500 or a missing field, for the reason the row set is
    // empty rather than absent: nothing was read, so nothing was counted, and
    // the warning beside it is what says why.
    expect(report.unattributed).toEqual({ turns: 0, out: 0 });
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toMatchObject({
      source: USAGE_WARNING_SOURCE.transcripts,
    });
    expect(report.warnings[0]?.message).toContain(missing);
  });

  it("says so when the directory holds no transcripts", async () => {
    write("notes.txt", ["nothing to see"]);

    const report = await gatherUsage(dir, known());

    expect(report.issues).toEqual([]);
    expect(report.transcripts).toBe(0);
    // The directory's other failure, and the *same* source (#289): both mean
    // there are no figures, and only the message distinguishes them.
    expect(report.warnings[0]?.source).toBe(USAGE_WARNING_SOURCE.transcripts);
    expect(report.warnings[0]?.message).toContain(".jsonl");
  });

  /**
   * R7 (#253): what ran on `main` reaches the page as its own total.
   *
   * The wire is where this had to change, not the page — the join counted these
   * turns and discarded their tokens, so there was no figure to send. The two
   * assertions are one claim said from both ends: the total is reported, and no
   * issue's row absorbed any of it.
   */
  it("reports what ran on main as its own total, in turns and tokens", async () => {
    write("s1.jsonl", [
      turn("s1", "main", 5000, 50_000),
      turn("s1", "", 1200),
      turn("s1", "feat/101-a", 12_000, 300_000),
    ]);

    const report = await gatherUsage(dir, known());

    expect(report.unattributed).toEqual({ turns: 2, out: 6200 });
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]).toMatchObject({
      issue: 101,
      spend: { out: 12_000, turns: 1, sessions: 1, cacheRead: 300_000 },
    });
  });

  // A reading of zero is a measurement here, unlike an empty row: nothing scores
  // it, so it says the transcripts that were read hold no work on `main`.
  it("reports zero rather than nothing when every turn was on a branch", async () => {
    write("s1.jsonl", [turn("s1", "feat/101-a", 10)]);

    expect((await gatherUsage(dir, known())).unattributed).toEqual({
      turns: 0,
      out: 0,
    });
  });

  // R8 at the one figure the page carries that no row does: the CLI reads it off
  // `scanSpend` directly, so the two must be the same object's worth of work.
  it("carries the scan's unattributed total unchanged", async () => {
    write("s1.jsonl", [turn("s1", "main", 5000), turn("s1", "feat/101-a", 10)]);

    expect((await gatherUsage(dir, known())).unattributed).toEqual(
      scanSpend(dir).unattributed,
    );
  });

  // R8: the page and `bun run tokens` read the same join, so a row here is the
  // same row the terminal prints.
  it("carries the same figures as scanSpend", async () => {
    write("s1.jsonl", [
      turn("s1", "feat/101-a", 12_000, 300_000),
      turn("s1", "main", 5000, 50_000),
    ]);

    const [row] = (await gatherUsage(dir, known())).issues;
    const spend = scanSpend(dir).byIssue.get(101);

    // `toMatchObject`, because the row now carries what GitHub knows as well:
    // the claim is that every *figure* is the scan's, unchanged by the join.
    expect(row).toMatchObject({ issue: 101, spend });
  });

  // R2/R3, at the seam where the two sources meet.
  it("joins the listing's title, link and band onto the row", async () => {
    write("s1.jsonl", [turn("s1", "feat/101-a", 200_000)]);

    const [row] = (
      await gatherUsage(
        dir,
        known({
          101: {
            title: "Usage page: titles, links, forecast bands and verdicts",
            url: "https://github.com/AlexHun/ticket-manager-system/issues/101",
            forecast: "M",
          },
        }),
      )
    ).issues;

    expect(row).toMatchObject({
      title: "Usage page: titles, links, forecast bands and verdicts",
      url: "https://github.com/AlexHun/ticket-manager-system/issues/101",
      forecast: "M",
      // 200k against a band that tops out at 150k.
      bucket: "L",
      verdict: "over",
    });
  });

  it("scores an issue the listing knows but nobody forecast as no verdict", async () => {
    write("s1.jsonl", [turn("s1", "feat/101-a", 200_000)]);

    const [row] = (await gatherUsage(dir, known({ 101: { forecast: null } })))
      .issues;

    expect(row?.forecast).toBeNull();
    expect(row?.verdict).toBeNull();
    // The bucket is the row's own arithmetic, so it survives having no forecast.
    expect(row?.bucket).toBe("L");
  });

  it("leaves an issue the listing does not mention unknown, not wrong", async () => {
    write("s1.jsonl", [turn("s1", "feat/101-a", 10)]);

    // Closed, so the listing's own issue earns no row of its own here and this
    // stays a test about the *join* rather than about the row set below.
    const listing = known({ 999: { state: ISSUE_STATE.closed } });
    const { issues } = await gatherUsage(dir, listing);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      issue: 101,
      title: null,
      url: null,
      forecast: null,
    });
  });

  // The acceptance criterion the degraded path is written for: the figures are
  // filesystem work and owe `gh` nothing.
  it("keeps every actual, and says what is unknown, when there is no listing", async () => {
    write("s1.jsonl", [turn("s1", "feat/101-a", 12_000, 300_000)]);

    const report = await gatherUsage(dir, noListing("gh is not on PATH"));

    expect(report.issues).toEqual([
      {
        issue: 101,
        spend: { out: 12_000, turns: 1, sessions: 1, cacheRead: 300_000 },
        title: null,
        url: null,
        forecast: null,
        bucket: "S",
        verdict: null,
      },
    ]);
    expect(report.warnings).toEqual([
      { source: USAGE_WARNING_SOURCE.listing, message: "gh is not on PATH" },
    ]);
  });

  // Two independent failures, and the page shows both: a machine with no
  // transcripts *and* no `gh` should not have to discover the second one after
  // fixing the first.
  it("stacks the listing's warning beside the scan's", async () => {
    const report = await gatherUsage(
      join(dir, "nope"),
      noListing("no gh here"),
    );

    expect(report.warnings).toHaveLength(2);
    // Both messages survive, which is what "stack" means here. *Which* source
    // each came from is the case below — one claim per test, or the two drift
    // into one assertion that fails for either reason.
    expect(report.warnings[0]?.message).toContain("nope");
    expect(report.warnings[1]?.message).toBe("no gh here");
  });

  /**
   * R7 (#289): the acceptance criterion itself.
   *
   * The two failures above are told apart *here* without reading a character of
   * either message — which is what `bun run tokens` needs before it can word its
   * own diagnostics from the same scan (slice 8), and what no amount of matching
   * on prose could give it. `map` over the sources rather than an index, so a
   * third warning arriving in the middle fails this rather than shifting it.
   */
  it("names which source each warning came from, without its wording", async () => {
    const report = await gatherUsage(
      join(dir, "nope"),
      noListing("no gh here"),
    );

    expect(report.warnings.map((w) => w.source)).toEqual([
      USAGE_WARNING_SOURCE.transcripts,
      USAGE_WARNING_SOURCE.listing,
    ]);
  });
});

/**
 * R4, and the slice that changes where rows come from (#251): the set is no
 * longer "issues the transcripts mention", it is every issue worth looking at —
 * those, plus every issue the listing reports as **open**.
 *
 * Open is the line, and it is drawn there deliberately. An open issue with
 * nothing spent on it is work this repository still intends to do, and what it
 * was forecast to cost is the question the page exists to ask. A *closed* issue
 * with nothing spent on it is the opposite: it was finished somewhere this scan
 * cannot see — on another machine, or before these transcripts began — so a row
 * for it would report an absence as a fact about the work.
 */
describe("gatherUsage: issues nobody has started", () => {
  it("lists an open issue with a forecast and no recorded work", async () => {
    write("s1.jsonl", [turn("s1", "feat/101-a", 10)]);

    const { issues } = await gatherUsage(
      dir,
      known({
        101: {},
        300: { title: "Not started yet", forecast: "M" },
      }),
    );

    expect(issues.map((row) => row.issue)).toEqual([101, 300]);
    expect(issues[1]).toEqual({
      issue: 300,
      // The band it was aimed at is known; what it cost is not, and an empty
      // actual says so where a zero would claim the work was free.
      spend: null,
      title: "Not started yet",
      url: "https://github.com/o/r/issues/300",
      forecast: "M",
      // No band landed in, and above all no verdict: scoring unstarted work
      // against its forecast would report every backlog item as coming in
      // under, and move the accuracy figure this page exists to report.
      bucket: null,
      verdict: null,
    });
  });

  it("lists an open issue nobody forecast either, rather than only labelled ones", async () => {
    const { issues } = await gatherUsage(dir, known({ 300: {} }));

    // The page's second metric is forecast *coverage*, so an open issue
    // carrying no band is exactly the row that reports the gap.
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      issue: 300,
      spend: null,
      forecast: null,
      bucket: null,
      verdict: null,
    });
  });

  it("gives an issue with spend one row, not a second empty one", async () => {
    write("s1.jsonl", [turn("s1", "feat/101-a", 12_000, 300_000)]);

    const { issues } = await gatherUsage(
      dir,
      known({ 101: { forecast: "S" } }),
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      issue: 101,
      spend: { out: 12_000, turns: 1, sessions: 1, cacheRead: 300_000 },
      bucket: "S",
      verdict: "on target",
    });
  });

  it("leaves a closed issue nobody spent anything on out", async () => {
    write("s1.jsonl", [turn("s1", "feat/101-a", 10)]);

    const { issues } = await gatherUsage(
      dir,
      known({
        101: {},
        300: { state: ISSUE_STATE.closed, forecast: "L" },
      }),
    );

    expect(issues.map((row) => row.issue)).toEqual([101]);
  });

  it("keeps a closed issue that does have spend", async () => {
    write("s1.jsonl", [turn("s1", "feat/101-a", 10)]);

    const { issues } = await gatherUsage(
      dir,
      known({ 101: { state: ISSUE_STATE.closed } }),
    );

    // Closed only decides whether an issue *without* spend earns a row. Work
    // that happened is reported whatever became of the issue afterwards.
    expect(issues.map((row) => row.issue)).toEqual([101]);
    expect(issues[0]?.spend).not.toBeNull();
  });

  // Criterion 3: an empty actual is not a small one. Sorting the two together
  // on a zero would file every unstarted issue between the cheapest ones,
  // which is where they read as work that cost almost nothing.
  it("puts every issue with spend above every issue without", async () => {
    write("s1.jsonl", [
      turn("s1", "feat/101-a", 5000),
      turn("s1", "feat/102-b", 50),
    ]);

    const { issues } = await gatherUsage(
      dir,
      known({ 300: {}, 200: {}, 101: {}, 102: {} }),
    );

    expect(issues.map((row) => row.issue)).toEqual([101, 102, 200, 300]);
    expect(issues.map((row) => row.spend === null)).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });

  // A turn can record no output tokens at all, which is a spend of zero rather
  // than an absence — so the sort cannot collapse the two onto one key.
  it("keeps an issue that spent nothing measurable above one that spent at all", async () => {
    write("s1.jsonl", [turn("s1", "feat/101-a", 0)]);

    const { issues } = await gatherUsage(dir, known({ 101: {}, 300: {} }));

    expect(issues.map((row) => row.issue)).toEqual([101, 300]);
    expect(issues[0]?.spend).toMatchObject({ out: 0, turns: 1 });
    expect(issues[1]?.spend).toBeNull();
  });

  // The degraded path decides the row set too: with no listing there is no
  // "open", so the transcripts are all there is to go on.
  it("adds no unstarted rows when the listing could not be read", async () => {
    write("s1.jsonl", [turn("s1", "feat/101-a", 10)]);

    const { issues } = await gatherUsage(dir, noListing());

    expect(issues.map((row) => row.issue)).toEqual([101]);
  });
});

describe("resolveTranscriptDir", () => {
  it("honours the override", () => {
    expect(
      resolveTranscriptDir({ [TRANSCRIPT_DIR_ENV]: "/fixtures/transcripts" }),
    ).toBe("/fixtures/transcripts");
  });

  it("falls back to the home-directory slug of the working directory", () => {
    const home = String.raw`C:\Users\dev`;
    const resolved = resolveTranscriptDir(
      {},
      { cwd: String.raw`C:\Users\dev\my-project`, home },
    );

    expect(resolved).toBe(
      join(home, ".claude", "projects", "C--Users-dev-my-project"),
    );
  });

  it("ignores an override that is only whitespace", () => {
    const resolved = resolveTranscriptDir(
      { [TRANSCRIPT_DIR_ENV]: "  " },
      { cwd: "/home/dev/proj", home: "/home/dev" },
    );

    expect(resolved).toBe(
      join("/home/dev", ".claude", "projects", "-home-dev-proj"),
    );
  });
});

describe("bucketFor", () => {
  it("places a spend in the band whose exclusive max it falls under", () => {
    expect(bucketFor(0)).toBe("S");
    expect(bucketFor(BUCKETS.S.max - 1)).toBe("S");
    expect(bucketFor(BUCKETS.S.max)).toBe("M");
    expect(bucketFor(BUCKETS.M.max)).toBe("L");
    expect(bucketFor(BUCKETS.L.max)).toBe("XL");
    expect(bucketFor(10_000_000)).toBe("XL");
  });
});

describe("verdictFor", () => {
  it("is on target when the spend lands in the band it was forecast into", () => {
    expect(verdictFor("M", 90_000)).toBe("on target");
    expect(verdictFor("S", 0)).toBe("on target");
    expect(verdictFor("XL", 400_000)).toBe("on target");
  });

  it("is over at the forecast band's own boundary, not one token later", () => {
    expect(verdictFor("S", BUCKETS.S.max)).toBe("over");
    expect(verdictFor("S", BUCKETS.S.max - 1)).toBe("on target");
    expect(verdictFor("M", 250_000)).toBe("over");
  });

  it("is under when the spend falls short of the band", () => {
    expect(verdictFor("L", 10_000)).toBe("under");
    expect(verdictFor("M", BUCKETS.S.max - 1)).toBe("under");
  });

  // The rule R3 is explicit about: no forecast, no score — not a default one.
  it("has no verdict for an issue that was never forecast", () => {
    expect(verdictFor(null, 0)).toBeNull();
    expect(verdictFor(null, 10_000_000)).toBeNull();
  });
});

describe("percentiles", () => {
  it("reads the quartiles off the sorted values", () => {
    expect(percentiles([90, 10, 40, 20])).toEqual({
      p25: 20,
      p50: 40,
      p75: 90,
    });
  });

  it("reports zeroes for an empty set rather than undefined", () => {
    expect(percentiles([])).toEqual({ p25: 0, p50: 0, p75: 0 });
  });
});
