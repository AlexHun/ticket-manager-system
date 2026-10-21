/**
 * The Sessions page's words and formatting, which `./SessionsPage` draws and
 * `tests/e2e/dev-sessions.spec.ts` reads — import-free, so Playwright's loader
 * reaches it the way it reaches `./usage-copy`, and a reworded label moves
 * both suites at once.
 *
 * Every word is R12's (`docs/prd/dev-tools-sessions-page.md`): _session_,
 * _subagent_, _state_, _step_, never the desk's _agent_, _run_, _status_,
 * _stage_ or _handoff_ (`GLOSSARY.md`).
 */

/** The page's heading. Its entry in `DEV_NAV_ITEMS` carries the same word. */
export const SESSIONS_TITLE = "Sessions";

/** What a session's card names as its type, where a subagent's names its
 *  subagent type. */
export const SESSION_KIND_LABEL = "Session";

/** The stream to the dev server dropped, and the browser is trying again. */
export const SESSIONS_RECONNECTING = "Reconnecting to the dev server…";

/** The browser gave up on the stream, which it never retries after. */
export const SESSIONS_STREAM_CLOSED =
  "Couldn't reach the dev server. Reload the page once it is running.";

/** `15 minutes`: the idle time a card reads Stopped after, in words. */
export const idleTime = (ms: number) => {
  const minutes = Math.round(ms / 60_000);
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
};

/** How the empty state opens, before the directory it names. */
export const NO_SESSIONS_LEAD = "No sessions in";

/** A card whose transcript holds no prompt and whose meta file no task. */
export const NO_TASK = "No prompt recorded";

/** A card whose transcript names no model yet. */
export const NO_MODEL = "Model unknown";

/** The accessible name of the list of subagents under a card. */
export const subagentsLabel = (task: string) => `Subagents of ${task}`;

/** `n output tokens`, the plural agreeing with the number (copy.md). */
export const outputTokens = (n: number) =>
  `${n.toLocaleString("en-GB")} output ${n === 1 ? "token" : "tokens"}`;

/** A card's own output tokens and every subagent's under it, together. */
export const withSubagents = (n: number) =>
  `${outputTokens(n)} with its subagents`;

/** The control that folds a card's subagents away, and opens them again. */
export const toggleSubagentsLabel = (open: boolean, task: string) =>
  `${open ? "Hide" : "Show"} the subagents of ${task}`;

/** An issue group's heading, which links to the issue on GitHub. */
export const issueGroupTitle = (issue: number) => `Issue #${issue}`;

/** The group of work on `develop` and `main` (`BASE_BRANCHES`). */
export const BASE_GROUP_TITLE = "On develop and main";
export const BASE_GROUP_NOTE =
  "Counted toward no issue. A /chain conductor works on develop.";

/** The group of work on a branch that names no issue, or on none. */
export const OTHER_GROUP_TITLE = "On other branches";
export const OTHER_GROUP_NOTE =
  "Branches that name no issue, and work with no branch recorded. Counted toward no issue.";

/** The header's count of cards reading Waiting for you: `2 waiting for you`.
 *  The same words for one and for many, so no plural to agree. */
export const waitingCount = (n: number) =>
  `${n.toLocaleString("en-GB")} waiting for you`;

/** `n sessions`, the plural agreeing with the number. */
export const sessionCount = (n: number) =>
  `${n.toLocaleString("en-GB")} ${n === 1 ? "session" : "sessions"}`;

/**
 * Elapsed time: seconds under a minute, minutes and seconds under an hour,
 * hours and minutes above that — `55s`, `1m 55s`, `2h 5m`. An em dash when
 * there is nothing to measure between.
 */
export function formatElapsed(ms: number | null): string {
  if (ms === null) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
