import { test, expect, type Page } from "@playwright/test";
import { exec } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { ROUTE } from "../../apps/web/src/lib/routes";
import { USAGE_COLUMNS } from "../../apps/web/src/dev/usage-copy";
import {
  GH_ISSUES_FIXTURE_PATH,
  removeGhIssuesFixture,
  writeGhIssuesFixture,
} from "./fixtures/gh-issues";
import {
  resetTranscriptWorkingCopy,
  TRANSCRIPT_WORKING_DIR,
  USAGE_HISTORY_PATH,
} from "./fixtures/transcript-fixture";

/**
 * Slice 1 of `docs/plans/usage-history.md` (#417): a scan stores what it read,
 * so an issue keeps its spend after Claude Code deletes the transcript it came
 * from, and the page says from which date its history runs.
 *
 * Driven through the real middleware: the web server's `USAGE_HISTORY_FILE` is
 * `USAGE_HISTORY_PATH` (`playwright.config.ts`), a gitignored file that
 * `resetTranscriptWorkingCopy` removes along with remaking the transcripts, so
 * the first scan here starts from no history at all.
 *
 * The figures are the fixture README's, restated as literals for the reason
 * `dev-usage.spec.ts` restates them: computed with the code under test, a
 * wrong figure would agree with itself.
 */

/** `session-b.jsonl`'s two issues, from `fixtures/transcripts/README.md`. */
const SESSION_B = { issue102: "3,000", issue105: "90,000" } as const;

/** The first line of `session-a.jsonl`, the earliest timestamp in either file. */
const HISTORY_SINCE = "2026-09-02T09:00:00.000Z";

const OUT = USAGE_COLUMNS.indexOf("out");

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/**
 * `bun run tokens` against the same three overrides the web server has, so it
 * reads the same working copy and the same history (R3). Spawned through a
 * shell for the reason `dev-usage-guardrail.spec.ts` gives: `bun` on PATH is a
 * `.cmd` shim on Windows.
 */
const tokens = async () =>
  (
    await promisify(exec)("bun run tokens", {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        CLAUDE_TRANSCRIPT_DIR: TRANSCRIPT_WORKING_DIR,
        GH_ISSUES_FILE: GH_ISSUES_FIXTURE_PATH,
        USAGE_HISTORY_FILE: USAGE_HISTORY_PATH,
      },
      encoding: "utf8",
    })
  ).stdout;

const reading = (page: Page) => page.getByText(/^Gathered at/);

/** A row by its issue number, `exact` so `#10` cannot match `#105`. */
const outFor = (page: Page, issue: number) =>
  page
    .getByRole("region", { name: "Issue spend" })
    .getByRole("row")
    .filter({
      has: page.getByRole("rowheader", { name: `#${issue}`, exact: true }),
    })
    .getByRole("cell")
    .nth(OUT);

test.describe("dev tools: Usage history", () => {
  test.beforeEach(async ({ page }) => {
    writeGhIssuesFixture();
    resetTranscriptWorkingCopy();
    await page.goto(ROUTE.devUsage.path);
  });

  test.afterAll(() => removeGhIssuesFixture());

  test("an issue keeps its spend after the transcript it was read from is deleted", async ({
    page,
  }) => {
    const scan = page.getByRole("button", { name: "Scan" });

    await scan.click();
    await expect(reading(page)).toContainText("2 transcripts");
    // Before anything else is read: a Vite adopted on 4001 from another session
    // has none of the overrides, and would be reading — and writing — this
    // machine's own transcripts and history.
    await expect(reading(page)).toContainText(TRANSCRIPT_WORKING_DIR);
    expect(existsSync(USAGE_HISTORY_PATH)).toBe(true);
    await expect(outFor(page, 102)).toHaveText(SESSION_B.issue102);
    await expect(outFor(page, 105)).toHaveText(SESSION_B.issue105);

    // Closed before the response, so nothing holds the file and Windows lets
    // the transcript go as Claude Code's own cleanup would.
    rmSync(path.join(TRANSCRIPT_WORKING_DIR, "session-b.jsonl"));
    await scan.click();

    await expect(reading(page)).toContainText("1 transcript,");
    await expect(outFor(page, 102)).toHaveText(SESSION_B.issue102);
    await expect(outFor(page, 105)).toHaveText(SESSION_B.issue105);

    // And the terminal, off the same history with the transcript still gone.
    // Its figures are rounded to thousands: 3,000 and 90,000 print as 3k, 90k.
    test.setTimeout(60_000);
    const stdout = await tokens();
    expect(stdout).toMatch(/^#102\s.*\s3k\s/m);
    expect(stdout).toMatch(/^#105\s.*\s90k\s/m);
  });

  test("names the earliest date the stored history covers, after its transcript is gone", async ({
    page,
  }) => {
    const scan = page.getByRole("button", { name: "Scan" });
    const since = page.getByText(/^History from/).locator("time");

    await scan.click();
    await expect(since).toHaveAttribute("datetime", HISTORY_SINCE);

    rmSync(path.join(TRANSCRIPT_WORKING_DIR, "session-a.jsonl"));
    await scan.click();

    await expect(reading(page)).toContainText("1 transcript,");
    await expect(since).toHaveAttribute("datetime", HISTORY_SINCE);
  });
});
