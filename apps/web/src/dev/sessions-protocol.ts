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
 * A card's state: Running, Waiting for you, Done or Stopped (R2 of
 * `docs/prd/dev-tools-sessions-page.md`).
 *
 * A subagent is Done when its `agent-<id>.meta.json` says `finished`. A
 * session has no meta file, so it is Done when its last response ended its
 * turn (`stop_reason: "end_turn"`) and nothing under it is still Running:
 * a conductor whose turn ended while its background subagents work is not
 * done. Measured 2026-10-21 over this machine's 206 sessions of this
 * repository: 186 ended on `end_turn`, 2 on `tool_use` and 18 had no response.
 *
 * One that is not Done is Stopped once its files have not been written for
 * `SESSION_IDLE_MS` and nothing under it is Running (#591, R11): a crash or a
 * closed terminal leaves a transcript that never ends its turn, and the page
 * must not say to wait on it. It reads Running again the moment its
 * transcript grows.
 *
 * One that is not Done reads Waiting for you while a waiting record names it
 * (#592, R5): `.claude/hooks/record-waiting.mjs` writes one when a permission
 * prompt or a question to the developer holds it, and removes it once
 * answered. That outranks Stopped, since a prompt can be held for an hour and
 * the wait is the developer's, and like Running it keeps the cards above it
 * from reading Stopped or Done. A record whose payload named no subagent, or
 * one the session has no card for, shows on its session's card.
 */
export const SESSION_STATE = {
  running: "Running",
  waiting: "Waiting for you",
  done: "Done",
  stopped: "Stopped",
} as const;
export type SessionState = (typeof SESSION_STATE)[keyof typeof SESSION_STATE];

/**
 * How long a card that is not Done may go without a write to its transcript
 * or meta file before it reads Stopped: 15 minutes.
 *
 * Measured 2026-10-21 over this machine's 735 transcripts of this repository
 * (#591): the gaps between consecutive records inside a turn, those ending in
 * a tool's result or a response rather than in a prompt. The healthy
 * ones stop at the 10-minute ceiling Claude Code puts on a foreground command:
 * 1,030 gaps were a `gh pr checks --watch` or `gh run watch`, the longest
 * 10.0 minutes, and no command that was running rather than waiting took past
 * 10.1. Every gap past that was the session waiting on the developer — an
 * `AskUserQuestion` (up to 7 hours), or a `sed -n` or an `Edit` held on a
 * permission answer for 11 to 90 minutes — which reads Waiting for you
 * (#592), not a dead session. Fifteen minutes is that ceiling plus the five a slow
 * response can add on top of it.
 */
export const SESSION_IDLE_MS = 15 * 60_000;

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

/**
 * One server-sent event on `DEVTOOLS_API.sessions`, the shape the test
 * runner's stream has (`./test-run-protocol`'s `DevStreamMessage`): a `data:`
 * line holding one of these as JSON. A `report` is the whole reading, sent
 * when a page connects and again whenever it changes; an `error` is a reading
 * that threw, sent once until it reads again.
 */
export type SessionsStreamMessage =
  | { kind: "report"; report: SessionsReport }
  | { kind: "error"; message: string };
