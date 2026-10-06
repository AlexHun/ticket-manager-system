import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TRANSCRIPT_DIR_ENV,
  readTranscripts,
  resolveTranscriptDir,
  scanSpend,
} from "./transcripts.ts";
import { gatherUsage, verdictFor } from "./usage.ts";
import { ISSUE_STATE, type IssueMeta, type IssueMetadata } from "./issues.ts";
// The bands, the quartiles and the band arithmetic come from the contract
// module rather than from `./usage.ts`, which forwarded them until #290 — the
// same import every other reader of this vocabulary already wrote.
import { BUCKETS, USAGE_WARNING_SOURCE } from "../src/dev/usage-protocol.ts";
import {
  bucketFor,
  percentiles,
  recordedSpend,
} from "../src/dev/usage-readings.ts";

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

/**
 * One transcript record, in the shape Claude Code writes.
 *
 * `id` is the `message.id` Claude Code stamps on every record of one API
 * response — one record per content block (#413). Left out, the record carries
 * none, which is the fallback the scan counts once per record.
 */
const turn = (
  sessionId: string,
  gitBranch: string,
  out: number,
  cacheRead = 0,
  id?: string,
) =>
  JSON.stringify({
    sessionId,
    gitBranch,
    message: {
      ...(id === undefined ? {} : { id }),
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

  // #413: Claude Code writes one API response as one record per content block
  // (text, each `tool_use`, …), all sharing a `message.id` and carrying the
  // same `usage`. Summing every record counted a three-block response three
  // times — 2.32x the true output across this machine's transcripts.
  it("counts a response split across several records once", () => {
    write("s1.jsonl", [
      turn("s1", "feat/101-a", 100, 1000, "msg_1"),
      turn("s1", "feat/101-a", 100, 1000, "msg_1"),
      turn("s1", "feat/101-a", 100, 1000, "msg_1"),
      turn("s1", "feat/101-a", 40, 2000, "msg_2"),
      turn("s1", "main", 30, 0, "msg_3"),
      turn("s1", "main", 30, 0, "msg_3"),
    ]);
    // Never seen across two files when measured, but nothing about the format
    // forbids it, and the id names the response rather than the file.
    write("s1-resumed.jsonl", [turn("s1", "feat/101-a", 100, 1000, "msg_1")]);

    const { byIssue, unattributed } = scanSpend(dir);

    expect(byIssue.get(101)).toEqual({
      turns: 2,
      out: 140,
      cacheRead: 3000,
      sessions: 1,
    });
    expect(unattributed).toEqual({ turns: 1, out: 30 });
  });

  // The fallback that keeps a format change from reading as zero spend: a
  // record with no `message.id` has nothing to collapse on, so it counts once
  // per record, as every record did before #413.
  it("still counts records with no message id, once per record", () => {
    write("s1.jsonl", [
      turn("s1", "feat/101-a", 100),
      turn("s1", "feat/101-a", 100),
    ]);

    expect(scanSpend(dir).byIssue.get(101)).toEqual({
      turns: 2,
      out: 200,
      cacheRead: 0,
      sessions: 1,
    });
  });
});

// The identity a response is stored under (#417), and so counted once under
// across every later scan. Its order is the plan's: the response's id, then the
// record's uuid, then where the record sits.
describe("readTranscripts", () => {
  it("identifies a response by its message id, then its uuid, then its file and line", () => {
    write("s1.jsonl", [
      turn("s1", "feat/101-a", 1, 0, "msg_1"),
      JSON.stringify({
        sessionId: "s1",
        gitBranch: "feat/101-a",
        uuid: "u-2",
        message: { usage: { output_tokens: 2 } },
      }),
      turn("s1", "feat/101-a", 3),
    ]);

    expect(readTranscripts(dir).responses.map((r) => r.id)).toEqual([
      "message:msg_1",
      "uuid:u-2",
      "line:s1.jsonl:3",
    ]);
  });

  it("carries what a stored row needs: session, branch, timestamp and both token counts", () => {
    write("s1.jsonl", [
      JSON.stringify({
        sessionId: "s1",
        gitBranch: "feat/101-a",
        timestamp: "2026-09-02T09:00:00.000Z",
        message: {
          id: "msg_1",
          usage: { output_tokens: 12, cache_read_input_tokens: 340 },
        },
      }),
    ]);

    expect(readTranscripts(dir).responses).toEqual([
      {
        id: "message:msg_1",
        session: "s1",
        branch: "feat/101-a",
        at: "2026-09-02T09:00:00.000Z",
        out: 12,
        cacheRead: 340,
      },
    ]);
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

// The usage history through the one door both callers use (#417). Every case
// names its own temporary file: with none, `gatherUsage` keeps no history, and
// the real one is never a test's to write.
describe("gatherUsage with a history", () => {
  let historyDir: string;
  let history: string;

  beforeEach(() => {
    historyDir = mkdtempSync(join(tmpdir(), "usage-history-"));
    history = join(historyDir, "history.sqlite");
  });
  afterEach(() => {
    rmSync(historyDir, { recursive: true, force: true });
  });

  it("keeps an issue's spend after the transcript it was read from is deleted", async () => {
    write("a.jsonl", [turn("a", "feat/101-a", 12_000, 300_000)]);
    write("b.jsonl", [
      turn("b", "fix/102-b", 3000, 20_000),
      turn("b", "main", 500),
    ]);
    const before = await gatherUsage(dir, known(), history);

    rmSync(join(dir, "b.jsonl"));
    const after = await gatherUsage(dir, known(), history);

    expect(after.transcripts).toBe(1);
    expect(after.issues).toEqual(before.issues);
    expect(after.unattributed).toEqual({ turns: 1, out: 500 });
  });

  it("changes no figure however often an unchanged directory is scanned", async () => {
    write("a.jsonl", [
      turn("a", "feat/101-a", 12_000, 300_000, "msg_1"),
      turn("a", "feat/101-a", 12_000, 300_000, "msg_1"),
      turn("a", "feat/101-a", 8000),
    ]);

    const first = await gatherUsage(dir, known(), history);
    await gatherUsage(dir, known(), history);
    const third = await gatherUsage(dir, known(), history);

    expect(third.issues).toEqual(first.issues);
    expect(third.issues[0]?.spend).toEqual({
      out: 20_000,
      turns: 2,
      sessions: 1,
      cacheRead: 300_000,
    });
  });

  it("names the earliest date the stored history covers, and keeps it after the transcript goes", async () => {
    const record = (at: string, out: number) =>
      JSON.stringify({
        sessionId: "a",
        gitBranch: "feat/101-a",
        timestamp: at,
        message: { usage: { output_tokens: out } },
      });
    write("old.jsonl", [record("2026-09-02T09:00:00.000Z", 1)]);
    write("new.jsonl", [record("2026-09-20T09:00:00.000Z", 2)]);
    expect((await gatherUsage(dir, known(), history)).historySince).toBe(
      "2026-09-02T09:00:00.000Z",
    );

    rmSync(join(dir, "old.jsonl"));

    expect((await gatherUsage(dir, known(), history)).historySince).toBe(
      "2026-09-02T09:00:00.000Z",
    );
  });

  it("reports no history start when it was asked to keep none", async () => {
    write("a.jsonl", [turn("a", "feat/101-a", 10)]);

    expect((await gatherUsage(dir, known())).historySince).toBeNull();
  });

  it("still reports what is stored when the transcript directory is gone", async () => {
    write("a.jsonl", [turn("a", "feat/101-a", 4200)]);
    await gatherUsage(dir, known(), history);
    rmSync(dir, { recursive: true, force: true });

    const report = await gatherUsage(dir, known(), history);

    expect(report.issues[0]?.spend?.out).toBe(4200);
    // Still a warning on a laptop: there it says the scan ran from the wrong
    // directory, whatever the history holds.
    expect(report.warnings[0]?.source).toBe(USAGE_WARNING_SOURCE.transcripts);
  });
});

/**
 * #428: Railway's develop server has no transcripts and a history fed by
 * pushes. There, and only there (`pushedHistory`), a missing or empty
 * transcript directory beside stored rows is the ordinary state, not a warning.
 */
describe("gatherUsage over a pushed history (#428)", () => {
  let historyDir: string;
  let history: string;
  const pushed = { pushedHistory: true };

  beforeEach(() => {
    historyDir = mkdtempSync(join(tmpdir(), "usage-history-"));
    history = join(historyDir, "history.sqlite");
  });
  afterEach(() => {
    rmSync(historyDir, { recursive: true, force: true });
  });

  it("raises no warning for a missing directory beside a history that holds rows", async () => {
    write("a.jsonl", [turn("a", "feat/101-a", 4200)]);
    await gatherUsage(dir, known(), history);
    rmSync(dir, { recursive: true, force: true });

    const report = await gatherUsage(dir, known(), history, undefined, pushed);

    expect(report.warnings).toEqual([]);
    expect(report.transcripts).toBe(0);
    expect(report.issues[0]?.spend?.out).toBe(4200);
  });

  it("raises no warning for an empty directory beside a history that holds rows", async () => {
    write("a.jsonl", [turn("a", "feat/101-a", 4200)]);
    await gatherUsage(dir, known(), history);
    rmSync(join(dir, "a.jsonl"));

    const report = await gatherUsage(dir, known(), history, undefined, pushed);

    expect(report.warnings).toEqual([]);
    expect(report.issues[0]?.spend?.out).toBe(4200);
  });

  it("still warns about a missing directory while the history holds nothing", async () => {
    rmSync(dir, { recursive: true, force: true });

    const report = await gatherUsage(dir, known(), history, undefined, pushed);

    expect(report.warnings.map((w) => w.source)).toEqual([
      USAGE_WARNING_SOURCE.transcripts,
    ]);
  });

  it("still warns about a directory that exists and cannot be read", async () => {
    write("a.jsonl", [turn("a", "feat/101-a", 4200)]);
    await gatherUsage(dir, known(), history);
    // A file where the directory should be: not ENOENT, so not "none here".
    const notADir = join(dir, "a.jsonl");

    const report = await gatherUsage(
      notADir,
      known(),
      history,
      undefined,
      pushed,
    );

    expect(report.issues[0]?.spend?.out).toBe(4200);
    expect(report.warnings.map((w) => w.source)).toEqual([
      USAGE_WARNING_SOURCE.transcripts,
    ]);
  });
});

/**
 * Slice 4 of `docs/plans/usage-history.md` (#420): the history is a file the
 * developer can delete or damage, and neither costs the page. Deleted, the next
 * scan rebuilds it from the transcripts on disk; damaged, the scan reports what
 * the transcripts show and a warning of the history's own.
 */
describe("gatherUsage with a broken history (#420)", () => {
  let historyDir: string;
  let history: string;
  const JUNK = "this is not a SQLite database\n".repeat(8);

  beforeEach(() => {
    historyDir = mkdtempSync(join(tmpdir(), "usage-history-"));
    history = join(historyDir, "history.sqlite");
  });
  afterEach(() => {
    rmSync(historyDir, { recursive: true, force: true });
  });

  const stamped = (at: string, branch: string, out: number) =>
    JSON.stringify({
      sessionId: "a",
      gitBranch: branch,
      timestamp: at,
      message: { usage: { output_tokens: out } },
    });

  it("rebuilds a deleted history from the transcripts still on disk, its start date with it", async () => {
    write("old.jsonl", [
      stamped("2026-09-02T09:00:00.000Z", "feat/101-a", 1000),
    ]);
    write("new.jsonl", [
      stamped("2026-09-20T09:00:00.000Z", "fix/102-b", 2000),
    ]);
    await gatherUsage(dir, known(), history);

    rmSync(join(dir, "old.jsonl"));
    rmSync(history);
    const report = await gatherUsage(dir, known(), history);

    expect(report.warnings).toEqual([]);
    expect(report.historySince).toBe("2026-09-20T09:00:00.000Z");
    // Only what is on disk now: the deleted transcript's spend went with the
    // history that held it.
    expect(report.issues).toEqual((await gatherUsage(dir, known())).issues);
    expect(report.issues.map((r) => r.issue)).toEqual([102]);
  });

  it("reports the live figures and one warning of its own over an unreadable history", async () => {
    write("a.jsonl", [turn("a", "feat/101-a", 12_000), turn("a", "main", 500)]);
    writeFileSync(history, JUNK, "utf8");

    const report = await gatherUsage(dir, known(), history);
    const live = await gatherUsage(dir, known());

    expect(report.issues).toEqual(live.issues);
    expect(report.unattributed).toEqual(live.unattributed);
    expect(report.transcripts).toBe(1);
    expect(report.historySince).toBeNull();
    expect(report.trend).toEqual([]);
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]?.source).toBe(USAGE_WARNING_SOURCE.history);
    // It names the file and says what to do with it, because nothing else will.
    expect(report.warnings[0]?.message).toContain(history);
    expect(report.warnings[0]?.message).toMatch(/delete/i);
  });

  it("never writes over an unreadable history, and lets it go once it is deleted", async () => {
    write("a.jsonl", [turn("a", "feat/101-a", 12_000)]);
    writeFileSync(history, JUNK, "utf8");

    await gatherUsage(dir, known(), history);
    await gatherUsage(dir, known(), history);

    expect(readFileSync(history, "utf8")).toBe(JUNK);
    // Nothing still holds it, or Windows would refuse this.
    rmSync(history);
    const report = await gatherUsage(dir, known(), history);
    expect(report.warnings).toEqual([]);
    expect(report.issues[0]?.spend?.out).toBe(12_000);
  });

  it("stacks beside the other two sources rather than masking them", async () => {
    writeFileSync(history, JUNK, "utf8");
    rmSync(dir, { recursive: true, force: true });

    const report = await gatherUsage(dir, noListing(), history);

    expect(report.warnings.map((w) => w.source)).toEqual([
      USAGE_WARNING_SOURCE.transcripts,
      USAGE_WARNING_SOURCE.listing,
      USAGE_WARNING_SOURCE.history,
    ]);
  });

  it("treats a history it cannot open at all as unreadable too", async () => {
    // A directory where the file should be: SQLite cannot open it, junk or not.
    write("a.jsonl", [turn("a", "feat/101-a", 12_000)]);
    mkdirSync(history);

    const report = await gatherUsage(dir, known(), history);

    expect(report.issues[0]?.spend?.out).toBe(12_000);
    expect(report.warnings.map((w) => w.source)).toEqual([
      USAGE_WARNING_SOURCE.history,
    ]);
  });
});

/**
 * Slice 3 of `docs/plans/usage-history.md` (#419): the trend. One point per
 * local calendar day with a scan, the day's last scan replacing its point.
 * Playwright cannot move a day, so the day boundary and replace-not-append are
 * held here, with the clock handed in.
 */
describe("gatherUsage keeps a daily trend (#419)", () => {
  let historyDir: string;
  let history: string;
  const tz = process.env.TZ;

  beforeEach(() => {
    historyDir = mkdtempSync(join(tmpdir(), "usage-history-"));
    history = join(historyDir, "history.sqlite");
  });
  afterEach(() => {
    rmSync(historyDir, { recursive: true, force: true });
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  });

  const listing = () =>
    known({ 101: { forecast: "S" }, 102: { forecast: "S" } });
  const scanAt = (at: Date) => gatherUsage(dir, listing(), history, () => at);

  it("writes today's point from the figures the page's panels show", async () => {
    write("a.jsonl", [
      turn("a", "feat/101-a", 20_000),
      turn("a", "fix/102-b", 90_000),
    ]);

    const report = await scanAt(new Date(2026, 9, 4, 10));

    // The panels' own arithmetic over the report's rows.
    const { p25, p50, p75 } = percentiles(recordedSpend(report.issues));
    expect(report.trend).toEqual([
      {
        day: "2026-10-04",
        at: new Date(2026, 9, 4, 10).toISOString(),
        measured: 2,
        p25,
        median: p50,
        p75,
        scored: 2,
        onTarget: 1,
        edges: { S: BUCKETS.S.max, M: BUCKETS.M.max, L: BUCKETS.L.max },
      },
    ]);
    expect(report.gatheredAt).toBe(new Date(2026, 9, 4, 10).toISOString());
  });

  it("leaves one point for a day scanned twice, holding the second scan's figures", async () => {
    write("a.jsonl", [turn("a", "feat/101-a", 20_000)]);
    await scanAt(new Date(2026, 9, 4, 9));

    write("b.jsonl", [turn("b", "fix/102-b", 90_000)]);
    const second = await scanAt(new Date(2026, 9, 4, 18));

    expect(second.trend).toHaveLength(1);
    expect(second.trend[0]).toMatchObject({
      day: "2026-10-04",
      at: new Date(2026, 9, 4, 18).toISOString(),
      measured: 2,
      scored: 2,
      onTarget: 1,
    });
  });

  it("adds a point on a later day and leaves the earlier ones as they were", async () => {
    write("a.jsonl", [turn("a", "feat/101-a", 20_000)]);
    const first = await scanAt(new Date(2026, 9, 3, 22));

    write("b.jsonl", [turn("b", "fix/102-b", 90_000)]);
    const later = await scanAt(new Date(2026, 9, 4, 8));

    expect(later.trend.map((p) => p.day)).toEqual(["2026-10-03", "2026-10-04"]);
    expect(later.trend[0]).toEqual(first.trend[0]);
    expect(later.trend[1]).toMatchObject({ measured: 2, onTarget: 1 });
  });

  // Either side of the date line, two scans an hour apart share a UTC date and
  // straddle a local midnight, so a UTC day would leave one point where there
  // must be two. Node re-reads `TZ` when it is assigned.
  it.each([
    // UTC-10: 23:30 on the 4th, then 00:30 on the 5th.
    [
      "Pacific/Honolulu",
      "2026-10-05T09:30:00.000Z",
      "2026-10-05T10:30:00.000Z",
    ],
    // UTC+13 in October: the same two local times.
    [
      "Pacific/Auckland",
      "2026-10-04T10:30:00.000Z",
      "2026-10-04T11:30:00.000Z",
    ],
  ])(
    "splits days at local midnight, not UTC midnight (%s)",
    async (zone, before, after) => {
      process.env.TZ = zone;
      write("a.jsonl", [turn("a", "feat/101-a", 20_000)]);

      await scanAt(new Date(before));
      const report = await scanAt(new Date(after));

      expect(report.trend.map((p) => p.day)).toEqual([
        "2026-10-04",
        "2026-10-05",
      ]);
    },
  );

  it("keeps no trend when it was asked to keep no history", async () => {
    write("a.jsonl", [turn("a", "feat/101-a", 20_000)]);

    expect((await gatherUsage(dir, listing())).trend).toEqual([]);
  });
});

/**
 * Slice 2 of `docs/plans/usage-history.md` (#418): a scan reads only what was
 * written since the last one. The store remembers per transcript how far it has
 * read; what these hold is that the figures come out as a full re-read would
 * have made them, whatever happened to the file in between.
 *
 * Lines are written newline-terminated here, as Claude Code writes them, unlike
 * `write` above — an unterminated last line is a case of its own below.
 */
describe("gatherUsage reads only what is new (#418)", () => {
  let historyDir: string;
  let history: string;

  beforeEach(() => {
    historyDir = mkdtempSync(join(tmpdir(), "usage-history-"));
    history = join(historyDir, "history.sqlite");
  });
  afterEach(() => {
    rmSync(historyDir, { recursive: true, force: true });
  });

  const lines = (...records: string[]) => records.map((r) => `${r}\n`).join("");
  const put = (name: string, text: string) =>
    writeFileSync(join(dir, name), text, "utf8");
  const append = (name: string, text: string) =>
    appendFileSync(join(dir, name), text, "utf8");
  const spendOf = async (issue: number) =>
    (await gatherUsage(dir, known(), history)).issues.find(
      (row) => row.issue === issue,
    )?.spend;

  it("adds exactly an appended response's tokens and one turn", async () => {
    put("a.jsonl", lines(turn("a", "feat/101-a", 1000, 10_000, "msg_1")));
    await gatherUsage(dir, known(), history);

    append("a.jsonl", lines(turn("a", "feat/101-a", 250, 4000, "msg_2")));

    expect(await spendOf(101)).toEqual({
      out: 1250,
      turns: 2,
      sessions: 1,
      cacheRead: 14_000,
    });
  });

  // #413's rule across two reads: the second block of a response arrives after
  // the scan that stored its first, so only the store can recognise it.
  it("adds nothing for a second content block of a response already stored", async () => {
    put("a.jsonl", lines(turn("a", "feat/101-a", 1000, 10_000, "msg_1")));
    await gatherUsage(dir, known(), history);

    append("a.jsonl", lines(turn("a", "feat/101-a", 1000, 10_000, "msg_1")));

    expect(await spendOf(101)).toEqual({
      out: 1000,
      turns: 1,
      sessions: 1,
      cacheRead: 10_000,
    });
  });

  it("counts a half-written last line once, on the scan after it is completed", async () => {
    const second = turn("a", "feat/101-a", 300, 0, "msg_2");
    const cut = Math.floor(second.length / 2);
    put(
      "a.jsonl",
      lines(turn("a", "feat/101-a", 1000, 0, "msg_1")) + second.slice(0, cut),
    );
    expect((await spendOf(101))?.out).toBe(1000);

    append("a.jsonl", `${second.slice(cut)}\n`);

    expect((await spendOf(101))?.out).toBe(1300);
    expect((await spendOf(101))?.turns).toBe(2);
  });

  // The same, for a record with no identity of its own: it is keyed on its file
  // and line, so the line has to keep its number when it is read again.
  it("counts a complete but unterminated last line once, even keyed on its line", async () => {
    put(
      "a.jsonl",
      `${turn("a", "feat/101-a", 1000)}\n${turn("a", "feat/101-a", 7)}`,
    );
    expect((await spendOf(101))?.out).toBe(1007);

    append("a.jsonl", `\n${turn("a", "feat/101-a", 20)}\n`);

    expect(await spendOf(101)).toMatchObject({ out: 1027, turns: 3 });
  });

  it("re-reads a transcript replaced by a shorter one, without double counting", async () => {
    const padded = (id: string, out: number) =>
      JSON.stringify({
        sessionId: "a",
        gitBranch: "feat/101-a",
        padding: "x".repeat(400),
        message: { id, usage: { output_tokens: out } },
      });
    put("a.jsonl", lines(padded("msg_1", 100), padded("msg_2", 20)));
    await gatherUsage(dir, known(), history);

    // msg_1 again, and a response the old file never held, in fewer bytes.
    put(
      "a.jsonl",
      lines(
        turn("a", "feat/101-a", 100, 0, "msg_1"),
        turn("a", "feat/101-a", 3, 0, "msg_3"),
      ),
    );

    expect(await spendOf(101)).toMatchObject({ out: 123, turns: 3 });
  });

  it("re-reads a transcript replaced by a longer one that does not begin the same way", async () => {
    put("a.jsonl", lines(turn("a", "feat/101-a", 100, 0, "msg_1")));
    await gatherUsage(dir, known(), history);

    put(
      "a.jsonl",
      lines(
        turn("b", "feat/101-a", 5, 0, "msg_5"),
        turn("b", "feat/101-a", 40, 0, "msg_6"),
        turn("b", "feat/101-a", 100, 0, "msg_1"),
      ),
    );

    expect(await spendOf(101)).toMatchObject({ out: 145, turns: 3 });
  });

  it("agrees with a reading that keeps no history, after any number of appends", async () => {
    put("a.jsonl", lines(turn("a", "feat/101-a", 1, 0, "msg_1")));
    put("b.jsonl", lines(turn("b", "main", 2)));
    await gatherUsage(dir, known(), history);
    append("a.jsonl", lines(turn("a", "fix/102-b", 30, 5, "msg_2")));
    await gatherUsage(dir, known(), history);
    append(
      "b.jsonl",
      lines(turn("b", "main", 400), turn("b", "feat/101-a", 5000)),
    );
    append("a.jsonl", lines(turn("a", "fix/102-b", 30, 5, "msg_2")));

    const incremental = await gatherUsage(dir, known(), history);
    const full = await gatherUsage(dir, known());

    expect(incremental.issues).toEqual(full.issues);
    expect(incremental.unattributed).toEqual(full.unattributed);
  });

  // #431: a history scanned before subagent transcripts were read gains their
  // rows on the next scan, once, and keeps the top-level rows it already held.
  it("adds a subagent transcript's rows to an existing history once", async () => {
    put("s1.jsonl", lines(turn("s1", "feat/101-a", 100, 0, "msg_1")));
    await gatherUsage(dir, known(), history);

    mkdirSync(join(dir, "s1", "subagents"), { recursive: true });
    put(
      join("s1", "subagents", "agent-x.jsonl"),
      lines(
        turn("s1", "feat/101-a", 100, 0, "msg_1"),
        turn("s1", "feat/101-a", 40, 0, "msg_2"),
      ),
    );

    expect(await spendOf(101)).toMatchObject({ out: 140, turns: 2 });
    expect(await spendOf(101)).toMatchObject({ out: 140, turns: 2 });
  });

  // A subagent still running when a scan stores its response's first block,
  // with a partial count, finishes the response in a block the next scan reads.
  it("takes a response's final count from a block appended after the scan that stored its first", async () => {
    mkdirSync(join(dir, "s1", "subagents"), { recursive: true });
    const agent = join("s1", "subagents", "agent-x.jsonl");
    put(agent, lines(turn("s1", "feat/101-a", 3, 0, "msg_1")));
    expect((await spendOf(101))?.out).toBe(3);

    append(agent, lines(turn("s1", "feat/101-a", 120, 0, "msg_1")));

    expect(await spendOf(101)).toMatchObject({ out: 120, turns: 1 });
  });
});

describe("readTranscripts with cursors (#418)", () => {
  it("reads nothing from a file that has not changed since its cursor", () => {
    writeFileSync(join(dir, "a.jsonl"), `${turn("a", "feat/101-a", 9)}\n`);
    const first = readTranscripts(dir);

    const second = readTranscripts(dir, first.cursors);

    expect(first.responses).toHaveLength(1);
    expect(second.responses).toEqual([]);
    expect(second.transcripts).toBe(1);
    expect(second.cursors).toEqual(first.cursors);
  });

  it("holds its place before a line that has no newline yet", () => {
    const done = `${turn("a", "feat/101-a", 9)}\n`;
    writeFileSync(join(dir, "a.jsonl"), `${done}{"sessionId":"a","gitBr`);

    const [cursor] = readTranscripts(dir).cursors.values();

    expect(cursor).toMatchObject({ offset: Buffer.byteLength(done), lines: 1 });
  });
});

// #431: Claude Code writes a subagent's transcript beside its session, at
// `<session>/subagents/agent-<id>.jsonl`, stamped with the same `gitBranch`.
describe("readTranscripts over subagent transcripts (#431)", () => {
  const subagent = (session: string, name: string, lines: string[]) => {
    const at = join(dir, session, "subagents");
    mkdirSync(at, { recursive: true });
    writeFileSync(join(at, name), `${lines.join("\n")}\n`, "utf8");
  };

  it("attributes a subagent's responses to the issue its branch names", () => {
    write("s1.jsonl", [turn("s1", "feat/101-a", 100, 0, "msg_1")]);
    subagent("s1", "agent-x.jsonl", [
      turn("s1", "feat/101-a", 40, 400, "msg_2"),
      turn("s1", "feat/101-a", 2, 0, "msg_3"),
    ]);

    const scan = scanSpend(dir);

    expect(scan.byIssue.get(101)).toEqual({
      turns: 3,
      out: 142,
      cacheRead: 400,
      sessions: 1,
    });
    expect(scan.transcripts).toBe(2);
  });

  // Measured 2026-10-07: in subagent transcripts 1,705 of 2,855 multi-record
  // responses carried a partial `output_tokens` on their first record and the
  // final count on their last — 177k against 1.41M summed. Top-level records
  // never differed, which is why #413 could keep the first.
  it("keeps the largest output count of a response whose records disagree", () => {
    subagent("s1", "agent-x.jsonl", [
      turn("s1", "feat/101-a", 3, 400, "msg_1"),
      turn("s1", "feat/101-a", 120, 400, "msg_1"),
    ]);

    expect(scanSpend(dir).byIssue.get(101)).toEqual({
      turns: 1,
      out: 120,
      cacheRead: 400,
      sessions: 1,
    });
  });

  it("counts a response that appears in both places once", () => {
    write("s1.jsonl", [turn("s1", "feat/101-a", 100, 0, "msg_1")]);
    subagent("s1", "agent-x.jsonl", [
      turn("s1", "feat/101-a", 100, 0, "msg_1"),
    ]);

    expect(scanSpend(dir).byIssue.get(101)).toMatchObject({
      turns: 1,
      out: 100,
    });
  });

  it("reads no subagent bytes on a second scan with no file changes", () => {
    subagent("s1", "agent-x.jsonl", [turn("s1", "feat/101-a", 9, 0, "msg_1")]);
    const first = readTranscripts(dir);

    const second = readTranscripts(dir, first.cursors);

    expect(first.responses).toHaveLength(1);
    expect([...first.cursors.keys()]).toEqual([
      join(dir, "s1", "subagents", "agent-x.jsonl"),
    ]);
    expect(second.responses).toEqual([]);
    expect(second.transcripts).toBe(1);
    expect(second.cursors).toEqual(first.cursors);
  });

  it("reads neither .meta.json files nor directories other than subagents/", () => {
    subagent("s1", "agent-x.jsonl", [turn("s1", "feat/101-a", 1)]);
    writeFileSync(
      join(dir, "s1", "subagents", "agent-x.meta.json"),
      turn("s1", "feat/102-b", 1000),
      "utf8",
    );
    for (const nested of [
      join("s1", "tool-results"),
      join("s1", "subagents", "deeper"),
    ]) {
      mkdirSync(join(dir, nested), { recursive: true });
      writeFileSync(
        join(dir, nested, "other.jsonl"),
        turn("s1", "feat/103-c", 1000),
        "utf8",
      );
    }

    const scan = scanSpend(dir);

    expect([...scan.byIssue.keys()]).toEqual([101]);
    expect(scan.transcripts).toBe(1);
  });

  // A record with no identity of its own is keyed on its file and line, so a
  // subagent file must not share a key with a top-level file of the same name.
  it("keys a subagent record with no id on its path under the directory", () => {
    write("agent-x.jsonl", [turn("s1", "feat/101-a", 1)]);
    subagent("s1", "agent-x.jsonl", [turn("s1", "feat/101-a", 2)]);

    expect(
      readTranscripts(dir)
        .responses.map((r) => r.id)
        .sort(),
    ).toEqual(["line:agent-x.jsonl:1", "line:s1/subagents/agent-x.jsonl:1"]);
  });
});
