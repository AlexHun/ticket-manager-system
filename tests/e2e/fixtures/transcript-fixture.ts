import { cpSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The two-branch transcript fixture both Usage specs (`dev-usage.spec.ts` and
 * `dev-usage-guardrail.spec.ts`) assert against.
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
 * `docs/plans/usage-history.md`) will need a spec that deletes a transcript
 * between two scans, or appends to one. Done to the checked-in files, either
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
 * Replaces the working copy with a fresh one of the checked-in fixtures.
 *
 * Removed first rather than copied over, so a file an earlier test (or an
 * earlier run that died part-way) added, grew or deleted cannot survive into
 * the next scan: what the page reads is always exactly what is checked in.
 *
 * Safe only because the suite runs one test at a time (`workers: 1` in
 * `playwright.config.ts`): with a second worker, this could pull the directory
 * out from under another spec's scan.
 */
export function resetTranscriptWorkingCopy(): void {
  rmSync(TRANSCRIPT_WORKING_DIR, { recursive: true, force: true });
  cpSync(TRANSCRIPT_FIXTURE_DIR, TRANSCRIPT_WORKING_DIR, { recursive: true });
}
