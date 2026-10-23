import { cpSync, readdirSync, rmSync, utimesSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The two-branch transcript fixture the Usage specs (`dev-usage.spec.ts`,
 * `dev-usage-guardrail.spec.ts` and `dev-usage-history.spec.ts`) assert
 * against.
 *
 * What the files add up to is in `transcripts/README.md`; the specs state those
 * totals as literals rather than recomputing them with the module under test.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The checked-in fixtures. Never handed to the dev server, and never written
 *  to: this is what every working copy is made from. */
export const TRANSCRIPT_FIXTURE_DIR = path.join(HERE, "transcripts");

/**
 * The directory the dev server actually reads: a gitignored working copy of
 * `TRANSCRIPT_FIXTURE_DIR`, remade by `resetTranscriptWorkingCopy` before a
 * Usage spec scans.
 *
 * A copy rather than the fixtures themselves because usage history (#416,
 * `docs/plans/usage-history.md`) needs a spec that deletes a transcript
 * between two scans (`dev-usage-history.spec.ts`), and later one that appends
 * to one. Done to the checked-in files, either
 * would corrupt them for every later run, and a run that died between the edit
 * and its undo would leave the damage in the working tree.
 *
 * Shared between `playwright.config.ts`, which puts it in the web server's
 * environment as `CLAUDE_TRANSCRIPT_DIR`, and the specs, which assert the page
 * names this directory — the same arrangement `fake-openai/constants.ts` has
 * with the stub's port. Restating the path in a spec would leave it unable to
 * tell "the fixture is wrong" from "a leftover dev server on 4001 was adopted
 * and is reading the real transcripts".
 *
 * Gitignored: `.local` marks it as generated, as `gh-issues.local.json` is.
 * Unlike that file it is left in place after a run rather than removed in
 * `afterAll`: a stale copy cannot mislead the next run, which remakes it before
 * reading, and after a red run it is what the page actually read.
 */
export const TRANSCRIPT_WORKING_DIR = path.join(HERE, "transcripts.local");

/**
 * The usage history file the dev server and `bun run tokens` write under the
 * E2E, in place of `~/.claude-usage-history/<slug>.sqlite` (#417).
 *
 * Shared the way `TRANSCRIPT_WORKING_DIR` is: `playwright.config.ts` puts it in
 * the web server's environment as `USAGE_HISTORY_FILE`, and the guardrail
 * passes it to the `bun run tokens` it spawns. Without the override, a spec's
 * scan of these fixtures would store their spend in the developer's real
 * history. Gitignored as `*.sqlite`, and never in use between scans: the store
 * is opened per request and closed before the response, so removing it here
 * cannot meet a Windows file lock.
 */
export const USAGE_HISTORY_PATH = path.join(HERE, "usage-history.local.sqlite");

/**
 * The directory of waiting records the dev server reads under the E2E, in
 * place of `~/.claude-sessions-waiting` (#592): what
 * `.claude/hooks/record-waiting.mjs` writes while a session or subagent waits
 * on the developer.
 *
 * Shared the way `TRANSCRIPT_WORKING_DIR` is: `playwright.config.ts` puts it in
 * the web server's environment as `CLAUDE_WAITING_DIR`, and
 * `dev-sessions.spec.ts` writes records into it. Without the override the page
 * would read the developer's own, and a session of this repository waiting
 * while the suite ran would be counted in the header. Gitignored as a
 * `.local` directory, and removed with the working copy so a record one spec
 * wrote never reaches the next.
 */
export const WAITING_WORKING_DIR = path.join(HERE, "waiting.local");

/**
 * Replaces the working copy with a fresh one of the checked-in fixtures, and
 * removes the usage history and the waiting records the last reading left
 * behind.
 *
 * Removed first rather than copied over, so a file an earlier test (or an
 * earlier run that died part-way) added, grew or deleted cannot survive into
 * the next scan: what the page reads is always exactly what is checked in.
 * The history goes with it for the same reason. It holds every response any
 * earlier scan read, so a transcript an earlier test deleted would otherwise
 * keep its spend, and a fixture line that has since moved would be counted
 * twice under two line numbers.
 *
 * Safe only because the suite runs one test at a time (`workers: 1` in
 * `playwright.config.ts`): with a second worker, this could pull the directory
 * out from under another spec's scan.
 */
export function resetTranscriptWorkingCopy(): void {
  rmSync(TRANSCRIPT_WORKING_DIR, { recursive: true, force: true });
  cpSync(TRANSCRIPT_FIXTURE_DIR, TRANSCRIPT_WORKING_DIR, { recursive: true });
  stampNow(TRANSCRIPT_WORKING_DIR);
  rmSync(USAGE_HISTORY_PATH, { force: true });
  rmSync(WAITING_WORKING_DIR, { recursive: true, force: true });
}

/**
 * Every file under `dir` last written now, as a copy just made is.
 *
 * The Sessions page reads a card Stopped once its files have gone unwritten
 * for `SESSION_IDLE_MS` (#591), and on Windows `cpSync` keeps the source's
 * modification time, the OS's file copy carrying it over. Without this the
 * working copy there is as old as the checkout, and every card that is not
 * Done reads Stopped once the checkout is older than the idle time.
 */
function stampNow(dir: string): void {
  const now = new Date();
  for (const entry of readdirSync(dir, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (entry.isFile())
      utimesSync(path.join(entry.parentPath, entry.name), now, now);
  }
}
