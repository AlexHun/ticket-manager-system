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
 * (#592), not a dead session. Fifteen minutes is that ceiling plus the five a
 * slow response can add on top of it.
 */
export const SESSION_IDLE_MS = 15 * 60_000;

/**
 * How far through the `implement` skill a card is (#595): R9's eight steps
 * in their order (`apps/web/dev/implement-step.ts` maps them onto the skill's), or Unknown when its tool calls match none of the
 * rules `apps/web/dev/implement-step.ts` reads them by, never the nearest
 * guess.
 */
export const IMPLEMENT_STEP = {
  read: "Read the ticket",
  branch: "Branch",
  standards: "Standards",
  build: "Build",
  commit: "Commit",
  review: "Review",
  ship: "Ship",
  ci: "CI",
  unknown: "Unknown",
} as const;
export type ImplementStep =
  (typeof IMPLEMENT_STEP)[keyof typeof IMPLEMENT_STEP];

/** One tool a card has called, and how many times (#595, R10). */
export interface ToolTally {
  /** Claude Code's name for it: `Bash`, `Read`, `mcp__context7__query-docs`. */
  name: string;
  calls: number;
}

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
  /** The `implement` step it has reached, or null when it is not running
   *  `implement` at all. */
  step: ImplementStep | null;
  /** Every tool its own transcript called, in the order it first called
   *  each. */
  tools: ToolTally[];
  /** The subagents it started, oldest first. */
  children: SessionCard[];
}

/**
 * The branches whose work is a group of its own and counted toward no issue
 * (R6): a `/chain` conductor runs on `develop`, and `main` is production.
 */
export const BASE_BRANCHES = ["develop", "main"] as const;

/**
 * What a group gathers (#593, R6): the work on one issue's branches, the work
 * on `BASE_BRANCHES`, or the rest — a branch that names no issue, or a record
 * with no branch.
 */
export const SESSION_GROUP_KIND = {
  issue: "issue",
  base: "base",
  other: "other",
} as const;

/**
 * One card's share of one group: the output tokens of its own responses on
 * that group's branches, and of its own plus every subagent under it. Its
 * facts — task, type, model, state — are the card's of the same `id` in
 * `SessionsReport.sessions`, which a group never repeats.
 *
 * A card is in a group when one of its responses ran on that group's branches,
 * when its latest record is on one of them (where it works now, figures or
 * not), or when a subagent under it is in the group.
 */
export interface SessionSlice {
  id: string;
  /** Each response once, at the largest count any of its records carries
   *  (#413, #431), credited to the card whose transcript holds it. */
  out: number;
  /** `out` plus every `subtreeOut` in `children`. */
  subtreeOut: number;
  children: SessionSlice[];
}

/**
 * The sessions that worked on one issue's branches, on `develop` or `main`, or
 * on the rest, and what they spent there.
 *
 * An issue group's `out` is the issue's output tokens as the Usage page and
 * `bun run tokens` total them (`tallySpend`, R7), over the same responses the
 * slices are credited from, so it is also the sum of its slices'
 * `subtreeOut`. A session that worked on several branches is in each of their
 * groups, with its share of each.
 */
export type SessionGroup = {
  /** `issue:<n>`, `base` or `other`: unique in a report. */
  key: string;
  out: number;
  /** Most recently started first, as `SessionsReport.sessions` is. */
  sessions: SessionSlice[];
} & (
  | { kind: typeof SESSION_GROUP_KIND.issue; issue: number }
  | { kind: typeof SESSION_GROUP_KIND.base | typeof SESSION_GROUP_KIND.other }
);

/**
 * Where one issue of a running `/chain` stands (#594, R8):
 *
 * - **Merged**: the issue is closed.
 * - **In progress**: open, and the conductor has started a worker on it.
 * - **Blocked**: open, with a blocker outside the chain still open, which no
 *   worker of this chain will close.
 * - **Next**: the first open issue, in the chain's order, that is none of the
 *   above and whose blockers are all closed: the one the conductor starts
 *   once the one in progress is merged.
 * - **Waiting**: every other open issue, behind a blocker in the chain.
 */
export const CHAIN_ISSUE_STATE = {
  merged: "Merged",
  inProgress: "In progress",
  next: "Next",
  waiting: "Waiting",
  blocked: "Blocked",
} as const;
export type ChainIssueState =
  (typeof CHAIN_ISSUE_STATE)[keyof typeof CHAIN_ISSUE_STATE];

/** One issue of a chain, in the chain's order. */
export interface ChainIssue {
  issue: number;
  title: string;
  state: ChainIssueState;
  /** The worker's name on an issue In progress (`Ember`), else null. */
  worker: string | null;
  /** Its blockers outside the chain that are still open: what a Blocked
   *  issue waits on. */
  blockers: number[];
}

/**
 * A worker the conductor started: an `Agent` call whose prompt is `chain`'s
 * ("You are Ember, on the team. Invoke the `implement` skill for issue #…").
 */
export interface ChainWorker {
  name: string;
  issue: number;
  /** The worker's card, or null before its meta file is written. */
  cardId: string | null;
  /** Its card's state, or null without a card. */
  state: SessionState | null;
}

/**
 * A running `/chain` (#594, R8): the session whose prompt ran the `chain`
 * skill, while it reads Running or Waiting for you.
 */
export interface ChainView {
  /** The conductor's card. */
  sessionId: string;
  /** The plan or PRD `/chain` was given (`docs/plans/<slug>.md`), or null
   *  when it was given issue numbers instead. */
  plan: string | null;
  /**
   * Its issues in the order the chain works them — blockers first, ties by
   * issue number, as `chain` step 1 orders them — or null when the order
   * can't be known: no plan named, or no listing to read it from.
   */
  issues: ChainIssue[] | null;
  /** Why `issues` is null, in a sentence the page shows; null otherwise. */
  unknown: string | null;
  /** Every worker the conductor started, in the order it started them. */
  workers: ChainWorker[];
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
  /** Every session, most recently started first: each card once, with the
   *  facts the groups' slices name by `id`. */
  sessions: SessionCard[];
  /**
   * The sessions grouped by where they worked (#593): every issue group, the
   * most recently started session first, then `develop` and `main`, then the
   * rest.
   */
  groups: SessionGroup[];
  /** Every running `/chain`, most recently started first (#594). */
  chains: ChainView[];
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
