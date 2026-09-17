import { test, expect } from "@playwright/test";
import { ROUTE } from "../../apps/web/src/lib/routes";
import { TRANSCRIPT_FIXTURE_DIR } from "./fixtures/transcript-fixture";

/**
 * Slice 1 of `docs/plans/dev-tools-usage-page.md` (#248), end to end: page →
 * dev middleware → `apps/web/dev/usage.ts` → the filesystem, all real.
 *
 * It is the whole reason the transcript directory got a resolver with an
 * environment override. A machine's actual spend is not something an assertion
 * can name, so `playwright.config.ts` points `CLAUDE_TRANSCRIPT_DIR` at
 * `fixtures/transcripts` — two files whose totals are written down in that
 * directory's README and restated here as literals. Recomputing them with
 * `scanSpend` would make this spec agree with the code under test about
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
 * started before this config existed, or by hand — and that process has no
 * `CLAUDE_TRANSCRIPT_DIR`, so the page reports the developer's own transcripts
 * and every row assertion below fails for a reason that has nothing to do with
 * the code. Check the port owner before believing anything else here.
 */

/** The fixture's arithmetic, from `fixtures/transcripts/README.md`. */
const EXPECTED = {
  // 12,000 + 8,000 across two turns of `feat/101-a`, in one session.
  issue101: { out: "20,000", turns: "2", sessions: "1", cacheRead: "400,000" },
  // One turn of `fix/102-b`.
  issue102: { out: "3,000" },
} as const;

test.describe("dev tools: Usage", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(ROUTE.devUsage.path);
  });

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
    await expect(cells.nth(0)).toHaveText(EXPECTED.issue101.out);
    await expect(cells.nth(1)).toHaveText(EXPECTED.issue101.turns);
    await expect(cells.nth(2)).toHaveText(EXPECTED.issue101.sessions);
    await expect(cells.nth(3)).toHaveText(EXPECTED.issue101.cacheRead);

    // Sorted by spend descending, so the smaller issue is second.
    const second = rows.nth(2);
    await expect(second.getByRole("rowheader")).toHaveText("#102");
    await expect(second.getByRole("cell").nth(0)).toHaveText(
      EXPECTED.issue102.out,
    );
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
