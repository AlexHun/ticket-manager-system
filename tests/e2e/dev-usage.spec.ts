import { test, expect } from "@playwright/test";
import { ROUTE } from "../../apps/web/src/lib/routes";
import {
  GH_ISSUES,
  removeGhIssuesFixture,
  writeGhIssuesFixture,
} from "./fixtures/gh-issues";
import { TRANSCRIPT_FIXTURE_DIR } from "./fixtures/transcript-fixture";

/**
 * Slices 1 and 2 of `docs/plans/dev-tools-usage-page.md` (#248, #250), end to
 * end: page → dev middleware → `apps/web/dev/usage.ts` and `issues.ts` → the
 * filesystem, all real.
 *
 * It is the whole reason both sources got a resolver with an environment
 * override. Neither is something an assertion can name — a machine's spend is
 * its own, and what this repository's issues are titled changes every time
 * somebody files one — so `playwright.config.ts` points
 * `CLAUDE_TRANSCRIPT_DIR` at `fixtures/transcripts`, two files whose totals are
 * written down in that directory's README and restated here as literals, and
 * `GH_ISSUES_FILE` at the listing in `fixtures/gh-issues.ts`. Recomputing
 * either with the code under test would make this spec agree with it about
 * anything, including a wrong answer.
 *
 * **No sign-in, no database, no API.** `/__dev` sits outside `ProtectedRoute`
 * and outside `AppShell` by construction (`DevRoutes.tsx`), and this page talks
 * only to the Vite dev server it is served from. That is the constraint the
 * feature lives inside, and this spec is what proves it still holds: it would
 * pass with :3002 and Postgres both down.
 *
 * The directory assertion is deliberate and is the first thing to read on a red
 * run. Locally, `reuseExistingServer` will adopt a Vite already on 4001 —
 * started before this config existed, or by hand — and that process has neither
 * override, so the page reports the developer's own transcripts against
 * GitHub's real titles, and every assertion below fails for a reason that has
 * nothing to do with the code. The fixture titles carry the word "Fixture" so
 * that failure names itself. Check the port owner before believing anything
 * else here.
 */

/** The fixture's arithmetic, from `fixtures/transcripts/README.md`. */
const EXPECTED = {
  // 12,000 + 8,000 across two turns of `feat/101-a`, in one session. 20,000
  // against the `forecast/S` band (<60k) in `fixtures/gh-issues.ts` is on
  // target.
  issue101: { out: "20,000", turns: "2", sessions: "1", cacheRead: "400,000" },
  // One turn of `fix/102-b`, on an issue the listing carries no band for.
  issue102: { out: "3,000" },
} as const;

/** The columns, in the order `COLUMNS` in `UsagePage.tsx` declares them. Named
 *  rather than counted at each assertion: a bare index into an eight-column row
 *  is the literal that goes stale silently when a column is inserted. */
const CELL = {
  title: 0,
  forecast: 1,
  out: 2,
  bucket: 3,
  verdict: 4,
  turns: 5,
  sessions: 6,
  cacheRead: 7,
} as const;

/** The em dash the page renders for anything `gh` could not supply. */
const UNKNOWN = "\u2014";

const [FIXTURE_101, FIXTURE_102] = GH_ISSUES;

test.describe("dev tools: Usage", () => {
  // Written before each test rather than once, because one test below removes
  // it on purpose and everything after would otherwise inherit that state.
  test.beforeEach(async ({ page }) => {
    writeGhIssuesFixture();
    await page.goto(ROUTE.devUsage.path);
  });

  // The file is generated and gitignored, but a stale one is still something to
  // be confused by later.
  test.afterAll(() => removeGhIssuesFixture());

  test("reaches the page from the dev-tools nav, beside Map and Tests", async ({
    page,
  }) => {
    await page.goto(ROUTE.devMap.path);

    const nav = page.getByRole("navigation", { name: "Dev tools" });
    await expect(nav.getByRole("link", { name: "Project map" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Tests" })).toBeVisible();

    await nav.getByRole("link", { name: "Usage" }).click();

    await expect(page).toHaveURL(new RegExp(`${ROUTE.devUsage.path}$`));
    await expect(page.getByRole("heading", { name: "Usage" })).toBeVisible();
  });

  test("shows no figures until Scan is pressed", async ({ page }) => {
    await expect(page.getByText(/nothing gathered yet/i)).toBeVisible();
    await expect(page.getByRole("region", { name: "Issue spend" })).toHaveCount(
      0,
    );
  });

  test("reads the fixture transcripts and reports each issue's spend", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Scan" }).click();

    const gathered = page.getByText(/^Gathered at/);
    await expect(gathered).toBeVisible();
    // Before the rows, because this is what a wrong answer usually means: the
    // page read somewhere other than the fixture.
    await expect(gathered).toContainText(TRANSCRIPT_FIXTURE_DIR);
    await expect(gathered).toContainText("2 transcripts");
    // The stamp survives the locale formatting beside it, and is a real date.
    const stamp = await gathered.locator("time").getAttribute("datetime");
    expect(Number.isNaN(Date.parse(stamp ?? ""))).toBe(false);

    const table = page.getByRole("region", { name: "Issue spend" });
    await expect(table).toBeVisible();

    const rows = table.getByRole("row");
    // Header, #101, #102 — and nothing else. The `main` turn, the turn on a
    // branch naming no issue, and the truncated line are all excluded.
    await expect(rows).toHaveCount(3);

    const first = rows.nth(1);
    await expect(first.getByRole("rowheader")).toHaveText("#101");
    const cells = first.getByRole("cell");
    await expect(cells.nth(CELL.out)).toHaveText(EXPECTED.issue101.out);
    await expect(cells.nth(CELL.turns)).toHaveText(EXPECTED.issue101.turns);
    await expect(cells.nth(CELL.sessions)).toHaveText(
      EXPECTED.issue101.sessions,
    );
    await expect(cells.nth(CELL.cacheRead)).toHaveText(
      EXPECTED.issue101.cacheRead,
    );

    // Sorted by spend descending, so the smaller issue is second.
    const second = rows.nth(2);
    await expect(second.getByRole("rowheader")).toHaveText("#102");
    await expect(second.getByRole("cell").nth(CELL.out)).toHaveText(
      EXPECTED.issue102.out,
    );
  });

  test("names each issue, links it to GitHub, and scores it against its band", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Scan" }).click();

    const table = page.getByRole("region", { name: "Issue spend" });
    const first = table.getByRole("row").nth(1);

    // The title is the link, and the href is `gh`'s own `url` rather than one
    // assembled from an owner and repo the page would have to know. The title
    // says "Fixture" for a reason: #101 is a real issue in this repository, so
    // a run that adopted a dev server started without `GH_ISSUES_FILE` would
    // show its real title, and this is the assertion that says so.
    const link = first.getByRole("link", { name: FIXTURE_101!.title });
    await expect(link).toHaveAttribute("href", FIXTURE_101!.url);
    await expect(link).toHaveAttribute("target", "_blank");

    const cells = first.getByRole("cell");
    // Band aimed at, band landed in, and the word comparing them.
    await expect(cells.nth(CELL.forecast)).toContainText("S");
    await expect(cells.nth(CELL.forecast)).toContainText("<60k");
    await expect(cells.nth(CELL.bucket)).toContainText("S");
    await expect(cells.nth(CELL.verdict)).toHaveText("on target");
  });

  test("leaves an issue nobody forecast unscored rather than scoring it", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Scan" }).click();

    const table = page.getByRole("region", { name: "Issue spend" });
    const second = table.getByRole("row").nth(2);

    // `gh` answered for this one, so it has a title; it simply carries no
    // `forecast/` label. No band, and above all no verdict.
    await expect(
      second.getByRole("link", { name: FIXTURE_102!.title }),
    ).toBeVisible();
    const cells = second.getByRole("cell");
    await expect(cells.nth(CELL.forecast)).toHaveText(UNKNOWN);
    await expect(cells.nth(CELL.verdict)).toHaveText(UNKNOWN);
    // The bucket is the row's own arithmetic, so it is there regardless.
    await expect(cells.nth(CELL.bucket)).toContainText("S");
  });

  /**
   * The degraded path, reached the honest way: the middleware really does fail
   * to read a listing, because the file `GH_ISSUES_FILE` names is not there.
   *
   * This is why the fixture is written by the spec instead of checked in. The
   * web server's environment is fixed when it starts and cannot vary per
   * request, and the override deliberately never falls back to `gh` — a
   * fallback would have this test read live GitHub and pass or fail depending
   * on whose machine it ran on. Removing the file is the one lever that reaches
   * the branch through the real middleware, and the state it produces is the
   * state CI is in by default.
   */
  test("keeps every figure, and says what is unknown, with no issue listing", async ({
    page,
  }) => {
    removeGhIssuesFixture();

    await page.getByRole("button", { name: "Scan" }).click();

    const table = page.getByRole("region", { name: "Issue spend" });
    const first = table.getByRole("row").nth(1);
    const cells = first.getByRole("cell");

    // Every actual survives: they are filesystem work and owe `gh` nothing.
    await expect(first.getByRole("rowheader")).toHaveText("#101");
    await expect(cells.nth(CELL.out)).toHaveText(EXPECTED.issue101.out);
    await expect(cells.nth(CELL.turns)).toHaveText(EXPECTED.issue101.turns);
    await expect(cells.nth(CELL.cacheRead)).toHaveText(
      EXPECTED.issue101.cacheRead,
    );
    await expect(cells.nth(CELL.bucket)).toContainText("S");

    // The three `gh` columns read as unknown rather than as a default.
    await expect(cells.nth(CELL.title)).toHaveText(UNKNOWN);
    await expect(cells.nth(CELL.forecast)).toHaveText(UNKNOWN);
    await expect(cells.nth(CELL.verdict)).toHaveText(UNKNOWN);
    await expect(table.getByRole("link")).toHaveCount(0);

    // And the page says why, rather than leaving three quiet columns to be read
    // as "nothing was forecast".
    await expect(
      page.getByText(/could not read the issue listing/i),
    ).toBeVisible();
  });

  test("re-reads on a second press rather than answering from the first", async ({
    page,
  }) => {
    const scan = page.getByRole("button", { name: "Scan" });

    await scan.click();
    const gathered = page.getByText(/^Gathered at/);
    await expect(gathered).toBeVisible();
    const first = await gathered.locator("time").getAttribute("datetime");

    await scan.click();

    // A held copy would carry the first reading's stamp forward. Polling rather
    // than asserting once: the second scan replaces the first in place, so there
    // is no appearing element to wait on.
    await expect
      .poll(() => gathered.locator("time").getAttribute("datetime"))
      .not.toBe(first);
    await expect(
      page.getByRole("region", { name: "Issue spend" }),
    ).toBeVisible();
  });

  test("puts the scrollable table where a keyboard can reach it", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Scan" }).click();

    const table = page.getByRole("region", { name: "Issue spend" });
    await expect(table).toBeVisible();
    // `TableFrame`'s contract (#111): a named region that is its own tab stop,
    // so the rows below the fold are reachable without a pointer.
    await expect(table).toHaveAttribute("tabindex", "0");

    await table.focus();
    await expect(table).toBeFocused();
  });
});
