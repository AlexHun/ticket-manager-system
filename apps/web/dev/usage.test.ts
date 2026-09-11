import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BUCKETS,
  TRANSCRIPT_DIR_ENV,
  bucketFor,
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
