/**
 * The Sessions page's wire: what `GET /__devtools/sessions` answers
 * (`apps/web/dev/sessions.ts`), and what `./SessionsPage` draws.
 *
 * One contract module per page, as `./usage-protocol` and `./map-protocol`
 * are (#284), and **import-free** for their reason: the node half reaches it
 * by relative path under Vite's native config loader, and the E2E spec reaches
 * it from Playwright's.
 *
 * The words are R12's (`docs/prd/dev-tools-sessions-page.md`): Claude Code's
 * workers are _sessions_ and _subagents_ and their progress is a _state_,
 * because `GLOSSARY.md` gives _agent_, _run_ and _status_ to the desk. Claude
 * Code's own field names (`agentType`, `agentId`) stop at the node half.
 */

/**
 * A card's state, as far as slice 1 of `docs/plans/dev-tools-sessions-page.md`
 * can tell it: Done or Running. Waiting for you and Stopped are later slices.
 *
 * A subagent is Done when its `agent-<id>.meta.json` says `finished`. A
 * session has no meta file, so it is Done when its last response ended its
 * turn (`stop_reason: "end_turn"`) and nothing under it is still Running:
 * a conductor whose turn ended while its background subagents work is not
 * done. Measured 2026-10-21 over this machine's 206 sessions of this
 * repository: 186 ended on `end_turn`, 2 on `tool_use` and 18 had no response.
 */
export const SESSION_STATE = {
  running: "Running",
  done: "Done",
} as const;
export type SessionState = (typeof SESSION_STATE)[keyof typeof SESSION_STATE];

/** One card: a session, or a subagent somewhere under one. */
export interface SessionCard {
  /** The session's id (its transcript's name), or the subagent's `agentId`. */
  id: string;
  /** Null on a session, which has no subagent type. */
  subagentType: string | null;
  /**
   * What it was asked to do. A subagent's is its meta file's `description`; a
   * session's is its first prompt, cut to its first line. Null when the
   * transcript holds neither.
   */
  task: string | null;
  /** The model its first response named, or null before it has one. */
  model: string | null;
  state: SessionState;
  /** Its transcript's first timestamp, or null when no record carries one. */
  startedAt: string | null;
  /**
   * From its transcript's first timestamp to its latest, in milliseconds: how
   * long it has run as far as the transcript says. Null without two
   * timestamps to measure between.
   */
  elapsedMs: number | null;
  /**
   * Its own output tokens, never its children's: each response once, at the
   * largest count any of its records carries (#413, #431).
   */
  out: number;
  /** The subagents it started, oldest first. */
  children: SessionCard[];
}

/** A file the reading could not use, and what that cost. */
export interface SessionsWarning {
  /** The file, relative to `transcriptDir` and written with `/`. */
  file: string;
  message: string;
}

export interface SessionsReport {
  /** Where the transcripts were read from, which the page names. */
  transcriptDir: string;
  /** When the reading was taken, as an ISO 8601 string. */
  gatheredAt: string;
  /** Every session, most recently started first. */
  sessions: SessionCard[];
  warnings: SessionsWarning[];
}
