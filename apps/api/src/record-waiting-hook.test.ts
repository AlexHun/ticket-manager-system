import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { partialCheckout } from "@ticket/repo-scan/checkout";
import { REPO_ROOT } from "./test/run-hook";

// `.claude/hooks/record-waiting.mjs` writes a record while a session or one of
// its subagents waits on the developer, and removes it when the wait ends
// (#592): the Sessions page reads the records and shows Waiting for you. It is
// run here as settings.json runs it, under `node` with the event on stdin.
//
// The payloads are the hooks reference's own examples
// (code.claude.com/docs/en/hooks), cut to the fields the hook reads: recording
// live ones was refused by the auto-mode classifier, so these carry what the
// docs promise and no more. `agent_id` is a common field "present when the hook
// fires inside a subagent".
//
// `CLAUDE_WAITING_DIR` points every case at its own directory, so no test
// reads or writes the developer's records; home is a temporary directory too,
// for the one case about where the records go without it.
const HOOK = path.join(REPO_ROOT, ".claude/hooks/record-waiting.mjs");
const SESSION = "00893aaf-19fa-41d2-8238-13269b9b3ca0";
const AGENT = "a2222222222222222";

let home: string;
let dir: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "record-waiting-"));
  dir = path.join(home, "waiting");
});

afterEach(() => rmSync(home, { recursive: true, force: true }));

const base = (extra: object = {}) => ({
  session_id: SESSION,
  transcript_path: `/Users/dev/.claude/projects/repo/${SESSION}.jsonl`,
  cwd: "/Users/dev/repo",
  ...extra,
});

const PERMISSION_PROMPT = {
  hook_event_name: "Notification",
  message: "Claude needs your permission",
  title: "Permission needed",
  notification_type: "permission_prompt",
};

const QUESTION = {
  hook_event_name: "PreToolUse",
  tool_name: "AskUserQuestion",
  tool_input: { questions: [{ question: "Which one?" }] },
  tool_use_id: "toolu_question",
};

const POST_TOOL_USE = {
  hook_event_name: "PostToolUse",
  tool_name: "Bash",
  tool_input: { command: "rm -rf node_modules" },
  tool_response: { stdout: "" },
  tool_use_id: "toolu_bash",
};

const inSubagent = { agent_id: AGENT, agent_type: "Explore" };

const run = (
  payload: object,
  {
    waitingDir = dir as string | null,
    raw,
  }: { waitingDir?: string | null; raw?: string } = {},
) => {
  const env: Record<string, string | undefined> = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
  };
  delete env.CLAUDE_WAITING_DIR;
  if (waitingDir !== null) env.CLAUDE_WAITING_DIR = waitingDir;
  const result = Bun.spawnSync(["node", HOOK], {
    stdin: Buffer.from(raw ?? JSON.stringify(payload)),
    env,
  });
  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
};

const records = (where = dir) =>
  existsSync(where)
    ? readdirSync(where)
        .sort()
        .map((name) => ({
          name,
          record: JSON.parse(
            readFileSync(path.join(where, name), "utf8"),
          ) as unknown,
        }))
    : [];

const quietly = { code: 0, stdout: "", stderr: "" };

// Each case starts up to six `node` processes, one per event, which take a
// second or more cold on a Windows dev machine, hence the timeouts.
// The hook is under `.claude/`, which the develop image does not carry.
describe.skipIf(partialCheckout)("record-waiting hook", () => {
  test("records a session held on a permission prompt, and clears it once the call has run", () => {
    expect(run(base(PERMISSION_PROMPT))).toEqual(quietly);
    expect(records()).toEqual([
      {
        name: `${SESSION}@prompt.json`,
        record: { sessionId: SESSION, agentId: null },
      },
    ]);

    expect(run(base(POST_TOOL_USE))).toEqual(quietly);
    expect(records()).toEqual([]);
  }, 20_000);

  // A conductor waiting on the developer while a background worker it launched
  // keeps running, as in a `/chain`: the worker's events carry its `agent_id`,
  // and none of them may end a wait that named no subagent. Nor may a
  // `SubagentStop` that names no subagent at all.
  const sessionWaits = [
    ["a permission prompt", PERMISSION_PROMPT, `${SESSION}@prompt.json`],
    ["a question", QUESTION, `${SESSION}.json`],
  ] as const;
  const notTheSessions = [
    ["a background worker's next call", { ...POST_TOOL_USE, ...inSubagent }],
    [
      "a background worker stopping",
      { hook_event_name: "SubagentStop", ...inSubagent },
    ],
    [
      "a SubagentStop that names no subagent",
      { hook_event_name: "SubagentStop" },
    ],
  ] as const;

  test.each(
    sessionWaits.flatMap(([waitName, wait, file]) =>
      notTheSessions.map(
        ([eventName, event]) =>
          [waitName, eventName, wait, event, file] as const,
      ),
    ),
  )(
    "keeps the session's wait on %s through %s, and clears it on the session's own next call",
    (_, __, wait, event, file) => {
      run(base(wait));
      run(base(event));
      expect(records().map((r) => r.name)).toEqual([file]);

      run(base(POST_TOOL_USE));
      expect(records()).toEqual([]);
    },
    20_000,
  );

  test("records which subagent is held on a question, apart from its session", () => {
    run(base({ ...QUESTION, ...inSubagent }));
    run(base(QUESTION));
    expect(records()).toEqual([
      {
        name: `${SESSION}.${AGENT}.json`,
        record: { sessionId: SESSION, agentId: AGENT },
      },
      {
        name: `${SESSION}.json`,
        record: { sessionId: SESSION, agentId: null },
      },
    ]);

    // The subagent's answered question clears its record and not the session's.
    run(base({ ...QUESTION, ...inSubagent, hook_event_name: "PostToolUse" }));
    expect(records().map((r) => r.name)).toEqual([`${SESSION}.json`]);
  }, 20_000);

  test.each([
    [
      "a failed call",
      {
        hook_event_name: "PostToolUseFailure",
        tool_name: "Bash",
        error: "denied",
      },
    ],
    [
      "the developer's next prompt",
      { hook_event_name: "UserPromptSubmit", prompt: "No, do this instead" },
    ],
    [
      "the end of the turn",
      { hook_event_name: "Stop", stop_hook_active: false },
    ],
  ])(
    "clears a session's record on %s",
    (_, payload) => {
      run(base(PERMISSION_PROMPT));
      expect(records()).toHaveLength(1);
      expect(run(base(payload))).toEqual(quietly);
      expect(records()).toEqual([]);
    },
    20_000,
  );

  test("clears a subagent's record when it stops, and every record of a session when it ends", () => {
    const other = "a1111111111111111";
    run(base({ ...PERMISSION_PROMPT, ...inSubagent }));
    run(base({ ...QUESTION, agent_id: other, agent_type: "general-purpose" }));
    run(base(QUESTION));
    run(base({ ...PERMISSION_PROMPT, session_id: "another-session" }));
    expect(records()).toHaveLength(4);

    run(base({ hook_event_name: "SubagentStop", ...inSubagent }));
    expect(records().map((r) => r.name)).toEqual([
      `${SESSION}.${other}.json`,
      `${SESSION}.json`,
      "another-session@prompt.json",
    ]);

    run(base({ hook_event_name: "SessionEnd", reason: "other" }));
    expect(records().map((r) => r.name)).toEqual([
      "another-session@prompt.json",
    ]);
  }, 20_000);

  test("records nothing for a notification that is not a permission prompt, or a call that asks nothing", () => {
    run(base({ ...PERMISSION_PROMPT, notification_type: "idle_prompt" }));
    run(base({ ...QUESTION, tool_name: "Bash" }));
    expect(records()).toEqual([]);
  }, 20_000);

  test("writes under the home directory when no directory is named", () => {
    expect(run(base(PERMISSION_PROMPT), { waitingDir: null })).toEqual(quietly);
    // The default `resolveWaitingDir` in `apps/web/dev/waiting.ts` reads from.
    expect(records(path.join(home, ".claude-sessions-waiting"))).toHaveLength(
      1,
    );
  }, 20_000);

  test("writes nothing it could be steered by: an id that is not a plain name", () => {
    run(base({ ...PERMISSION_PROMPT, session_id: "../escape" }));
    run(base({ ...PERMISSION_PROMPT, ...inSubagent, agent_id: "a/../../b" }));
    expect(records()).toEqual([]);
    expect(existsSync(path.join(home, "escape.json"))).toBe(false);
  }, 20_000);

  test("exits 0 and says nothing on a payload it can't read, or a directory it can't write", () => {
    expect(run({}, { raw: "not json" })).toEqual(quietly);
    expect(run({}, { raw: "" })).toEqual(quietly);

    // A file where the directory should be: nothing can be written under it.
    writeFileSync(dir, "");
    expect(run(base(PERMISSION_PROMPT))).toEqual(quietly);
    expect(run(base(POST_TOOL_USE))).toEqual(quietly);
  }, 20_000);

  test("writes a record again in place, leaving no temporary file beside it", () => {
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 3; i++) run(base(PERMISSION_PROMPT));
    expect(readdirSync(dir)).toEqual([`${SESSION}@prompt.json`]);
  }, 20_000);
});
