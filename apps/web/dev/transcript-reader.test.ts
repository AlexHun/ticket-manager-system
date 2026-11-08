import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readAppended,
  readTranscripts,
  type TranscriptCursors,
} from "./transcript-reader.ts";

/**
 * The transcript reader (#748) over a directory written per test: what a
 * resumed read picks up after an append, a replaced file, a line still being
 * written, a subagent's partial first block, and records with no id.
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "transcript-reader-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** One record with usage, as Claude Code writes a response's block. */
const record = (
  out: number,
  { id, uuid }: { id?: string; uuid?: string } = {},
) =>
  JSON.stringify({
    sessionId: "s1",
    gitBranch: "feat/101-a",
    ...(uuid ? { uuid } : {}),
    message: { ...(id ? { id } : {}), usage: { output_tokens: out } },
  });

const lines = (...recs: string[]) => recs.map((r) => `${r}\n`).join("");

const put = (file: string, text: string) => {
  mkdirSync(join(dir, file, ".."), { recursive: true });
  writeFileSync(join(dir, file), text, "utf8");
};

/** Moves a file's modification time, as a write in the same millisecond
 *  might not. */
const touch = (file: string, seconds: number) =>
  utimesSync(join(dir, file), seconds, seconds);

const idsAndOut = (cursors?: TranscriptCursors) => {
  const read = readTranscripts(dir, cursors);
  return {
    read,
    got: read.responses.map(({ id, out }) => [id, out]),
  };
};

describe("readTranscripts, resumed", () => {
  it("reads only the lines appended since its cursor", () => {
    put("a.jsonl", lines(record(5, { id: "m1" })));
    const first = readTranscripts(dir);

    appendFileSync(join(dir, "a.jsonl"), lines(record(7, { id: "m2" })));
    const { got } = idsAndOut(first.cursors);

    expect(first.responses.map((r) => r.id)).toEqual(["message:m1"]);
    expect(got).toEqual([["message:m2", 7]]);
  });

  it("reads nothing from a file whose size and modification time are its cursor's", () => {
    put("a.jsonl", lines(record(5, { id: "m1" })));
    const first = readTranscripts(dir);

    const { read, got } = idsAndOut(first.cursors);

    expect(first.responses).toHaveLength(1);
    expect(got).toEqual([]);
    expect(read.cursors).toEqual(first.cursors);
  });

  it("reads a file replaced by another from the top, numbering its lines afresh", () => {
    put("a.jsonl", lines(record(5), record(6)));
    const first = readTranscripts(dir);

    // Longer than the first, so a size check alone would resume mid-file.
    put("a.jsonl", lines(record(70), record(80), record(90)));
    const { got } = idsAndOut(first.cursors);

    expect(got).toEqual([
      ["line:a.jsonl:1", 70],
      ["line:a.jsonl:2", 80],
      ["line:a.jsonl:3", 90],
    ]);
  });

  // The rule the Sessions reader used and the Usage scan did not: a file of
  // the same length but rewritten is told apart by its modification time and
  // the bytes before the cursor.
  it("notices a file replaced by another of the same length", () => {
    put("a.jsonl", lines(record(5, { id: "m1" })));
    touch("a.jsonl", 1_000);
    const first = readTranscripts(dir);

    put("a.jsonl", lines(record(6, { id: "m2" })));
    touch("a.jsonl", 2_000);
    const { got } = idsAndOut(first.cursors);

    expect(got).toEqual([["message:m2", 6]]);
  });

  it("resumes from the cursor when only the modification time moved", () => {
    put("a.jsonl", lines(record(5, { id: "m1" })));
    touch("a.jsonl", 1_000);
    const first = readTranscripts(dir);

    touch("a.jsonl", 2_000);
    const { read, got } = idsAndOut(first.cursors);

    expect(got).toEqual([]);
    expect([...read.cursors.values()][0]).toMatchObject({
      offset: [...first.cursors.values()][0]!.offset,
      mtimeMs: 2_000_000,
    });
  });
});

describe("readTranscripts, a line still being written", () => {
  it("counts a complete unterminated line, keeps its cursor in front of it, and counts it once when it ends", () => {
    const done = lines(record(5, { id: "m1" }));
    put("a.jsonl", `${done}${record(9, { id: "m2" })}`);
    const first = readTranscripts(dir);

    appendFileSync(join(dir, "a.jsonl"), "\n");
    const second = readTranscripts(dir, first.cursors);

    expect(first.responses.map((r) => r.id)).toEqual([
      "message:m1",
      "message:m2",
    ]);
    expect([...first.cursors.values()][0]).toMatchObject({
      offset: Buffer.byteLength(done),
      lines: 1,
    });
    expect(second.responses.map((r) => r.id)).toEqual(["message:m2"]);
  });

  it("skips a half-written line and reads it once it is finished", () => {
    const whole = record(9, { id: "m2" });
    put("a.jsonl", `${lines(record(5, { id: "m1" }))}${whole.slice(0, 20)}`);
    const first = readTranscripts(dir);

    appendFileSync(join(dir, "a.jsonl"), `${whole.slice(20)}\n`);
    const { got } = idsAndOut(first.cursors);

    expect(first.responses.map((r) => r.id)).toEqual(["message:m1"]);
    expect(got).toEqual([["message:m2", 9]]);
  });

  it("numbers an unterminated line with no id after the lines before it", () => {
    put("a.jsonl", `${lines(record(5))}${record(9)}`);

    const { got } = idsAndOut();

    expect(got).toEqual([
      ["line:a.jsonl:1", 5],
      ["line:a.jsonl:2", 9],
    ]);
  });
});

describe("readTranscripts, subagents", () => {
  const agent = "s1/subagents/agent-x.jsonl";

  it("keeps a response's largest count when its first block carried a partial one", () => {
    put(agent, lines(record(3, { id: "m1" }), record(120, { id: "m1" })));

    const { got } = idsAndOut();

    expect(got).toEqual([["message:m1", 120]]);
  });

  it("reads a final block appended after a read that took the partial first", () => {
    put(agent, lines(record(3, { id: "m1" })));
    const first = readTranscripts(dir);

    appendFileSync(join(dir, agent), lines(record(120, { id: "m1" })));
    const { got } = idsAndOut(first.cursors);

    expect(first.responses.map(({ out }) => out)).toEqual([3]);
    expect(got).toEqual([["message:m1", 120]]);
  });
});

describe("readTranscripts, records without an id", () => {
  it("keys each on its uuid, else on its file below the directory and its line", () => {
    put("s1.jsonl", lines(record(1), record(2, { uuid: "u1" })));
    put("s1/subagents/s1.jsonl", lines(record(3)));

    const { got } = idsAndOut();

    // In the order the directory lists them, which is the platform's.
    expect(new Map(got as [string, number][])).toEqual(
      new Map([
        ["line:s1.jsonl:1", 1],
        ["uuid:u1", 2],
        ["line:s1/subagents/s1.jsonl:1", 3],
      ]),
    );
  });

  it("keeps each line's number when a read resumes", () => {
    put("a.jsonl", lines(record(1), record(2)));
    const first = readTranscripts(dir);

    appendFileSync(join(dir, "a.jsonl"), lines(record(3)));
    const { got } = idsAndOut(first.cursors);

    expect(got).toEqual([["line:a.jsonl:3", 3]]);
  });
});

describe("readAppended", () => {
  it("says whether a read began at the top of the file", () => {
    put("a.jsonl", lines(record(1)));
    const path = join(dir, "a.jsonl");
    const first = readAppended(path)!;

    appendFileSync(path, lines(record(2)));
    const grown = readAppended(path, first.cursor)!;
    put("a.jsonl", lines(record(30), record(40)));
    const replaced = readAppended(path, grown.cursor)!;

    expect([first.fromTop, grown.fromTop, replaced.fromTop]).toEqual([
      true,
      false,
      true,
    ]);
    expect(grown.lines).toEqual([{ text: record(2), number: 2 }]);
  });
});
