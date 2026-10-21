// Keeps a record, one small file, of each session or subagent that is waiting
// on the developer, and removes it when the wait ends (#592). The dev-tools
// Sessions page reads the records and shows Waiting for you, because a
// transcript does not record a wait.
//
// Which events mark a wait is the spike posted on #592, from the hooks
// reference (code.claude.com/docs/en/hooks):
//
// - A wait starts on a `Notification` of type `permission_prompt` (a
//   permission dialog that has been on screen about six seconds), and on a
//   `PreToolUse` of `AskUserQuestion`. Not on `PermissionRequest`, which also
//   fires in a background subagent that cannot ask anyone and is denied at
//   once, so it would mark a wait that never happened.
// - It ends on the waiting card's next `PostToolUse` or `PostToolUseFailure`
//   (the call it was held on has run), the session's next `UserPromptSubmit`
//   or `Stop`, the subagent's `SubagentStop`, or `SessionEnd`, which clears
//   every record the session has. The docs name no event for a dialog the
//   developer denies, so a denial clears on whichever of those comes next.
//
// A payload carries `agent_id` when the hook fires inside a subagent, and the
// record then names that subagent; without one it names the session. The id is
// the one in `subagents/agent-<id>.jsonl`, which is how the page finds the card.
// The docs promise `agent_id` on tool events, so a question always names who
// asked it, but not on a notification. A permission prompt with no `agent_id`
// may be any card's, so it is kept apart, as `<session>@prompt.json`, and the
// next clearing event from any card in the session removes it: the subagent
// that was held on it carries its own id when its call goes on to run.
//
// settings.json is committed, so this runs in every clone and session, and on
// every tool call. It reads stdin, writes or removes a file or two, and exits 0;
// it prints nothing, since what some events' hooks print becomes the session's
// context, and it never reaches the network. A directory it cannot write, or a
// payload it cannot read, costs nothing.
//
// The records go to `CLAUDE_WAITING_DIR`, or `~/.claude-sessions-waiting`
// outside every repository: `resolveWaitingDir` in `apps/web/dev/waiting.ts`
// reads from the same place, and each of the two tests pins the default.
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** An id Claude Code gives a session or a subagent, and nothing that could
 *  name a path outside the directory. */
const PLAIN_ID = /^[A-Za-z0-9_-]+$/;

const dir = process.env.CLAUDE_WAITING_DIR?.trim() || join(homedir(), ".claude-sessions-waiting");

/** `<session>.json` for the session itself, `<session>.<agent>.json` for one
 *  of its subagents. */
const fileOf = (sessionId, agentId) =>
  join(dir, agentId ? `${sessionId}.${agentId}.json` : `${sessionId}.json`);

/** A permission prompt that named no subagent. `@` is in no id, so it cannot
 *  meet a subagent's file. */
const promptFileOf = (sessionId) => join(dir, `${sessionId}@prompt.json`);

function record(file, sessionId, agentId) {
  mkdirSync(dir, { recursive: true });
  // Written beside it and renamed over it, so a reader never meets half a
  // record.
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify({ sessionId, agentId }));
  renameSync(temp, file);
}

function clear(sessionId, agentId) {
  rmSync(fileOf(sessionId, agentId), { force: true });
  rmSync(promptFileOf(sessionId), { force: true });
}

function clearSession(sessionId) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(`${sessionId}.`) || name.startsWith(`${sessionId}@`)) {
      rmSync(join(dir, name), { force: true });
    }
  }
}

function handle(event) {
  const sessionId = event.session_id;
  if (typeof sessionId !== "string" || !PLAIN_ID.test(sessionId)) return;
  const agentId = event.agent_id ?? null;
  if (agentId !== null && (typeof agentId !== "string" || !PLAIN_ID.test(agentId))) return;

  switch (event.hook_event_name) {
    case "Notification":
      if (event.notification_type === "permission_prompt") {
        const file = agentId ? fileOf(sessionId, agentId) : promptFileOf(sessionId);
        record(file, sessionId, agentId);
      }
      return;
    case "PreToolUse":
      if (event.tool_name === "AskUserQuestion") {
        record(fileOf(sessionId, agentId), sessionId, agentId);
      }
      return;
    case "PostToolUse":
    case "PostToolUseFailure":
    case "UserPromptSubmit":
    case "Stop":
    case "SubagentStop":
      clear(sessionId, agentId);
      return;
    case "SessionEnd":
      clearSession(sessionId);
      return;
  }
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    handle(JSON.parse(input.replace(/^﻿/, "")));
  } catch {
    // An unreadable payload, or a directory that cannot be written: the
    // session it fires in must never pay for the page.
  }
  process.exitCode = 0;
});
