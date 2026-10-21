// The waiting records the Sessions page reads (#592, slice 3 of
// `docs/plans/dev-tools-sessions-page.md`): one small file per session or
// subagent that is waiting on the developer, written and removed by
// `.claude/hooks/record-waiting.mjs`, because a transcript does not record a
// wait. Which hook events start and end one is the spike posted on #592, and
// the hook's own header says it again.
//
// A record is `<session>.json` or `<session>.<agent>.json` holding
// `{ sessionId, agentId }`, `agentId` null for the session itself, or
// `<session>@prompt.json` for a permission prompt that named no subagent and
// so shows on the session's card too. The reader
// goes by what the file holds rather than its name, and passes over a file
// that is not a record: the hook renames each one into place, so a file that
// does not parse is nothing the hook wrote, and the page has no reason to warn
// about it.

import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Names the directory in place of `~/.claude-sessions-waiting`, the fourth
 * seam beside `CLAUDE_TRANSCRIPT_DIR`, `GH_ISSUES_FILE` and
 * `USAGE_HISTORY_FILE`: the hook writes there and the page reads there, so a
 * test or the E2E never touches the developer's own records.
 */
export const WAITING_DIR_ENV = "CLAUDE_WAITING_DIR";

/**
 * Where the records are: the override when set, else
 * `~/.claude-sessions-waiting`, outside every repository and outside
 * `~/.claude`, the way the usage history is. One directory for every project
 * on the machine, since a session id is unique without one.
 */
export function resolveWaitingDir(
  env: Record<string, string | undefined> = process.env,
  { home = homedir() }: { home?: string } = {},
): string {
  const override = env[WAITING_DIR_ENV]?.trim();
  if (override) return override;
  return join(home, ".claude-sessions-waiting");
}

/** One session or subagent waiting on the developer. */
export interface WaitingRecord {
  sessionId: string;
  /** Null when it is the session itself that waits. */
  agentId: string | null;
}

const RECORD_SUFFIX = ".json";

function asRecord(parsed: unknown): WaitingRecord | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const { sessionId, agentId } = parsed as Record<string, unknown>;
  if (typeof sessionId !== "string") return null;
  if (agentId !== null && typeof agentId !== "string") return null;
  return { sessionId, agentId };
}

/**
 * Every record in `dir`. A directory that does not exist is no records,
 * which is the ordinary state of a machine where nothing has waited yet; so is
 * one that can't be read, since the page would only have a guess to offer.
 */
export async function readWaiting(dir: string): Promise<WaitingRecord[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const records: WaitingRecord[] = [];
  for (const name of names) {
    if (!name.endsWith(RECORD_SUFFIX)) continue;
    try {
      const record = asRecord(
        JSON.parse(await readFile(join(dir, name), "utf8")) as unknown,
      );
      if (record) records.push(record);
    } catch {
      // Removed between the listing and the read, or not the hook's.
    }
  }
  return records;
}
