import { test, expect, type Page } from "@playwright/test";
import { USER_ROLE } from "@ticket/shared";
import { ROUTE } from "../../apps/web/src/lib/routes";
import { WELCOME_LABEL } from "../../apps/web/src/lib/welcome";
import { signIn } from "./helpers/auth";
import { resetDemoUsers } from "./helpers/db";
import { startDemoOnWelcome, writeDashboardWalkthrough } from "./helpers/demo";

/**
 * The demo welcome (demo-welcome PRD, slice 1): "Use demo session" lands on a
 * welcome page, Start exploring goes on to the Dashboard and its Tutorial,
 * nothing brings the visitor back but the banner's link, and nobody but a demo
 * session can open it.
 *
 * Every start comes from an address of its own (`startDemoOnWelcome`, through
 * `helpers/client-address.ts`), so the five-an-hour limit never bites here.
 */

/**
 * A Dashboard walkthrough, so R9's "the Dashboard's Tutorial still appears"
 * has something to show (`writeDashboardWalkthrough`, put back afterwards).
 */
const WALKTHROUGH_TITLE = "Demo welcome walkthrough (E2E)";

let restoreWalkthrough: () => Promise<void>;

test.beforeAll(async () => {
  restoreWalkthrough = await writeDashboardWalkthrough(WALKTHROUGH_TITLE);
});

test.beforeEach(async () => {
  await resetDemoUsers();
});

test.afterAll(async () => {
  await resetDemoUsers();
  await restoreWalkthrough();
});

function welcomeHeading(page: Page) {
  return page.getByRole("heading", { level: 1, name: WELCOME_LABEL.title });
}

test.describe("Demo welcome", () => {
  test("a demo lands on the welcome, explores on to the Dashboard, and only the banner brings it back", async ({
    page,
    browser,
  }) => {
    // R1, R9: the welcome, with no Tutorial over it.
    await startDemoOnWelcome(page);
    await expect(welcomeHeading(page)).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // R6, R9: Start exploring reaches the Dashboard, and its Tutorial pops up.
    await page
      .getByRole("link", { name: WELCOME_LABEL.startExploring })
      .click();
    await expect(page).toHaveURL(ROUTE.dashboard.path);
    const walkthrough = page.getByRole("dialog", { name: WALKTHROUGH_TITLE });
    await expect(walkthrough).toBeVisible();
    await walkthrough.getByRole("button", { name: "Got it" }).click();
    await expect(walkthrough).toHaveCount(0);

    // R8: neither a reload nor a typed address returns to the welcome.
    await page.reload();
    await expect(page).toHaveURL(ROUTE.dashboard.path);
    await page.goto(ROUTE.tickets.path);
    await expect(page).toHaveURL(ROUTE.tickets.path);
    await expect(welcomeHeading(page)).toHaveCount(0);

    // R7: the banner links back to the welcome.
    await page
      .getByRole("region", { name: "Demo session" })
      .getByRole("link", { name: WELCOME_LABEL.bannerLink })
      .click();
    await expect(page).toHaveURL(ROUTE.welcome.path);
    await expect(welcomeHeading(page)).toBeVisible();

    // R8: a new demo session is a new click, and sees the welcome again.
    const second = await browser.newContext();
    try {
      const other = await second.newPage();
      await startDemoOnWelcome(other);
      await expect(welcomeHeading(other)).toBeVisible();
    } finally {
      await second.close();
    }
  });

  // R10: an admin or an agent lands on the Dashboard, never on the welcome,
  // and the welcome's address is not found for them.
  for (const role of [USER_ROLE.admin, USER_ROLE.agent]) {
    test(`an ${role} never lands on the welcome, and its address is not found`, async ({
      page,
    }) => {
      await signIn(page, role);
      await expect(page).toHaveURL(ROUTE.dashboard.path);

      await page.goto(ROUTE.welcome.path);
      await expect(
        page.getByRole("heading", { name: "No such page" }),
      ).toBeVisible();
      await expect(page).toHaveURL(ROUTE.welcome.path);
      await expect(welcomeHeading(page)).toHaveCount(0);
    });
  }
});
