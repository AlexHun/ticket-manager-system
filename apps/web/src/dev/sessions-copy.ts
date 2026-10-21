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

/** The page's heading, and the name of its entry in the dev tools nav. */
export const SESSIONS_TITLE = "Sessions";

/** What a session's card names as its type, where a subagent's names its
 *  subagent type. */
export const SESSION_KIND_LABEL = "Session";

/** A card whose transcript holds no prompt and whose meta file no task. */
export const NO_TASK = "No prompt recorded";

/** A card whose transcript names no model yet. */
export const NO_MODEL = "Model unknown";

/** The accessible name of the list of subagents under a card. */
export const subagentsLabel = (task: string) => `Subagents of ${task}`;

/** `n output tokens`, the plural agreeing with the number (copy.md). */
export const outputTokens = (n: number) =>
  `${n.toLocaleString("en-GB")} output ${n === 1 ? "token" : "tokens"}`;

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
