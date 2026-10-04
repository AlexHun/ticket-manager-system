import { cpSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The two-branch transcript fixture `dev-usage.spec.ts` asserts against.
 *
 * What the files add up to is in `transcripts/README.md`; the spec states those
 * totals as literals rather than recomputing them with the module under test.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The checked-in fixtures. Never handed to the dev server, and never written
 *  to: this is what every working copy is made from. */
export const TRANSCRIPT_FIXTURE_DIR = path.join(HERE, "transcripts");

/**
 * The directory the dev server actually reads: a gitignored working copy of
 * `TRANSCRIPT_FIXTURE_DIR`, remade by `copyTranscriptFixture` before a Usage
 * spec scans.
 *
 * A copy rather than the fixtures themselves because usage history (#416,
 * `docs/plans/usage-history.md`) needs a spec that deletes a transcript between
 * two scans, or appends to one. Done to the checked-in files, either would
 * corrupt them for every later run, and a run that died between the edit and
 * its undo would leave the damage in the working tree.
 *
 * Shared between `playwright.config.ts`, which puts it in the web server's
 * environment as `CLAUDE_TRANSCRIPT_DIR`, and the specs, which assert the page
 * names this directory — the same arrangement `fake-openai/constants.ts` has
 * with the stub's port. Restating the path in a spec would leave it unable to
 * tell "the fixture is wrong" from "a leftover dev server on 4001 was adopted
 * and is reading the real transcripts".
 *
 * Gitignored: `.local` marks it as generated, as `gh-issues.local.json` is.
 */
export const TRANSCRIPT_WORKING_DIR = path.join(HERE, "transcripts.local");

/**
 * Replaces the working copy with a fresh one of the checked-in fixtures.
 *
 * Removed first rather than copied over, so a file an earlier test (or an
 * earlier run that died part-way) added, grew or deleted cannot survive into
 * the next scan: what the page reads is always exactly what is checked in.
 */
export function copyTranscriptFixture(): void {
  rmSync(TRANSCRIPT_WORKING_DIR, { recursive: true, force: true });
  cpSync(TRANSCRIPT_FIXTURE_DIR, TRANSCRIPT_WORKING_DIR, { recursive: true });
}
