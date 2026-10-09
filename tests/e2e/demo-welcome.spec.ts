import { test, expect, type Page } from "@playwright/test";
import { DEMO_USAGE_LABEL, USER_ROLE } from "@ticket/shared";
import { HOW_IT_WORKS_LABEL } from "../../apps/web/src/lib/how-it-works/dom";
import { ROUTE } from "../../apps/web/src/lib/routes";
import {
  WELCOME_LABEL,
  WELCOME_OWNER,
  WELCOME_REPOSITORY,
} from "../../apps/web/src/lib/welcome";
import { WELCOME_STEPS } from "../../apps/web/src/lib/welcome-steps";
import { signIn } from "./helpers/auth";
import { resetDemoUsers, resetTickets, testDb } from "./helpers/db";
import { startDemoOnWelcome, writeDashboardWalkthrough } from "./helpers/demo";
import { runDemoReset } from "./helpers/demo-reset";

/**
 * The demo welcome (demo-welcome PRD, slices 1 to 3, with slice 4 folded
 * into 2): "Use demo session" lands on a welcome page, Start exploring goes on
 * to the Dashboard and its Tutorial, nothing brings the visitor back but the
 * banner's link, and nobody but a demo session can open it. Its suggested
 * steps, How it works first, each open a screen, and following them moves the
 * admin's card by one session. The owner's links and the source link carry
 * their targets, and the page holds at 375 px and from the keyboard.
 *
 * Every start comes from an address of its own (`startDemoOnWelcome`, through
 * `helpers/client-address.ts`), so the five-an-hour limit never bites here.
 */

/**
 * A Dashboard walkthrough, so R9's "the Dashboard's Tutorial still appears"
 * has something to show (`writeDashboardWalkthrough`, put back afterwards).
 */
const WALKTHROUGH_TITLE = "Demo welcome walkthrough (E2E)";

const PHONE = { width: 375, height: 812 };

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

/** The admin's "Followed a step" figure on the Users page's demo card. */
async function followedStepFigure(admin: Page): Promise<number> {
  await admin.goto(ROUTE.users.path);
  const card = admin.getByRole("region", { name: DEMO_USAGE_LABEL.title });
  await expect(card).toBeVisible();
  const text = (await card.textContent()) ?? "";
  const match = new RegExp(
    `${DEMO_USAGE_LABEL.sessionsFollowedStep}(\\d+)`,
  ).exec(text)?.[1];
  return Number(match ?? Number.NaN);
}

/** Path and query string of the page's current address. */
function pathAndQuery(page: Page): string {
  const url = new URL(page.url());
  return `${url.pathname}${url.search}`;
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

  // R4, R11, R13: after a night's reset re-creates the showcase with new ids,
  // every step still opens a real screen, and the visitor who followed them
  // all is one session on the admin's card.
  test("every suggested step opens a screen, and the admin's card counts the session once", async ({
    page,
    browser,
  }) => {
    await resetTickets();
    await runDemoReset();
    // So the card reads 0 before and 1 after, whatever earlier specs left.
    // Safe only because `workers: 1` runs specs one at a time:
    // `demo-session.spec.ts` reads the same card.
    await testDb.demoSessionTally.deleteMany();

    const adminContext = await browser.newContext();
    try {
      const admin = await adminContext.newPage();
      await signIn(admin, USER_ROLE.admin);
      expect(await followedStepFigure(admin)).toBe(0);

      await startDemoOnWelcome(page);
      const steps = page.getByRole("region", {
        name: WELCOME_LABEL.stepsHeading,
      });
      for (const step of WELCOME_STEPS) {
        await page.goto(ROUTE.welcome.path);
        const recorded = page.waitForResponse(
          (res) =>
            res.url().endsWith("/api/demo/welcome-step") &&
            res.request().method() === "POST",
        );
        await steps.getByRole("link", { name: step.sentence }).click();
        expect((await recorded).status()).toBe(204);

        const target = new URL(step.to, page.url());
        await expect
          .poll(() => pathAndQuery(page))
          .toBe(`${target.pathname}${target.search}`);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(
          page.getByRole("heading", { name: "No such page" }),
        ).toHaveCount(0);
      }

      // #466: the How it works step opens the page itself, not merely
      // something other than the not-found page.
      await page.goto(ROUTE.welcome.path);
      await steps
        .getByRole("link", { name: WELCOME_STEPS[0]!.sentence })
        .click();
      await expect(page).toHaveURL(ROUTE.howItWorks.path);
      await expect(
        page.getByRole("heading", { level: 1, name: "How it works" }),
      ).toBeVisible();
      await expect(
        page.getByRole("tab", { name: HOW_IT_WORKS_LABEL.architectureTab }),
      ).toBeVisible();

      // Six clicks over five steps, one session.
      await expect.poll(() => followedStepFigure(admin)).toBe(1);
    } finally {
      await adminContext.close();
      await resetTickets();
    }
  });

  // R3, R5: the owner's three links and the repository carry their targets.
  test("the owner's links and the source link go where they say", async ({
    page,
  }) => {
    await startDemoOnWelcome(page);
    const owner = page.getByRole("region", {
      name: WELCOME_LABEL.ownerHeading,
    });
    await expect(owner).toContainText(WELCOME_OWNER.name);
    await expect(owner).toContainText(WELCOME_OWNER.role);

    const hrefs = await owner
      .getByRole("link")
      .evaluateAll((links) => links.map((a) => a.getAttribute("href")));
    expect(hrefs).toEqual([
      "https://www.linkedin.com/in/aliaksei-hunich",
      "https://github.com/AlexHun",
      "mailto:alex.hunich@gmail.com",
    ]);
    await expect(
      page
        .getByRole("region", { name: WELCOME_LABEL.stackHeading })
        .getByRole("link", { name: WELCOME_REPOSITORY.name }),
    ).toHaveAttribute(
      "href",
      "https://github.com/AlexHun/ticket-manager-system",
    );
  });

  // R12: at 375 px nothing scrolls sideways, neither the window nor the
  // page's own scroller.
  test("reads at 375 px with no horizontal scroll", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await startDemoOnWelcome(page);
    const heading = welcomeHeading(page);
    await expect(heading).toBeVisible();
    await expect(
      page.getByRole("link", { name: WELCOME_LABEL.startExploring }),
    ).toBeAttached();

    const overflow = await heading.evaluate((h) => {
      let scroller: HTMLElement | null = h.parentElement;
      while (scroller && getComputedStyle(scroller).overflowY !== "auto") {
        scroller = scroller.parentElement;
      }
      const root = document.documentElement;
      return {
        window: root.scrollWidth - root.clientWidth,
        page: scroller ? scroller.scrollWidth - scroller.clientWidth : NaN,
      };
    });
    expect(overflow).toEqual({ window: 0, page: 0 });
  });

  // R12: from a fresh load, Tab reaches every link on the welcome and then
  // Start exploring, in the order the page reads.
  test("Tab reaches every link and Start exploring in reading order", async ({
    page,
  }) => {
    await startDemoOnWelcome(page);
    // A cold load, so focus starts at the top of the document.
    await page.goto(ROUTE.welcome.path);
    await expect(welcomeHeading(page)).toBeVisible();

    const expected = [
      ...WELCOME_STEPS.map((s) => s.sentence),
      ...WELCOME_OWNER.links.map((l) => l.name),
      WELCOME_REPOSITORY.name,
      WELCOME_LABEL.startExploring,
    ];
    // Recording starts at the first step: what comes before it is the shell
    // (skip link, sidebar, banner, top bar), not the welcome. From there every
    // stop is recorded, so nothing can slip in between or come out of order.
    const reached: string[] = [];
    // Room for the shell's stops and the page's, with plenty to spare.
    const MAX_PRESSES = 80;
    for (let presses = 0; presses < MAX_PRESSES; presses++) {
      await page.keyboard.press("Tab");
      const name = await page.evaluate(
        () => document.activeElement?.textContent?.trim() ?? "",
      );
      if (reached.length > 0 || name === expected[0]) reached.push(name);
      if (name === WELCOME_LABEL.startExploring) break;
    }
    expect(reached).toEqual(expected);
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
