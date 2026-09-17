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
} from "./usage.ts";

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

  it("counts turns on main and on no branch as unattributed", () => {
    write("s1.jsonl", [
      turn("s1", "main", 100),
      turn("s1", "", 30),
      turn("s1", "feat/101-a", 10),
    ]);

    const { byIssue, unattributed } = scanSpend(dir);

    expect(unattributed).toBe(2);
    expect([...byIssue.keys()]).toEqual([101]);
    expect(byIssue.get(101)?.out).toBe(10);
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

  it("drops a branch that names no issue", () => {
    write("s1.jsonl", [turn("s1", "chore/tidy-up", 100)]);

    expect(scanSpend(dir).byIssue.size).toBe(0);
    expect(scanSpend(dir).unattributed).toBe(0);
  });
});

describe("gatherUsage", () => {
  it("reports one row per issue, output tokens descending", () => {
    write("s1.jsonl", [
      turn("s1", "fix/102-b", 3000, 20_000),
      turn("s1", "feat/101-a", 12_000, 300_000),
      turn("s2", "feat/101-a", 8000, 100_000),
    ]);

    const report = gatherUsage(dir);

    expect(report.issues).toEqual([
      { issue: 101, out: 20_000, turns: 2, sessions: 2, cacheRead: 400_000 },
      { issue: 102, out: 3000, turns: 1, sessions: 1, cacheRead: 20_000 },
    ]);
    expect(report.transcriptDir).toBe(dir);
    expect(report.transcripts).toBe(1);
    expect(report.warnings).toEqual([]);
  });

  // Ties are not hypothetical: two issues that both spent nothing attributable
  // sort equal on `out`, and an unstable order would make the page's rows jump
  // between two scans of an unchanged directory.
  it("breaks a tie on the issue number, so two scans agree", () => {
    write("s1.jsonl", [
      turn("s1", "feat/202-b", 500),
      turn("s1", "feat/101-a", 500),
    ]);

    expect(gatherUsage(dir).issues.map((row) => row.issue)).toEqual([101, 202]);
  });

  it("stamps the reading with when it was gathered", () => {
    write("s1.jsonl", [turn("s1", "feat/101-a", 10)]);
    const before = Date.now();

    const { gatheredAt, scanMs } = gatherUsage(dir);

    expect(Date.parse(gatheredAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(gatheredAt)).toBeLessThanOrEqual(Date.now());
    expect(scanMs).toBeGreaterThanOrEqual(0);
  });

  // The ordinary state of a machine that has never run Claude Code here, and of
  // CI. A 500 from the middleware would read as the page being broken.
  it("warns rather than throwing when the directory is not there", () => {
    const missing = join(dir, "nope");

    const report = gatherUsage(missing);

    expect(report.issues).toEqual([]);
    expect(report.transcripts).toBe(0);
    expect(report.transcriptDir).toBe(missing);
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toContain(missing);
  });

  it("says so when the directory holds no transcripts", () => {
    write("notes.txt", ["nothing to see"]);

    const report = gatherUsage(dir);

    expect(report.issues).toEqual([]);
    expect(report.transcripts).toBe(0);
    expect(report.warnings[0]).toContain(".jsonl");
  });

  // R8: the page and `bun run tokens` read the same join, so a row here is the
  // same row the terminal prints.
  it("carries the same figures as scanSpend", () => {
    write("s1.jsonl", [
      turn("s1", "feat/101-a", 12_000, 300_000),
      turn("s1", "main", 5000, 50_000),
    ]);

    const [row] = gatherUsage(dir).issues;
    const spend = scanSpend(dir).byIssue.get(101);

    expect(row).toEqual({ issue: 101, ...spend });
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
