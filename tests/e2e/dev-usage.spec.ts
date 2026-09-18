import { test, expect, type Locator } from "@playwright/test";
import { ROUTE } from "../../apps/web/src/lib/routes";
import {
  USAGE_COLUMNS,
  type UsageColumn,
} from "../../apps/web/src/dev/protocol";
import {
  GH_ISSUES,
  removeGhIssuesFixture,
  writeGhIssuesFixture,
} from "./fixtures/gh-issues";
import { TRANSCRIPT_FIXTURE_DIR } from "./fixtures/transcript-fixture";

/**
 * Slices 1 to 5 of `docs/plans/dev-tools-usage-page.md` (#248, #250, #251,
 * #252, #253), end to end: page → dev middleware → `apps/web/dev/usage.ts` and
 * `issues.ts` → the filesystem, all real.
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
  // The one `main` turn in `session-a.jsonl`, which belongs to no issue and is
  // in neither row above. Singular on purpose — the fixture holds exactly one,
  // so this also holds the page's "turn" / "turns" branch.
  unattributed: { turns: "1 turn", out: "5,000 output tokens" },
} as const;

/**
 * What the same fixture implies for the two charts (#252) — arithmetic, not a
 * second reading of the code under test.
 *
 * **Accuracy is 1/1, and the denominator is the interesting half.** Three rows
 * reach the page and only `#101` carries both a band and spend to read against
 * it: `#102` has figures and no `forecast/` label, `#103` has a band and no
 * work. A chart that scored either would report 1/2 or 1/3 here.
 *
 * **The distribution is two values, 20,000 and 3,000.** Nearest-rank over them
 * puts p25 on the smaller and both upper quartiles on the larger, and all three
 * land in band `S` — which is deliberately the awkward case: three marks at one
 * x is what the grouped label in `UsageCharts.tsx` exists for, and a run that
 * drew them one line each would overprint here rather than somewhere rarer.
 */
const CHARTS = {
  accuracy: "1/1 on target (100%)",
  quartiles: "p25 3,000 · median 20,000 · p75 20,000",
  measured: "2 issues with recorded spend",
} as const;

/** Where a named column sits in a row. Read off `USAGE_COLUMNS` — the same list
 *  `UsagePage.tsx` renders from — rather than counted here, for the reason
 *  `route-timing.spec.ts` imports its mark names instead of retyping them: a
 *  bare index goes stale silently when a column is inserted, and these
 *  assertions would then be checking a neighbouring cell. */
const CELL = Object.fromEntries(
  USAGE_COLUMNS.map((name, i) => [name, i]),
) as Record<UsageColumn, number>;

/** The em dash the page renders for anything it has no value for \u2014 `gh` could
 *  not supply it, or no work has been recorded against the issue yet. */
const UNKNOWN = "\u2014";

/**
 * A chart panel's x-axis tick labels, in order.
 *
 * Reaches for Recharts' own classes rather than for `svg text`, which would also
 * match the bar value labels and the quartile marks — and a bare substring match
 * on "L" catches `XL` besides. That is not a new coupling: `ui/chart.tsx`
 * already styles `.recharts-cartesian-axis-tick text`.
 *
 * **`.recharts-xAxis-tick-labels`, not `.recharts-xAxis`**, and the difference
 * cost a red run. Under Recharts 3.10 the tick text is not inside the axis
 * group: the axis renders `recharts-cartesian-axis recharts-xAxis xAxis`, and
 * the labels go into a *sibling* `recharts-cartesian-axis-tick-labels
 * recharts-xAxis-tick-labels` layer of their own, on a different z-index. A
 * descendant selector under the axis therefore matches nothing at all, which
 * reads exactly like a chart that failed to draw.
 */
const ticksOf = (panel: Locator) =>
  panel.locator(
    ".recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value",
  );

const [FIXTURE_101, FIXTURE_102, FIXTURE_103, FIXTURE_104] = GH_ISSUES;

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
    // Header, #101, #102, and the open issue nobody has started — and nothing
    // else. The `main` turn, the turn on a branch naming no issue and the
    // truncated line are all excluded, and so is the *closed* issue the listing
    // carries with no work against it.
    await expect(rows).toHaveCount(4);

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
   * R4, slice 3 (#251): the row set is every issue worth looking at, not only
   * the ones a branch spent something on.
   *
   * `#103` has no branch anywhere in `fixtures/transcripts`, so everything in
   * this row comes from the listing and everything else is empty. The empty
   * half is the part worth holding: a zero would put it in band `S`, and `S`
   * read against its `forecast/M` would print "under" — an unstarted ticket
   * scored as having beaten its estimate.
   */
  test("lists an open issue nobody has started, with its band and no figures", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Scan" }).click();

    const table = page.getByRole("region", { name: "Issue spend" });
    // Last, not third: the issues with spend come first whatever they cost, so
    // an empty actual is never read as a small one.
    const row = table.getByRole("row").nth(3);
    await expect(row.getByRole("rowheader")).toHaveText(
      `#${FIXTURE_103!.number}`,
    );
    await expect(
      row.getByRole("link", { name: FIXTURE_103!.title }),
    ).toBeVisible();

    const cells = row.getByRole("cell");
    await expect(cells.nth(CELL.forecast)).toContainText("M");
    await expect(cells.nth(CELL.forecast)).toContainText("60-150k");
    for (const column of ["out", "turns", "sessions", "cacheRead"] as const) {
      await expect(cells.nth(CELL[column])).toHaveText(UNKNOWN);
    }
    // No band landed in, and above all no verdict.
    await expect(cells.nth(CELL.bucket)).toHaveText(UNKNOWN);
    await expect(cells.nth(CELL.verdict)).toHaveText(UNKNOWN);
  });

  /**
   * The other half of the same rule. `#104` is as absent from the transcripts
   * as `#103` and carries a forecast just like it; the only difference is that
   * it is closed, and that is what decides whether an empty row is worth
   * drawing. Work finished on another machine, or before these transcripts
   * began, must not be reported as work that cost nothing.
   */
  test("leaves out a closed issue with no recorded work", async ({ page }) => {
    await page.getByRole("button", { name: "Scan" }).click();

    const table = page.getByRole("region", { name: "Issue spend" });
    await expect(table).toBeVisible();
    await expect(
      table.getByRole("rowheader", { name: `#${FIXTURE_104!.number}` }),
    ).toHaveCount(0);
    await expect(table).not.toContainText(FIXTURE_104!.title);
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

    // Header, #101, #102 — the unstarted row goes with the listing, since
    // "open" is something only the listing can say. The transcripts are all
    // there is to go on.
    await expect(table.getByRole("row")).toHaveCount(3);

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

    // The charts split the same way the columns do, and this is the honest
    // route to the acceptance criterion: with no listing there is no band
    // anywhere, so the accuracy chart has nothing to score and says so rather
    // than drawing three empty columns under an axis. The distribution is
    // untouched — it is derived from the figures, which owe `gh` nothing.
    const accuracy = page.getByRole("region", { name: "Forecast accuracy" });
    await expect(accuracy.getByRole("status")).toContainText(
      /nothing to score/i,
    );
    await expect(accuracy).not.toContainText("on target (");
    await expect(
      page.getByRole("region", { name: "Output distribution" }),
    ).toContainText(CHARTS.quartiles);
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

  /**
   * R6, slice 4 (#252): the two questions the table makes you compute by eye.
   *
   * Asserted on roles and text and never on a screenshot — Playwright's
   * `fullPage` captures catch Recharts mid-tween, so a picture of these panels
   * is a picture of whichever frame the capture landed on. The figures are the
   * fixture's own arithmetic in `CHARTS` above; the axis ticks and the quartile
   * marks are read out of the drawn `<svg>`, which is the part a component test
   * cannot reach at all (jsdom measures every chart container as zero, so
   * Recharts draws nothing there).
   */
  test("charts the forecast accuracy and the output distribution", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Scan" }).click();

    const accuracy = page.getByRole("region", { name: "Forecast accuracy" });
    await expect(accuracy).toBeVisible();
    // One row scored, and on target. Two of the three rows on this page are
    // deliberately unscorable, so a wrong denominator shows up here as 1/2 or
    // 1/3 rather than as a missing assertion.
    await expect(accuracy).toContainText(CHARTS.accuracy);
    // The axis really drew, and drew all three verdicts whether or not anything
    // landed in them: only `#101` is scored here, so a chart that dropped its
    // empty columns would leave a single tick. In `ACCURACY_ORDER`, which is an
    // axis rather than a record's key order — the two misses sit either side of
    // the hit, so the shape of the columns is the shape of the error.
    await expect(ticksOf(accuracy)).toHaveText(["under", "on target", "over"]);

    const distribution = page.getByRole("region", {
      name: "Output distribution",
    });
    await expect(distribution).toBeVisible();
    await expect(distribution).toContainText(CHARTS.quartiles);
    await expect(distribution).toContainText(CHARTS.measured);
    // All four bands on the axis, including the two nothing landed in — the
    // bands are the question this chart asks, so a band with no issues in it is
    // part of the answer.
    await expect(ticksOf(distribution)).toHaveText(["S", "M", "L", "XL"]);
    // The marks are drawn on the chart, not merely printed above it. All three
    // share band `S` here, which is exactly the case the grouped label handles.
    for (const mark of ["p25 3,000", "median 20,000", "p75 20,000"]) {
      await expect(
        distribution.locator("svg text", { hasText: mark }),
      ).toBeVisible();
    }
  });

  /**
   * A second press replaces the charts rather than leaving them behind or
   * stacking a second pair beside them.
   *
   * The figures cannot change — the fixture is fixed — so what is asserted is
   * that there is exactly *one* of each panel afterwards and it still reads
   * right. Both failures this catches are real shapes: a chart rendered outside
   * the `report &&` gate would survive a scan that failed, and a keyed list
   * getting a fresh key each press would double them.
   */
  test("redraws both charts on a fresh Scan", async ({ page }) => {
    const scan = page.getByRole("button", { name: "Scan" });
    await scan.click();
    await expect(page.getByText(/^Gathered at/)).toBeVisible();

    await scan.click();

    const accuracy = page.getByRole("region", { name: "Forecast accuracy" });
    const distribution = page.getByRole("region", {
      name: "Output distribution",
    });
    await expect(accuracy).toHaveCount(1);
    await expect(distribution).toHaveCount(1);
    await expect(accuracy).toContainText(CHARTS.accuracy);
    await expect(distribution).toContainText(CHARTS.quartiles);
  });

  /**
   * R7, slice 5 (#253): what ran on `main` is reported, as its own total.
   *
   * The fixture's `main` turn spends 5,000 output tokens, and until this slice
   * the join counted the turn and threw the tokens away — so a page that showed
   * every issue still omitted this, and the totals read as complete. The second
   * half of the assertion is the one that would catch the tempting fix: it must
   * not have become a row, because a row would give it a band, a place in the
   * distribution and a score in the accuracy figure.
   */
  test("reports the turns that ran on main as their own total", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Scan" }).click();

    const total = page.getByRole("region", { name: "Unattributed work" });
    await expect(total).toBeVisible();
    await expect(total).toContainText(EXPECTED.unattributed.turns);
    await expect(total).toContainText(EXPECTED.unattributed.out);

    // Not an issue: no number, no link, and no row of its own in the table.
    await expect(total.getByRole("link")).toHaveCount(0);
    const table = page.getByRole("region", { name: "Issue spend" });
    await expect(table.getByRole("row")).toHaveCount(4);
    await expect(table).not.toContainText("5,000");
  });

  /**
   * And no issue's figures absorbed it. `#101`'s output is the two turns of
   * `feat/101-a` and nothing else — the `main` turn sits between them in
   * `session-a.jsonl`, in the same session, which is exactly the arrangement a
   * scan that attributed by session rather than by branch would get wrong.
   */
  test("leaves the main turn out of every issue's figures", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Scan" }).click();

    const rows = page
      .getByRole("region", { name: "Issue spend" })
      .getByRole("row");
    await expect(rows.nth(1).getByRole("cell").nth(CELL.out)).toHaveText(
      EXPECTED.issue101.out,
    );
    await expect(rows.nth(1).getByRole("cell").nth(CELL.turns)).toHaveText(
      EXPECTED.issue101.turns,
    );
    // 20,000 + 5,000 is what a row that swallowed it would read.
    await expect(rows.nth(1)).not.toContainText("25,000");
    // And the distribution is quartiles of the two issues, not of three figures.
    await expect(
      page.getByRole("region", { name: "Output distribution" }),
    ).toContainText(CHARTS.measured);
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
