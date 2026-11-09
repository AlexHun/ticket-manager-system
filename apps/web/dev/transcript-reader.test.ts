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
  foldResponses,
  followTranscript,
  readAppended,
  readTranscripts,
  type FollowedTranscript,
  type RecordHook,
  type TranscriptCursors,
} from "./transcript-reader.ts";

/**
 * The transcript reader (#748) over a directory written per test: what a
 * resumed read picks up after an append, a replaced file, a line still being
 * written, a subagent's partial first block, and records with no id; and,
 * since #749, one transcript followed with a hook, as the Sessions page reads.
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

  // Rewritten to the same length and modification time, so only a read that
  // never opened the file can miss the new record.
  it("does not open a file whose size and modification time are its cursor's", () => {
    put("a.jsonl", lines(record(5, { id: "m1" })));
    touch("a.jsonl", 1_000);
    const first = readTranscripts(dir);

    put("a.jsonl", lines(record(6, { id: "m2" })));
    touch("a.jsonl", 1_000);
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

// The identity a response is stored under (#417), and so counted once under
// across every later scan: the response's id, then the record's uuid, then
// where the record sits.
describe("readTranscripts, one row per response", () => {
  it("keeps a response written as several records once, under its first record's session, branch and time", () => {
    put(
      "a.jsonl",
      lines(
        JSON.stringify({
          sessionId: "s1",
          gitBranch: "feat/101-a",
          timestamp: "2026-09-02T09:00:00.000Z",
          message: { id: "m1", usage: { output_tokens: 4 } },
        }),
        JSON.stringify({
          sessionId: "s2",
          gitBranch: "main",
          timestamp: "2026-09-02T09:01:00.000Z",
          message: { id: "m1", usage: { output_tokens: 4 } },
        }),
      ),
    );

    expect(readTranscripts(dir).responses).toEqual([
      expect.objectContaining({
        id: "message:m1",
        session: "s1",
        branch: "feat/101-a",
        at: "2026-09-02T09:00:00.000Z",
        out: 4,
      }),
    ]);
  });

  it("identifies a response by its message id, then its uuid, then its file and line", () => {
    put(
      "a.jsonl",
      lines(record(1, { id: "m1" }), record(2, { uuid: "u2" }), record(3)),
    );

    expect(readTranscripts(dir).responses.map((r) => r.id)).toEqual([
      "message:m1",
      "uuid:u2",
      "line:a.jsonl:3",
    ]);
  });

  it("carries what a stored row needs: session, branch, timestamp, both token counts, its context and its window", () => {
    put(
      "s1.jsonl",
      lines(
        JSON.stringify({
          sessionId: "s1",
          gitBranch: "feat/101-a",
          timestamp: "2026-09-02T09:00:00.000Z",
          message: {
            id: "msg_1",
            usage: {
              input_tokens: 3,
              cache_creation_input_tokens: 5_000,
              cache_read_input_tokens: 340,
              output_tokens: 12,
            },
          },
        }),
      ),
    );

    expect(readTranscripts(dir).responses).toEqual([
      {
        id: "message:msg_1",
        session: "s1",
        branch: "feat/101-a",
        at: "2026-09-02T09:00:00.000Z",
        out: 12,
        cacheRead: 340,
        context: 5_355,
        window: "s1.jsonl",
      },
    ]);
  });

  it("keeps a response's largest context across its records, as it keeps its largest output", () => {
    const withContext = (cacheRead: number, out: number) =>
      JSON.stringify({
        message: {
          id: "m1",
          usage: { cache_read_input_tokens: cacheRead, output_tokens: out },
        },
      });
    // A subagent's first record carries partial counts (#431).
    put("a.jsonl", lines(withContext(1_000, 2), withContext(1_000, 400)));

    expect(readTranscripts(dir).responses[0]?.context).toBe(1_400);
  });

  // #642: a session's subagents share its `sessionId`, so the file is the only
  // thing that tells their windows apart.
  it("names a subagent's window by its path under the session", () => {
    put("s1.jsonl", lines(record(1, { id: "m1" })));
    put("s1/subagents/agent-a.jsonl", lines(record(2, { id: "m2" })));

    // Keyed rather than listed: the directory's order is the filesystem's.
    expect(
      Object.fromEntries(
        readTranscripts(dir).responses.map(({ id, window }) => [id, window]),
      ),
    ).toEqual({
      "message:m1": "s1.jsonl",
      "message:m2": "s1/subagents/agent-a.jsonl",
    });
  });

  it("counts a response found in a session and in its subagent's transcript once", () => {
    put("s1.jsonl", lines(record(100, { id: "m1" })));
    put("s1/subagents/agent-x.jsonl", lines(record(100, { id: "m1" })));

    expect(idsAndOut().got).toEqual([["message:m1", 100]]);
  });

  it("reads neither .meta.json files nor directories other than subagents/", () => {
    put("s1/subagents/agent-x.jsonl", lines(record(1, { id: "m1" })));
    put("s1/subagents/agent-x.meta.json", lines(record(2, { id: "m2" })));
    put("s1/tool-results/other.jsonl", lines(record(3, { id: "m3" })));
    put("s1/subagents/deeper/other.jsonl", lines(record(4, { id: "m4" })));

    const read = readTranscripts(dir);

    expect(read.responses.map((r) => r.id)).toEqual(["message:m1"]);
    expect(read.transcripts).toBe(1);
  });
});

/** What the test hook keeps: every record's `sessionId`, in order. */
const sessionsHook: RecordHook<string[]> = {
  start: () => [],
  copy: (seen) => [...seen],
  record: (seen, rec) => {
    seen.push(String((rec as { sessionId?: unknown }).sessionId));
  },
};

/** One record, with or without usage, from session `session`. */
const said = (session: string, out?: number, id?: string) =>
  JSON.stringify({
    sessionId: session,
    ...(out === undefined
      ? {}
      : { message: { ...(id ? { id } : {}), usage: { output_tokens: out } } }),
  });

describe("followTranscript", () => {
  const follow = (prior?: FollowedTranscript<string[]>) =>
    followTranscript(join(dir, "a.jsonl"), "a.jsonl", sessionsHook, prior);

  it("hands the hook every record, usage or none, and folds the responses itself", async () => {
    put(
      "a.jsonl",
      lines(said("p"), said("r1", 3, "m1"), "not json", said("r2", 90, "m1")),
    );

    const { reading } = await follow();

    expect(reading.facts).toEqual(["p", "r1", "r2"]);
    expect(reading.responses.map(({ id, out }) => [id, out])).toEqual([
      ["message:m1", 90],
    ]);
    expect(reading.badLines).toBe(1);
  });

  it("goes on from its cursor with the hook's state, and starts it afresh on a replaced file", async () => {
    put("a.jsonl", lines(said("one", 1, "m1")));
    const first = await follow();

    appendFileSync(join(dir, "a.jsonl"), lines(said("two", 2, "m2")));
    const grown = await follow(first.followed);
    // Longer than before, and different from the top.
    put("a.jsonl", lines(said("three", 3, "m3"), said("four", 4, "m4")));
    const replaced = await follow(grown.followed);

    expect(grown.reading.facts).toEqual(["one", "two"]);
    expect(grown.reading.responses.map((r) => r.id)).toEqual([
      "message:m1",
      "message:m2",
    ]);
    expect(replaced.reading.facts).toEqual(["three", "four"]);
    expect(replaced.reading.responses.map((r) => r.id)).toEqual([
      "message:m3",
      "message:m4",
    ]);
  });

  it("answers the same reading without opening a file whose size and modification time are its cursor's", async () => {
    put("a.jsonl", lines(said("one", 1, "m1")));
    touch("a.jsonl", 1_000);
    const first = await follow();

    put("a.jsonl", lines(said("two", 2, "m2")));
    touch("a.jsonl", 1_000);
    const second = await follow(first.followed);

    expect(second.reading).toEqual(first.reading);
    expect(second.reading.facts).toEqual(["one"]);
  });

  it("counts a complete unterminated record on a copy, and once when its newline arrives", async () => {
    put("a.jsonl", `${lines(said("one", 1))}${said("two", 2)}`);
    const first = await follow();
    // Copied now: the next read goes on writing to the state it is handed.
    const kept = [...first.followed.state];

    appendFileSync(join(dir, "a.jsonl"), "\n");
    const second = await follow(first.followed);

    expect(first.reading.facts).toEqual(["one", "two"]);
    expect(kept).toEqual(["one"]);
    expect(first.reading.responses.map((r) => r.id)).toEqual([
      "line:a.jsonl:1",
      "line:a.jsonl:2",
    ]);
    expect(second.reading).toEqual(first.reading);
  });

  it("never counts a half-written last line as one it could not read", async () => {
    put("a.jsonl", `${lines(said("one", 1))}{"sessionId":"tw`);

    const { reading } = await follow();

    expect(reading.facts).toEqual(["one"]);
    expect(reading.badLines).toBe(0);
  });
});

describe("foldResponses", () => {
  const response = (id: string, out: number, branch: string) => ({
    id,
    session: "s",
    branch,
    at: null,
    out,
    cacheRead: 0,
    context: null,
    window: null,
  });

  it("keeps each response once, at the largest count any list carries, held by the first list that has it", () => {
    const { responses, firstHeldBy } = foldResponses([
      ["a", [response("m1", 3, "feat/1-a"), response("m2", 5, "feat/1-a")]],
      ["b", [response("m1", 120, "main"), response("m3", 7, "main")]],
    ]);

    expect(responses).toEqual([
      response("m1", 120, "feat/1-a"),
      response("m2", 5, "feat/1-a"),
      response("m3", 7, "main"),
    ]);
    expect(Object.fromEntries(firstHeldBy)).toEqual({
      m1: "a",
      m2: "a",
      m3: "b",
    });
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

  it("reads from the top after a cursor that had read no complete line", () => {
    const path = join(dir, "a.jsonl");
    put("a.jsonl", record(1).slice(0, 10));
    const first = readAppended(path)!;

    put("a.jsonl", lines(record(2)));
    const second = readAppended(path, first.cursor)!;

    expect(first.cursor.offset).toBe(0);
    expect(second.fromTop).toBe(true);
    expect(second.lines).toEqual([{ text: record(2), number: 1 }]);
  });
});
