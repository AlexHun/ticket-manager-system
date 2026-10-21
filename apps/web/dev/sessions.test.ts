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
import { basename, join } from "node:path";
import { createSessionsReader, readSessions } from "./sessions.ts";
import { scanSpend } from "./transcripts.ts";
import {
  SESSION_IDLE_MS,
  SESSION_STATE,
  type SessionCard,
  type SessionSlice,
  type SessionsReport,
} from "../src/dev/sessions-protocol.ts";

/**
 * Slice 1 of `docs/plans/dev-tools-sessions-page.md` (#590): the tree.
 *
 * Every case writes its own transcript directory, in the layout Claude Code
 * keeps: `<session>.jsonl` at the top, and the session's subagents at
 * `<session>/subagents/agent-<id>.jsonl` beside `agent-<id>.meta.json`. The
 * E2E fixture (`tests/e2e/fixtures/transcripts`) is the same layout, read
 * through the page.
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sessions-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const lines = (...records: unknown[]) =>
  records.map((r) => JSON.stringify(r)).join("\n") + "\n";

const prompt = (text: unknown, at: string, extra: object = {}) => ({
  type: "user",
  timestamp: at,
  message: { role: "user", content: text },
  ...extra,
});

/** One response record. `calls` are the `tool_use` ids it makes. */
const response = (
  out: number,
  at: string,
  {
    id,
    model = "claude-opus-5-5",
    calls = [],
    stop,
  }: { id?: string; model?: string; calls?: string[]; stop?: string } = {},
) => ({
  type: "assistant",
  timestamp: at,
  message: {
    ...(id ? { id } : {}),
    model,
    ...(stop ? { stop_reason: stop } : {}),
    content: calls.map((call) => ({
      type: "tool_use",
      id: call,
      name: "Agent",
      input: {},
    })),
    usage: { output_tokens: out },
  },
});

function session(id: string, ...records: unknown[]) {
  writeFileSync(join(dir, `${id}.jsonl`), lines(...records), "utf8");
}

function subagent(
  sessionId: string,
  agentId: string,
  meta: object | string,
  ...records: unknown[]
) {
  const sub = join(dir, sessionId, "subagents");
  mkdirSync(sub, { recursive: true });
  writeFileSync(
    join(sub, `agent-${agentId}.meta.json`),
    typeof meta === "string" ? meta : JSON.stringify(meta),
    "utf8",
  );
  if (records.length > 0) {
    writeFileSync(
      join(sub, `agent-${agentId}.jsonl`),
      lines(...records),
      "utf8",
    );
  }
}

const T = (minute: number, second = 0) =>
  `2026-09-02T09:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}.000Z`;

/** The card ids under `card`, depth first, indented by depth. */
const shape = (cards: SessionCard[], depth = 0): string[] =>
  cards.flatMap((c) => [
    `${"  ".repeat(depth)}${c.id}`,
    ...shape(c.children, depth + 1),
  ]);

/** A card's own output tokens, summed over every group it is in (#593). */
const ownOut = (report: SessionsReport, id: string): number => {
  const sum = (slices: SessionSlice[]): number =>
    slices.reduce((n, s) => n + (s.id === id ? s.out : 0) + sum(s.children), 0);
  return report.groups.reduce((n, g) => n + sum(g.sessions), 0);
};

describe("readSessions", () => {
  it("nests each subagent under the call that started it, at every depth", async () => {
    session(
      "s",
      prompt("Implement issue #101.\nThen stop.", T(0)),
      response(1000, T(1), { calls: ["toolu_top"] }),
    );
    subagent(
      "s",
      "a1",
      {
        agentType: "general-purpose",
        description: "Review it",
        toolUseId: "toolu_top",
        finished: true,
      },
      prompt("Review it.", T(2)),
      response(500, T(3), { calls: ["toolu_nested"] }),
    );
    subagent(
      "s",
      "a2",
      {
        agentType: "Explore",
        description: "Find the specs",
        toolUseId: "toolu_nested",
        parentAgentId: "a1",
      },
      prompt("Find the specs.", T(4)),
      response(200, T(5, 30), { model: "claude-haiku-5-5" }),
    );

    const report = await readSessions(dir);

    expect(report.warnings).toEqual([]);
    expect(shape(report.sessions)).toEqual(["s", "  a1", "    a2"]);
    const [s] = report.sessions;
    const [a1] = s.children;
    const [a2] = a1.children;
    expect(s).toMatchObject({
      subagentType: null,
      task: "Implement issue #101.",
      model: "claude-opus-5-5",
      startedAt: T(0),
      elapsedMs: 60_000,
    });
    expect(a1).toMatchObject({
      subagentType: "general-purpose",
      task: "Review it",
      state: SESSION_STATE.done,
    });
    expect(a2).toMatchObject({
      subagentType: "Explore",
      task: "Find the specs",
      model: "claude-haiku-5-5",
      state: SESSION_STATE.running,
      elapsedMs: 90_000,
    });
    expect(["s", "a1", "a2"].map((id) => ownOut(report, id))).toEqual([
      1000, 500, 200,
    ]);
  });

  it("links by the call alone, not by the meta file's depth or parent", async () => {
    // A depth-2 meta naming a parent that started nothing: the call wins.
    session("s", response(1, T(0), { calls: ["toolu_a", "toolu_b"] }));
    subagent(
      "s",
      "a1",
      { agentType: "x", description: "one", toolUseId: "toolu_a" },
      response(1, T(1)),
    );
    subagent(
      "s",
      "a2",
      {
        agentType: "x",
        description: "two",
        toolUseId: "toolu_b",
        parentAgentId: "a1",
        spawnDepth: 2,
      },
      response(1, T(2)),
    );

    const { sessions } = await readSessions(dir);

    expect(shape(sessions)).toEqual(["s", "  a1", "  a2"]);
  });

  it("counts each response once, at its largest count", async () => {
    session(
      "s",
      response(25, T(0), { id: "msg_1" }),
      response(5000, T(0), { id: "msg_1" }),
      response(3000, T(1), { id: "msg_2" }),
      // No id: counted once per record, as the Usage scan counts it.
      response(7, T(2)),
    );

    expect(ownOut(await readSessions(dir), "s")).toBe(8007);
  });

  it("takes a session's task from its first prompt, not from a tool result or a meta record", async () => {
    session(
      "s",
      prompt("<local-command-caveat>ignore</local-command-caveat>", T(0), {
        isMeta: true,
      }),
      prompt([{ type: "text", text: "  \n  Fix the tree.  " }], T(1)),
      prompt([{ type: "tool_result", tool_use_id: "x", content: "ok" }], T(2)),
      prompt("A later prompt.", T(3)),
    );

    const [s] = (await readSessions(dir)).sessions;

    expect(s.task).toBe("Fix the tree.");
  });

  it("reads a session Done once its turn ended and nothing under it is Running", async () => {
    session("ended", response(1, T(0), { stop: "end_turn" }));
    session("working", response(1, T(0), { stop: "tool_use" }));
    session(
      "waiting-on-a-subagent",
      response(1, T(0), { calls: ["toolu_w"], stop: "end_turn" }),
    );
    subagent(
      "waiting-on-a-subagent",
      "a1",
      { agentType: "x", description: "still going", toolUseId: "toolu_w" },
      response(1, T(1)),
    );

    const { sessions } = await readSessions(dir);
    const stateOf = (id: string) => sessions.find((s) => s.id === id)?.state;

    expect(stateOf("ended")).toBe(SESSION_STATE.done);
    expect(stateOf("working")).toBe(SESSION_STATE.running);
    expect(stateOf("waiting-on-a-subagent")).toBe(SESSION_STATE.running);
  });

  it("warns about a meta file it can't parse, names the file, and draws the rest", async () => {
    session("s", response(1, T(0), { calls: ["toolu_ok"] }));
    subagent(
      "s",
      "good",
      { agentType: "x", description: "fine", toolUseId: "toolu_ok" },
      response(1, T(1)),
    );
    subagent("s", "bad", '{"agentType":"x","descr', response(1, T(2)));

    const report = await readSessions(dir);

    expect(shape(report.sessions)).toEqual(["s", "  good"]);
    expect(report.warnings).toEqual([
      {
        file: "s/subagents/agent-bad.meta.json",
        message: expect.stringMatching(/^Couldn't read/),
      },
    ]);
  });

  it("puts a subagent whose call it can't find under its session, with a warning", async () => {
    session("s", response(1, T(0)));
    subagent(
      "s",
      "lost",
      { agentType: "x", description: "orphan", toolUseId: "toolu_gone" },
      response(1, T(1)),
    );

    const report = await readSessions(dir);

    expect(shape(report.sessions)).toEqual(["s", "  lost"]);
    expect(report.warnings).toEqual([
      {
        file: "s/subagents/agent-lost.meta.json",
        message: expect.stringContaining("toolu_gone"),
      },
    ]);
  });

  it("puts a subagent no call started, as a forked skill's is, under its session without a warning", async () => {
    session("s", response(1, T(0)));
    subagent(
      "s",
      "skill",
      {
        agentType: "general-purpose",
        description: "/code-review",
        name: "code-review",
      },
      response(1, T(1)),
    );

    const report = await readSessions(dir);

    expect(shape(report.sessions)).toEqual(["s", "  skill"]);
    expect(report.warnings).toEqual([]);
  });

  it("draws a subagent with no transcript yet from its meta file alone", async () => {
    session("s", response(1, T(0), { calls: ["toolu_new"] }));
    subagent("s", "new", {
      agentType: "x",
      description: "just started",
      toolUseId: "toolu_new",
    });

    const report = await readSessions(dir);

    expect(report.sessions[0].children[0]).toMatchObject({
      id: "new",
      task: "just started",
      model: null,
      startedAt: null,
      elapsedMs: null,
    });
    expect(ownOut(report, "new")).toBe(0);
  });

  it("lists the most recently started session first", async () => {
    session("older", response(1, T(0)));
    session("newer", response(1, T(30)));

    const { sessions } = await readSessions(dir);

    expect(sessions.map((s) => s.id)).toEqual(["newer", "older"]);
  });

  it("answers an empty reading, naming the directory, when it doesn't exist", async () => {
    const missing = join(dir, "nowhere");

    const report = await readSessions(missing);

    expect(report).toMatchObject({
      transcriptDir: missing,
      sessions: [],
      groups: [],
      warnings: [],
    });
  });

  it("warns about a transcript with lines it can't parse above its last, and still draws its card", async () => {
    writeFileSync(
      join(dir, "s.jsonl"),
      "not json\n" + lines(response(4000, T(0))),
      "utf8",
    );

    const report = await readSessions(dir);

    expect(report.sessions.map((s) => [s.id, ownOut(report, s.id)])).toEqual([
      ["s", 4000],
    ]);
    expect(report.warnings).toEqual([
      {
        file: "s.jsonl",
        message: expect.stringMatching(/^Couldn't read 1 line /),
      },
    ]);
  });

  it("warns about a transcript it can't open, naming it by its code rather than its path", async () => {
    // A directory where a transcript should be: opening it fails with EISDIR.
    mkdirSync(join(dir, "broken.jsonl"));
    session("s", response(1, T(0), { calls: ["toolu_x"] }));
    subagent("s", "x", {
      agentType: "x",
      description: "unopenable",
      toolUseId: "toolu_x",
    });
    mkdirSync(join(dir, "s", "subagents", "agent-x.jsonl"));

    const report = await readSessions(dir);

    expect(shape(report.sessions)).toEqual(["s", "  x"]);
    expect(report.warnings.map((w) => w.file)).toEqual([
      "broken.jsonl",
      "s/subagents/agent-x.jsonl",
    ]);
    for (const { message } of report.warnings) {
      expect(message).toMatch(/^Couldn't read .*\(EISDIR\)/);
      expect(message).not.toContain(dir);
    }
  });

  it("skips a half-written last line without losing the lines above it", async () => {
    writeFileSync(
      join(dir, "s.jsonl"),
      lines(response(4000, T(0))) + '{"type":"assistant","mess',
      "utf8",
    );

    expect(ownOut(await readSessions(dir), "s")).toBe(4000);
  });
});

/** Sets a file's modification time, relative to `dir`. */
const touch = (file: string, ms: number) =>
  utimesSync(join(dir, file), ms / 1000, ms / 1000);

/** The state of the card `id`, wherever it is in the tree. */
const stateIn = (cards: SessionCard[], id: string): string | undefined => {
  for (const c of cards) {
    if (c.id === id) return c.state;
    const found = stateIn(c.children, id);
    if (found) return found;
  }
  return undefined;
};

/**
 * Slice 2 (#591): Stopped. A file's age is its modification time against the
 * clock the reading is given, so each case writes its files, sets their times
 * with `utimesSync` and reads at a `now` of its choosing.
 */
describe("readSessions: Stopped", () => {
  const NOW = Date.parse("2026-10-21T12:00:00.000Z");
  const idle = NOW - SESSION_IDLE_MS - 1000;
  const fresh = NOW - 1000;

  it("reads a session Stopped once its transcript is older than the idle time, and Done stays Done", async () => {
    session("crashed", response(1, T(0), { stop: "tool_use" }));
    session("finished", response(1, T(0), { stop: "end_turn" }));
    session("working", response(1, T(0), { stop: "tool_use" }));
    touch("crashed.jsonl", idle);
    touch("finished.jsonl", idle);
    touch("working.jsonl", fresh);

    const { sessions } = await readSessions(dir, NOW);

    expect(stateIn(sessions, "crashed")).toBe(SESSION_STATE.stopped);
    expect(stateIn(sessions, "finished")).toBe(SESSION_STATE.done);
    expect(stateIn(sessions, "working")).toBe(SESSION_STATE.running);
  });

  it("reads a subagent Stopped by its own files' age, and its session Running while it is", async () => {
    session("s", response(1, T(0), { calls: ["toolu_a", "toolu_b"] }));
    subagent(
      "s",
      "dead",
      { agentType: "x", description: "dead", toolUseId: "toolu_a" },
      response(1, T(1)),
    );
    subagent(
      "s",
      "live",
      { agentType: "x", description: "live", toolUseId: "toolu_b" },
      response(1, T(1)),
    );
    // The session waits on its subagents, so its own transcript is quiet.
    touch("s.jsonl", idle);
    for (const f of ["agent-dead.jsonl", "agent-dead.meta.json"]) {
      touch(`s/subagents/${f}`, idle);
    }
    touch("s/subagents/agent-live.jsonl", fresh);
    touch("s/subagents/agent-live.meta.json", idle);

    const { sessions } = await readSessions(dir, NOW);

    expect(stateIn(sessions, "dead")).toBe(SESSION_STATE.stopped);
    expect(stateIn(sessions, "live")).toBe(SESSION_STATE.running);
    expect(stateIn(sessions, "s")).toBe(SESSION_STATE.running);
  });

  it("reads a session Stopped once nothing under it is Running either", async () => {
    session("s", response(1, T(0), { calls: ["toolu_a"] }));
    subagent(
      "s",
      "a",
      { agentType: "x", description: "dead", toolUseId: "toolu_a" },
      response(1, T(1)),
    );
    for (const f of [
      "s.jsonl",
      "s/subagents/agent-a.jsonl",
      "s/subagents/agent-a.meta.json",
    ]) {
      touch(f, idle);
    }

    const { sessions } = await readSessions(dir, NOW);

    expect(stateIn(sessions, "s")).toBe(SESSION_STATE.stopped);
    expect(stateIn(sessions, "a")).toBe(SESSION_STATE.stopped);
  });

  it("reads a Stopped session Running again once its transcript grows", async () => {
    const reader = createSessionsReader();
    session("s", response(1, T(0), { stop: "tool_use" }));
    touch("s.jsonl", idle);
    expect(stateIn((await reader.read(dir, NOW)).sessions, "s")).toBe(
      SESSION_STATE.stopped,
    );

    appendFileSync(join(dir, "s.jsonl"), lines(response(1, T(30))));
    touch("s.jsonl", fresh);

    expect(stateIn((await reader.read(dir, NOW)).sessions, "s")).toBe(
      SESSION_STATE.running,
    );
  });
});

/**
 * Slice 3 (#592): a card a waiting record names reads Waiting for you. The
 * records are what `.claude/hooks/record-waiting.mjs` writes, one file per
 * session or subagent holding `{ sessionId, agentId }`, in a directory of the
 * case's own beside the transcripts.
 */
describe("readSessions: Waiting for you", () => {
  // The real clock, since the files these cases write are stamped by it.
  const NOW = Date.now();
  const idle = NOW - SESSION_IDLE_MS - 1000;
  let waitingDir: string;

  beforeEach(() => {
    waitingDir = join(dir, "..", `${basename(dir)}-waiting`);
    mkdirSync(waitingDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(waitingDir, { recursive: true, force: true });
  });

  const waiting = (sessionId: string, agentId: string | null = null) =>
    writeFileSync(
      join(
        waitingDir,
        agentId ? `${sessionId}.${agentId}.json` : `${sessionId}.json`,
      ),
      JSON.stringify({ sessionId, agentId }),
    );

  /** A session whose call started subagent `a`, whose call started `b`. */
  function nested() {
    session("s", response(1, T(0), { calls: ["toolu_a"], stop: "tool_use" }));
    subagent(
      "s",
      "a",
      { agentType: "x", description: "a", toolUseId: "toolu_a" },
      response(1, T(1), { calls: ["toolu_b"] }),
    );
    subagent(
      "s",
      "b",
      { agentType: "x", description: "b", toolUseId: "toolu_b" },
      response(1, T(2)),
    );
  }

  const states = async (now = NOW) => {
    const { sessions } = await readSessions(dir, now, waitingDir);
    return ["s", "a", "b"].map((id) => stateIn(sessions, id));
  };

  it("reads the nested subagent a record names Waiting for you, and only it", async () => {
    nested();
    waiting("s", "b");

    expect(await states()).toEqual([
      SESSION_STATE.running,
      SESSION_STATE.running,
      SESSION_STATE.waiting,
    ]);
  });

  it("reads a session Waiting for you on a record of its own", async () => {
    nested();
    waiting("s");

    expect(await states()).toEqual([
      SESSION_STATE.waiting,
      SESSION_STATE.running,
      SESSION_STATE.running,
    ]);
  });

  it("reads a session Waiting for you on a permission prompt that named no subagent", async () => {
    nested();
    writeFileSync(
      join(waitingDir, "s@prompt.json"),
      JSON.stringify({ sessionId: "s", agentId: null }),
    );

    expect(await states()).toEqual([
      SESSION_STATE.waiting,
      SESSION_STATE.running,
      SESSION_STATE.running,
    ]);
  });

  it("goes back to what the transcripts say once the record is gone", async () => {
    nested();
    const reader = createSessionsReader();
    waiting("s", "b");
    const read = async () =>
      stateIn((await reader.read(dir, NOW, waitingDir)).sessions, "b");
    expect(await read()).toBe(SESSION_STATE.waiting);

    rmSync(join(waitingDir, "s.b.json"));

    expect(await read()).toBe(SESSION_STATE.running);
  });

  it("keeps a quiet card waiting rather than Stopped, and everything above it Running", async () => {
    nested();
    waiting("s", "b");
    for (const f of [
      "s.jsonl",
      "s/subagents/agent-a.jsonl",
      "s/subagents/agent-a.meta.json",
      "s/subagents/agent-b.jsonl",
      "s/subagents/agent-b.meta.json",
    ]) {
      touch(f, idle);
    }

    // A permission prompt can be held for an hour: the wait is the developer's.
    expect(await states()).toEqual([
      SESSION_STATE.running,
      SESSION_STATE.running,
      SESSION_STATE.waiting,
    ]);
  });

  it("leaves a Done card Done whatever a record left behind says", async () => {
    session("s", response(1, T(0), { calls: ["toolu_a"] }));
    subagent(
      "s",
      "a",
      {
        agentType: "x",
        description: "a",
        toolUseId: "toolu_a",
        finished: true,
      },
      response(1, T(1)),
    );
    session("over", response(1, T(0), { stop: "end_turn" }));
    waiting("s", "a");
    waiting("over");

    const { sessions } = await readSessions(dir, NOW, waitingDir);

    expect(stateIn(sessions, "a")).toBe(SESSION_STATE.done);
    expect(stateIn(sessions, "over")).toBe(SESSION_STATE.done);
  });

  it("shows a record naming a subagent the session has no card for on the session's card", async () => {
    nested();
    waiting("s", "a9999999999999999");

    expect(await states()).toEqual([
      SESSION_STATE.waiting,
      SESSION_STATE.running,
      SESSION_STATE.running,
    ]);
  });

  it("ignores a record for a session it has no transcript of, one it can't parse, and a missing directory", async () => {
    nested();
    waiting("elsewhere");
    writeFileSync(join(waitingDir, "s.json"), "{ not json");
    writeFileSync(join(waitingDir, "s.a.json.123.tmp"), "{}");

    const { sessions, warnings } = await readSessions(dir, NOW, waitingDir);
    expect(sessions.map((c) => c.id)).toEqual(["s"]);
    expect(await states()).toEqual([
      SESSION_STATE.running,
      SESSION_STATE.running,
      SESSION_STATE.running,
    ]);
    expect(warnings).toEqual([]);

    rmSync(waitingDir, { recursive: true });
    expect(await states()).toEqual([
      SESSION_STATE.running,
      SESSION_STATE.running,
      SESSION_STATE.running,
    ]);
  });
});

/**
 * Slice 4 (#593): what each card spent and on which issue, read off real files
 * and held against the Usage scan's own reading of the same directory (R7).
 * The grouping rules over made-up cards are `./session-groups.test.ts`'s.
 */
describe("readSessions: groups", () => {
  const on = (branch: string, record: object) => ({
    ...record,
    sessionId: "s",
    gitBranch: branch,
  });

  it("totals each issue as the Usage scan does, subagents, partial counts and records with no id included", async () => {
    session(
      "s",
      on("feat/7-x", prompt("Do it.", T(0))),
      on("feat/7-x", response(100, T(1), { calls: ["toolu_a"] })),
      on("develop", response(9, T(2))),
      on("feat/8-y", response(40, T(3), { id: "msg_s" })),
    );
    subagent(
      "s",
      "a",
      { agentType: "x", description: "help", toolUseId: "toolu_a" },
      on("feat/7-x", response(25, T(4), { id: "msg_a" })),
      on("feat/7-x", response(5000, T(4), { id: "msg_a" })),
      on("feat/8-y", response(3, T(5))),
    );

    const report = await readSessions(dir);

    const { byIssue } = scanSpend(dir);
    expect(byIssue.size).toBe(2);
    for (const [issue, spend] of byIssue) {
      const group = report.groups.find((g) => g.key === `issue:${issue}`);
      expect(group?.out).toBe(spend.out);
    }
    const issue7 = report.groups.find((g) => g.key === "issue:7");
    expect(issue7?.sessions).toEqual([
      {
        id: "s",
        out: 100,
        subtreeOut: 5100,
        children: [{ id: "a", out: 5000, subtreeOut: 5000, children: [] }],
      },
    ]);
    expect(report.groups.map((g) => [g.key, g.out])).toEqual([
      ["issue:7", 5100],
      ["issue:8", 43],
      ["base", 9],
    ]);
  });

  it("credits a subagent transcript with no usable meta file to its session, as the Usage scan still counts it", async () => {
    session("s", on("feat/7-x", response(1, T(0))));
    // A meta file cut off mid-write: no card, but its spend is real.
    subagent(
      "s",
      "cut",
      '{"agentType":"x","descr',
      on("feat/7-x", response(500, T(1))),
    );
    // A transcript whose meta file is not there at all.
    writeFileSync(
      join(dir, "s", "subagents", "agent-bare.jsonl"),
      lines(on("feat/7-x", response(40, T(2)))),
      "utf8",
    );

    const report = await readSessions(dir);

    expect(shape(report.sessions)).toEqual(["s"]);
    expect(report.groups.map((g) => [g.key, g.out])).toEqual([
      ["issue:7", scanSpend(dir).byIssue.get(7)?.out],
    ]);
    expect(ownOut(report, "s")).toBe(541);
  });

  it("keeps the figures level with the Usage scan after a reading resumes from its cursor", async () => {
    const reader = createSessionsReader();
    session("s", on("feat/7-x", response(1, T(0))));
    await reader.read(dir);

    appendFileSync(
      join(dir, "s.jsonl"),
      lines(
        on("feat/7-x", response(2, T(1))),
        on("feat/7-x", response(4, T(2))),
      ),
    );
    const report = await reader.read(dir);

    expect(report.groups[0]?.out).toBe(scanSpend(dir).byIssue.get(7)?.out);
    expect(report.groups[0]?.out).toBe(7);
  });
});

/**
 * Slice 2 (#591): one reader kept between readings resumes each transcript
 * from where it left off, which is what makes polling cheap enough for the
 * stream. Every answer must equal a fresh reading's.
 */
describe("createSessionsReader", () => {
  const fresh = () => readSessions(dir);
  const withoutClock = ({ gatheredAt: _, ...rest }: SessionsReport) => rest;

  it("reads what was appended since the last reading, and agrees with a fresh one", async () => {
    const reader = createSessionsReader();
    session("s", prompt("Do it.", T(0)), response(100, T(1), { id: "msg_1" }));
    await reader.read(dir);

    appendFileSync(
      join(dir, "s.jsonl"),
      lines(
        // The same response again with its final count, as a subagent writes.
        response(900, T(2), { id: "msg_1" }),
        response(50, T(3), { calls: ["toolu_new"] }),
      ),
    );
    subagent(
      "s",
      "new",
      { agentType: "x", description: "new one", toolUseId: "toolu_new" },
      response(7, T(4)),
    );
    const live = await reader.read(dir);

    expect(live.sessions[0]).toMatchObject({ elapsedMs: 180_000 });
    expect(ownOut(live, "s")).toBe(950);
    expect(shape(live.sessions)).toEqual(["s", "  new"]);
    expect(withoutClock(live)).toEqual(withoutClock(await fresh()));
  });

  it("counts a half-written last line once, when it is finished", async () => {
    const reader = createSessionsReader();
    const whole = JSON.stringify(response(300, T(1)));
    writeFileSync(
      join(dir, "s.jsonl"),
      lines(response(100, T(0))) + whole.slice(0, 20),
      "utf8",
    );
    expect(ownOut(await reader.read(dir), "s")).toBe(100);

    appendFileSync(join(dir, "s.jsonl"), whole.slice(20));
    // Complete JSON with no newline yet: counted, but not past the cursor.
    expect(ownOut(await reader.read(dir), "s")).toBe(400);

    appendFileSync(join(dir, "s.jsonl"), "\n");
    const settled = await reader.read(dir);

    expect(ownOut(settled, "s")).toBe(400);
    expect(settled.warnings).toEqual([]);
  });

  it("reads a transcript from the top again when it was replaced rather than grown", async () => {
    const reader = createSessionsReader();
    session("s", response(5000, T(0)), response(5000, T(1)));
    await reader.read(dir);

    // Shorter: it shrank. Then a different file of the same length and more.
    session("s", response(1, T(0)));
    expect(ownOut(await reader.read(dir), "s")).toBe(1);
    session("s", response(2, T(0)), response(3, T(1)), response(4, T(2)));

    expect(ownOut(await reader.read(dir), "s")).toBe(9);
  });

  it("forgets a session whose transcript is gone", async () => {
    const reader = createSessionsReader();
    session("gone", response(1, T(0)));
    session("kept", response(1, T(1)));
    await reader.read(dir);

    rmSync(join(dir, "gone.jsonl"));

    expect((await reader.read(dir)).sessions.map((s) => s.id)).toEqual([
      "kept",
    ]);
  });

  it("notices a subagent that has just finished", async () => {
    const reader = createSessionsReader();
    session("s", response(1, T(0), { calls: ["toolu_a"] }));
    const meta = { agentType: "x", description: "a", toolUseId: "toolu_a" };
    subagent("s", "a", meta, response(1, T(1)));
    expect((await reader.read(dir)).sessions[0].children[0].state).toBe(
      SESSION_STATE.running,
    );

    writeFileSync(
      join(dir, "s", "subagents", "agent-a.meta.json"),
      JSON.stringify({ ...meta, finished: true }),
      "utf8",
    );

    expect((await reader.read(dir)).sessions[0].children[0].state).toBe(
      SESSION_STATE.done,
    );
  });
});
