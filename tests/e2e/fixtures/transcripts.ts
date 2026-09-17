import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The two-branch transcript fixture `dev-usage.spec.ts` asserts against.
 *
 * Shared between `playwright.config.ts`, which puts it in the web server's
 * environment as `CLAUDE_TRANSCRIPT_DIR`, and the spec, which asserts the page
 * names this directory — the same arrangement `fake-openai/constants.ts` has
 * with the stub's port. Restating the path in the spec would leave it unable to
 * tell "the fixture is wrong" from "a leftover dev server on 4001 was adopted
 * and is reading the real transcripts".
 *
 * What the files add up to is in `transcripts/README.md`; the spec states those
 * totals as literals rather than recomputing them with the module under test.
 */
export const TRANSCRIPT_FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "transcripts",
);
