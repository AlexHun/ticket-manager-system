import { test, expect, type Page } from "@playwright/test";
import { exec } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { ROUTE } from "../../apps/web/src/lib/routes";
import { DEVTOOLS_API } from "../../apps/web/src/dev/devtools-paths";
import {
  USAGE_COLUMNS,
  USAGE_TREND_LABEL,
} from "../../apps/web/src/dev/usage-copy";
import { USAGE_WARNING_SOURCE } from "../../apps/web/src/dev/usage-protocol";
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
 * from, and the page says from which date its history runs. Slice 2 (#418): a
 * scan reads only what was appended since the last one. Slice 3 (#419): one
 * trend point per day with a scan, today's equal to the panels above it.
 * Slice 4 (#420): a deleted history is rebuilt, a damaged one is a warning.
 * And #432: the page opens on the stored reading, with no Scan.
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

/** `session-a.jsonl`'s one issue, from the same README. */
const SESSION_A = { issue101: "20,000" } as const;

/** The first line of `session-a.jsonl`, the earliest timestamp in either file. */
const HISTORY_SINCE = "2026-09-02T09:00:00.000Z";

/** The first line of `session-b.jsonl`: where a history rebuilt without
 *  `session-a.jsonl` starts (#420). */
const SESSION_B_SINCE = "2026-09-03T10:00:00.000Z";

/** The em dash `NotStarted` draws for a row with no recorded work: the same
 *  dash as `Unknown`, which means something else (`dev-usage.spec.ts`). */
const NOT_STARTED = "—";

const OUT = USAGE_COLUMNS.indexOf("out");

/** Every warning the page draws, each stamped with its source (#420). */
const warnings = (page: Page) => page.locator("[data-usage-warning]");

/**
 * The two panels' figures over the fixtures (README: "What the bands and the
 * listing make of these figures"), and what a trend point's cells must read for
 * the same scan: accuracy, then p25 / median / p75, then the band edges
 * `BUCKETS` holds today.
 */
const PANELS = {
  accuracy: "1/2 on target (50%)",
  quartiles: "p25 3,000 · median 20,000 · p75 90,000",
  quartileCells: ["3,000", "20,000", "90,000"],
  edges: "S <60,000 · M <150,000 · L <250,000",
} as const;

/** After 40,000 more output tokens on `#102` (3,000 → 43,000): the sorted
 *  totals are 20,000, 43,000, 90,000. `#102` carries no forecast, so the
 *  accuracy figure does not move. */
const SECOND_SCAN = {
  quartiles: "p25 20,000 · median 43,000 · p75 90,000",
  quartileCells: ["20,000", "43,000", "90,000"],
} as const;

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
const runTokens = () =>
  promisify(exec)("bun run tokens", {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      CLAUDE_TRANSCRIPT_DIR: TRANSCRIPT_WORKING_DIR,
      GH_ISSUES_FILE: GH_ISSUES_FIXTURE_PATH,
      USAGE_HISTORY_FILE: USAGE_HISTORY_PATH,
    },
    encoding: "utf8",
  });

const tokens = async () => (await runTokens()).stdout;

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

  /**
   * Slice 2 (#418): a scan reads only what was written since the last one. A
   * transcript that grew between two scans adds exactly its new response — and
   * nothing for a second content block of a response a previous scan already
   * stored, which only the store can recognise once the reads are incremental.
   *
   * Appended to `session-b.jsonl`, which ends on a newline; `session-a.jsonl`
   * ends on its deliberately truncated line, which an append would complete.
   */
  test("a transcript that grew adds exactly its new response, on the page and in the terminal", async ({
    page,
  }) => {
    const scan = page.getByRole("button", { name: "Scan" });
    const sessionB = path.join(TRANSCRIPT_WORKING_DIR, "session-b.jsonl");
    /** One content block of an API response on `#102`'s branch. */
    const block = (id: string, out: number, minute: number) =>
      `${JSON.stringify({
        sessionId: "b",
        gitBranch: "fix/102-b",
        timestamp: `2026-09-03T10:${minute}:00.000Z`,
        message: {
          id,
          usage: { output_tokens: out, cache_read_input_tokens: 0 },
        },
      })}\n`;

    await scan.click();
    await expect(reading(page)).toContainText(TRANSCRIPT_WORKING_DIR);
    await expect(outFor(page, 102)).toHaveText(SESSION_B.issue102);

    appendFileSync(sessionB, block("msg_appended_1", 1000, 10));
    await scan.click();
    await expect(outFor(page, 102)).toHaveText("4,000");

    // The same response's second block, then a response of its own.
    appendFileSync(
      sessionB,
      block("msg_appended_1", 1000, 10) + block("msg_appended_2", 2000, 11),
    );
    await scan.click();
    await expect(outFor(page, 102)).toHaveText("6,000");
    // Nothing else moved: the rest of the file was not read twice.
    await expect(outFor(page, 105)).toHaveText(SESSION_B.issue105);

    // R3: the terminal, off the same history, after the same incremental reads.
    test.setTimeout(60_000);
    const stdout = await tokens();
    expect(stdout).toMatch(/^#102\s.*\s6k\s/m);
    expect(stdout).toMatch(/^#105\s.*\s90k\s/m);
  });

  /**
   * Slice 3 (#419): one trend point per local calendar day with a scan. Today's
   * equals the two panels above it, and a second scan the same day replaces it
   * rather than adding one. Moving to a later day is `apps/web/dev/usage.test.ts`'s,
   * with an injected clock — Playwright cannot move a day.
   */
  test("the trend holds one point for today, equal to the panels, however often it is scanned", async ({
    page,
  }) => {
    const scan = page.getByRole("button", { name: "Scan" });
    const points = page
      .getByRole("region", { name: USAGE_TREND_LABEL.points })
      .getByRole("row")
      // The header row has no row header; every point's day is one.
      .filter({ has: page.getByRole("rowheader") });
    const accuracy = page.getByRole("region", { name: "Forecast accuracy" });
    const distribution = page.getByRole("region", {
      name: "Output distribution",
    });

    await scan.click();
    await expect(reading(page)).toContainText(TRANSCRIPT_WORKING_DIR);
    await expect(points).toHaveCount(1);
    await expect(accuracy).toContainText(PANELS.accuracy);
    await expect(distribution).toContainText(PANELS.quartiles);
    await expect(points.first().getByRole("cell")).toHaveText([
      PANELS.accuracy,
      ...PANELS.quartileCells,
      PANELS.edges,
    ]);

    // A second scan the same day, after the figures moved: still one point,
    // now holding the second scan's quartiles. `session-b.jsonl` ends on a
    // newline, so the appended response is a line of its own.
    appendFileSync(
      path.join(TRANSCRIPT_WORKING_DIR, "session-b.jsonl"),
      `${JSON.stringify({
        sessionId: "b",
        gitBranch: "fix/102-b",
        timestamp: "2026-09-03T11:00:00.000Z",
        message: { id: "msg_trend_1", usage: { output_tokens: 40_000 } },
      })}\n`,
    );
    await scan.click();
    await expect(distribution).toContainText(SECOND_SCAN.quartiles);
    await expect(points).toHaveCount(1);
    await expect(points.first().getByRole("cell")).toHaveText([
      PANELS.accuracy,
      ...SECOND_SCAN.quartileCells,
      PANELS.edges,
    ]);
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

  /**
   * #432: the page opens on what the history holds. After a scan, a reload and
   * a navigation away and back both show its figures with no Scan pressed —
   * and from the history, not a re-read: the transcript deleted in between
   * would otherwise take `#102` and `#105` with it.
   */
  test("opens on the stored reading after a reload or a return, without a scan", async ({
    page,
  }) => {
    const accuracy = page.getByRole("region", { name: "Forecast accuracy" });
    const opened = page.getByText(/^Opened at/);

    await page.getByRole("button", { name: "Scan" }).click();
    await expect(reading(page)).toContainText(TRANSCRIPT_WORKING_DIR);
    await expect(outFor(page, 105)).toHaveText(SESSION_B.issue105);
    await expect(accuracy).toContainText(PANELS.accuracy);

    rmSync(path.join(TRANSCRIPT_WORKING_DIR, "session-b.jsonl"));
    const scans: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith(DEVTOOLS_API.usage)
      )
        scans.push(request.url());
    });

    await page.reload();
    await expect(opened).toBeVisible();
    await expect(reading(page)).toHaveCount(0);
    await expect(outFor(page, 101)).toHaveText(SESSION_A.issue101);
    await expect(outFor(page, 102)).toHaveText(SESSION_B.issue102);
    await expect(outFor(page, 105)).toHaveText(SESSION_B.issue105);
    await expect(accuracy).toContainText(PANELS.accuracy);

    const nav = page.getByRole("navigation", { name: "Dev tools" });
    await nav.getByRole("link", { name: "Project map" }).click();
    await expect(opened).toHaveCount(0);
    await nav.getByRole("link", { name: "Usage" }).click();
    await expect(opened).toBeVisible();
    await expect(outFor(page, 105)).toHaveText(SESSION_B.issue105);

    expect(scans).toEqual([]);
  });

  /**
   * Slice 4 (#420): the history is a file the developer can delete or damage,
   * and neither costs the page. Deleted, the next scan rebuilds it from the
   * transcripts still on disk — so a transcript already gone takes its spend
   * with it, and the start date moves to what remains.
   */
  test("a deleted history is rebuilt from the transcripts on disk, its start date with it", async ({
    page,
  }) => {
    const scan = page.getByRole("button", { name: "Scan" });
    const since = page.getByText(/^History from/).locator("time");

    await scan.click();
    await expect(reading(page)).toContainText(TRANSCRIPT_WORKING_DIR);
    await expect(since).toHaveAttribute("datetime", HISTORY_SINCE);
    await expect(outFor(page, 101)).toHaveText(SESSION_A.issue101);

    rmSync(path.join(TRANSCRIPT_WORKING_DIR, "session-a.jsonl"));
    rmSync(USAGE_HISTORY_PATH);
    await scan.click();

    await expect(reading(page)).toContainText("1 transcript,");
    await expect(since).toHaveAttribute("datetime", SESSION_B_SINCE);
    await expect(warnings(page)).toHaveCount(0);
    await expect(outFor(page, 102)).toHaveText(SESSION_B.issue102);
    await expect(outFor(page, 105)).toHaveText(SESSION_B.issue105);
    // `#101` is open in the listing, so it keeps a row — with nothing recorded.
    await expect(outFor(page, 101)).toHaveText(NOT_STARTED);
  });

  /**
   * Damaged, the scan reports the live figures beside one warning whose source
   * is the history, and leaves the file as it was for the developer to move or
   * delete. `bun run tokens` words its own sentence for it, naming the file and
   * the override.
   */
  test("an unreadable history costs one warning, not the figures, and is never written over", async ({
    page,
  }) => {
    // It spawns `bun run tokens` part-way through.
    test.setTimeout(60_000);
    const scan = page.getByRole("button", { name: "Scan" });
    const since = page.getByText(/^History from/).locator("time");
    const junk = "this is not a SQLite database\n".repeat(8);
    writeFileSync(USAGE_HISTORY_PATH, junk, "utf8");

    await scan.click();
    await expect(reading(page)).toContainText(TRANSCRIPT_WORKING_DIR);
    await expect(outFor(page, 101)).toHaveText(SESSION_A.issue101);
    await expect(outFor(page, 102)).toHaveText(SESSION_B.issue102);
    await expect(outFor(page, 105)).toHaveText(SESSION_B.issue105);
    // One warning, the history's: the transcripts and the listing read fine.
    await expect(warnings(page)).toHaveCount(1);
    await expect(warnings(page)).toHaveAttribute(
      "data-usage-warning",
      USAGE_WARNING_SOURCE.history,
    );
    await expect(warnings(page)).toContainText(USAGE_HISTORY_PATH);
    await expect(warnings(page)).toContainText(/delete it/);
    await expect(page.getByText(/^History from/)).toHaveCount(0);
    expect(readFileSync(USAGE_HISTORY_PATH, "utf8")).toBe(junk);

    const { stdout, stderr } = await runTokens();
    expect(stdout).toMatch(/^#101\s.*\s20k\s/m);
    expect(stderr).toContain(USAGE_HISTORY_PATH);
    expect(stderr).toContain("USAGE_HISTORY_FILE");
    expect(readFileSync(USAGE_HISTORY_PATH, "utf8")).toBe(junk);

    // Nothing holds it, so the developer can do what the warning says.
    rmSync(USAGE_HISTORY_PATH);
    await scan.click();
    await expect(warnings(page)).toHaveCount(0);
    await expect(since).toHaveAttribute("datetime", HISTORY_SINCE);
  });
});
