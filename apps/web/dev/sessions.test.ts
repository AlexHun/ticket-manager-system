import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSessions } from "./sessions.ts";
import {
  SESSION_STATE,
  type SessionCard,
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
      out: 1000,
      startedAt: T(0),
      elapsedMs: 60_000,
    });
    expect(a1).toMatchObject({
      subagentType: "general-purpose",
      task: "Review it",
      state: SESSION_STATE.done,
      out: 500,
    });
    expect(a2).toMatchObject({
      subagentType: "Explore",
      task: "Find the specs",
      model: "claude-haiku-5-5",
      state: SESSION_STATE.running,
      out: 200,
      elapsedMs: 90_000,
    });
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

    const [s] = (await readSessions(dir)).sessions;

    expect(s.out).toBe(8007);
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

    const [s] = (await readSessions(dir)).sessions;

    expect(s.children[0]).toMatchObject({
      id: "new",
      task: "just started",
      model: null,
      out: 0,
      startedAt: null,
      elapsedMs: null,
    });
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
      warnings: [],
    });
  });

  it("skips a half-written last line without losing the lines above it", async () => {
    writeFileSync(
      join(dir, "s.jsonl"),
      lines(response(4000, T(0))) + '{"type":"assistant","mess',
      "utf8",
    );

    const [s] = (await readSessions(dir)).sessions;

    expect(s.out).toBe(4000);
  });
});
