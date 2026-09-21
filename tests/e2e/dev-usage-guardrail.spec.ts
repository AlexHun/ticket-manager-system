import { test, expect, type Locator, type Page } from "@playwright/test";
import { exec } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  GH_ISSUES_FIXTURE_PATH,
  removeGhIssuesFixture,
  writeGhIssuesFixture,
} from "./fixtures/gh-issues";
import { TRANSCRIPT_FIXTURE_DIR } from "./fixtures/transcript-fixture";

/**
 * Slice 1 of `docs/plans/usage-page-module-seams.md` (#283): the observer the
 * rest of that plan is measured by.
 *
 * Every later slice in that plan moves code whose only promise is that **the
 * output does not change** (R8). Before this file, neither surface could say
 * whether it had. `dev-usage.spec.ts` next door asserts particular cells — the
 * figures the fixture was built to pin — and is deliberately silent about
 * everything around them; `bun run tokens` had no test of any kind, and nothing
 * in the repository drove that script at all. "Byte-identical" was an intention.
 *
 * So this spec captures **both** surfaces whole and compares them to committed
 * snapshots: the Usage page's reading line, its table in both column states and
 * its three panels, and the stdout of `bun run tokens` spawned as a child with
 * the same two environment overrides. A moved figure, a renamed label or a
 * reordered row fails here whatever caused it.
 *
 * ## How this differs from `dev-usage.spec.ts`, deliberately
 *
 * That spec imports `USAGE_COLUMNS`, `USAGE_DETAIL_LABEL` and the rest from
 * `apps/web/src/dev/protocol.ts` rather than retyping them, for the reason
 * `route-timing.spec.ts` imports its mark names: a spec that restates a string
 * cannot catch a rename of it.
 *
 * **This file inverts that rule, and the inversion is the point.** Slice 2
 * splits `protocol.ts` three ways, and the plan's done bar is that this
 * guardrail passes *unchanged* through every slice — a guardrail that had to be
 * edited is a slice that changed the measurement. An import of a module the
 * refactor is about would force exactly that edit. And the rename hazard it
 * costs is one this file is immune to anyway: a renamed column header or panel
 * title is text on screen, so it moves the snapshot and fails here; a renamed
 * *accessible* name breaks the locator, which is also a change to the surface
 * and also a failure. The only things imported are the two test-side fixture
 * modules, which no slice of that plan touches.
 *
 * ## What is masked, and what is not
 *
 * Two values vary per run and are not a measurement: the moment the scan was
 * taken and how long it took. Both live on the reading line, and both are
 * replaced by a placeholder there. Nothing else is.
 *
 * The transcript directory on that same line is **not** masked — it is
 * re-expressed relative to the repository root with `/` separators, so the
 * snapshot holds the same claim on a Windows dev machine and on CI's Linux
 * runner. A page reading anywhere else still fails: a leftover dev server
 * started without `CLAUDE_TRANSCRIPT_DIR` reports `~/.claude/projects/...`,
 * which relativises to a path full of `..` and lands in the diff. That case is
 * also asserted outright before anything is captured, because it is the first
 * thing to suspect on a red run — `reuseExistingServer` will adopt a Vite
 * already on 4001, and that process has neither override.
 *
 * ## Updating the snapshots
 *
 * `bun run test:e2e -- --update-snapshots dev-usage-guardrail`. Read the diff
 * first: inside the plan above, a diff is the finding, not the chore.
 */

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** Stands in for the moment the scan was taken. */
const GATHERED_AT = "<gathered-at>";
/** Stands in for how long the scan took. */
const SCAN_MS = "<scan-ms>";

/**
 * The two per-run values, wherever they appear in a captured surface.
 *
 * Applied to both snapshots from one function rather than to one of them from
 * two regexes: "the gathered-at time and the scan duration are masked, and
 * nothing else is" is a single rule about this guardrail, and the terminal is
 * not exempt from it merely because the script prints no duration today.
 *
 * The timestamp cannot be found by pattern — it is rendered in the runner's
 * locale — so callers that have one pass the exact string they read off the
 * `<time>` element, which is the only place either surface holds it.
 */
const maskVolatile = (text: string, stamp?: string) =>
  (stamp ? text.split(stamp).join(GATHERED_AT) : text).replace(
    /read in \d+ ms/g,
    `read in ${SCAN_MS} ms`,
  );

/** A directory as the snapshot spells it: relative to the repository root, with
 *  `/` separators, so one committed file serves Windows and CI alike. */
const portable = (dir: string) =>
  path.relative(REPO_ROOT, dir).split(path.sep).join("/");

/** Trailing whitespace and CRLF are not part of either surface's claim, and a
 *  checkout that rewrote line endings would otherwise fail every line at once. */
const tidy = (text: string) =>
  text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();

/** The scrollable frame the table is drawn in. Named, because `TableFrame`
 *  gives every scroller a `region` role and an `aria-label` (#111). */
const spendTable = (page: Page) =>
  page.getByRole("region", { name: "Issue spend" });

/**
 * The table as text: one line per row, cells separated by ` | `.
 *
 * Walked cell by cell rather than taken as one `innerText` of the frame, which
 * was tried first and is what a reader of a red run pays for. Chromium does
 * separate cells with `\t` and rows with `\n` — but a cell holding block-level
 * children (the merged forecast-versus-actual one, three facts in one cell
 * since #270) breaks *inside* itself, so a row arrives as five lines and a
 * reordering shows up as a diff nobody can read. Collapsing each cell's own
 * whitespace first puts one row on one line, which is the row order and the
 * column order in a shape a diff can name.
 */
const tableText = async (page: Page) =>
  (
    await spendTable(page).evaluate((frame) =>
      Array.from(frame.querySelectorAll("tr")).map((row) =>
        Array.from(row.querySelectorAll("th, td"))
          .map((cell) =>
            ((cell as HTMLElement).innerText ?? "").replace(/\s+/g, " ").trim(),
          )
          .join(" | "),
      ),
    )
  ).join("\n");

/**
 * A panel as text, chart included.
 *
 * `innerText` reaches the Recharts labels as well as the prose — measured, not
 * assumed: the axis ticks, the bar values and the quartile marks are SVG
 * `<text>` nodes, and Chromium renders them into `innerText` in document order.
 * Gathering them a second time through `svg text` was tried and only put every
 * label in the snapshot twice.
 */
const panelText = async (panel: Locator) => tidy(await panel.innerText());

const section = (heading: string, body: string) => `## ${heading}\n\n${body}`;

/**
 * What every test here assigns to `testInfo.snapshotSuffix`, and why it is not
 * simply left alone.
 *
 * Playwright's default suffix is `process.platform`, so the first local run
 * wrote `usage-page-chromium-win32.txt` — a name CI's Linux runner never looks
 * for, where a missing snapshot is a hard failure rather than something written
 * on the way past. Neither surface here is platform-dependent: both read the
 * same committed fixtures through the same modules, and the two things that
 * would have differed (line endings and the absolute transcript path) are
 * already handled by `tidy` and `portable`. One committed file serves both.
 *
 * The documented fix for this is `snapshotPathTemplate` in
 * `playwright.config.ts`, and it is out of reach: #283 modifies no file outside
 * `tests/e2e/`, because a guardrail that changed the harness it runs in would
 * be measuring something other than the surfaces it was built to watch. The
 * per-test property is the same decision with a smaller blast radius — it binds
 * to these two tests and leaves every other spec's snapshots alone.
 */
const noPlatformSuffix = "";

test.describe("dev tools: Usage — both surfaces are unchanged", () => {
  // Written before each test rather than once: `dev-usage.spec.ts` removes this
  // file on purpose to reach the degraded no-`gh` path, and the suite runs
  // sequentially, so neither spec may assume the other left it there.
  test.beforeEach(() => writeGhIssuesFixture());

  // Generated and gitignored, but a stale one is still something to be confused
  // by later.
  test.afterAll(() => removeGhIssuesFixture());

  test("the Usage page says what it said before", async ({
    page,
  }, testInfo) => {
    testInfo.snapshotSuffix = noPlatformSuffix;

    await page.goto("/__dev/usage");
    await page.getByRole("button", { name: "Scan" }).click();

    const reading = page.getByText(/^Gathered at/);
    await expect(reading).toBeVisible();
    // Before anything is captured, and the first thing to read on a red run:
    // a Vite adopted on 4001 from an earlier session has no
    // `CLAUDE_TRANSCRIPT_DIR`, so the page below is this machine's own spend
    // against GitHub's real titles and every line of the snapshot is wrong for
    // a reason that has nothing to do with the code. Check the port owner.
    await expect(reading).toContainText(TRANSCRIPT_FIXTURE_DIR);

    const table = spendTable(page);
    await expect(table).toBeVisible();

    const accuracy = page.getByRole("region", { name: "Forecast accuracy" });
    const distribution = page.getByRole("region", {
      name: "Output distribution",
    });
    const unattributed = page.getByRole("region", {
      name: "Unattributed work",
    });
    // Settled before anything is read off them, so what lands in the snapshot
    // is the drawn chart rather than a frame on the way to it. The two strings
    // are the only figures this file names, and they are named only to wait on.
    await expect(accuracy).toContainText("on target (");
    await expect(distribution).toContainText("p25");

    const stamp = await reading.locator("time").innerText();
    const directory = await reading.locator("code").innerText();
    const readingLine = maskVolatile(
      tidy(await reading.innerText())
        .split(directory)
        .join(portable(directory)),
      stamp,
    );

    const spine = await tableText(page);
    // The other three columns, which only have a header while the toggle above
    // the table is on (#271). `aria-pressed` is asserted rather than assumed:
    // a click that silently did nothing would otherwise land a second copy of
    // the four-column table in the snapshot and read as a column having been
    // deleted.
    const toggle = page.getByRole("button", {
      name: "Show turns, sessions and cache read",
    });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    const detailed = await tableText(page);

    const captured = [
      section("reading", readingLine),
      section("table — default columns", spine),
      section("table — detail columns shown", detailed),
      section("panel — forecast accuracy", await panelText(accuracy)),
      section("panel — output distribution", await panelText(distribution)),
      section("panel — unattributed work", await panelText(unattributed)),
    ].join("\n\n");

    expect(captured).toMatchSnapshot("usage-page.txt");
  });

  test("`bun run tokens` says what it said before", async ({}, testInfo) => {
    testInfo.snapshotSuffix = noPlatformSuffix;
    // Longer than the 30s default: this spawns Bun, which type-strips the two
    // shared dev modules on the way in.
    testInfo.setTimeout(60_000);

    // The same two overrides `playwright.config.ts` puts in the web server's
    // environment, spelled the same way. Both surfaces read the same fixtures
    // through the same modules, which is the whole of R8 — so a slice that
    // moved one of them without the other fails one of these two tests and
    // names which.
    //
    // `cwd` is the repository root because that is where `bun run tokens`
    // resolves its script from, and because `resolveTranscriptDir` derives the
    // real directory from `cwd` when the override is absent — a spawn from
    // anywhere else would degrade differently if the override ever broke.
    //
    // `exec`, which goes through a shell, rather than `execFile`, which does
    // not: on this machine `bun` on PATH is npm's `bun.cmd` shim, and Node has
    // refused to spawn a `.cmd` without a shell since 20.12 — the first run of
    // this test failed with `spawn bun ENOENT`. The command carries nothing
    // interpolated, so there is no argument for a shell to reinterpret; the two
    // overrides ride in `env` and the directory in `cwd`, neither of which the
    // shell sees.
    const { stdout } = await promisify(exec)("bun run tokens", {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        CLAUDE_TRANSCRIPT_DIR: TRANSCRIPT_FIXTURE_DIR,
        GH_ISSUES_FILE: GH_ISSUES_FIXTURE_PATH,
      },
      encoding: "utf8",
    });

    expect(maskVolatile(tidy(stdout))).toMatchSnapshot("tokens-stdout.txt");
  });
});
