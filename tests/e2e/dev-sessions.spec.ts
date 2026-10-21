import { rmSync } from "node:fs";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { USER_ROLE } from "@ticket/shared";
import { ROUTE } from "../../apps/web/src/lib/routes";
import {
  NO_MODEL,
  NO_TASK,
  SESSIONS_TITLE,
  SESSION_KIND_LABEL,
} from "../../apps/web/src/dev/sessions-copy";
import { SESSION_STATE } from "../../apps/web/src/dev/sessions-protocol";
import { signIn } from "./helpers/auth";
import {
  resetTranscriptWorkingCopy,
  TRANSCRIPT_WORKING_DIR,
} from "./fixtures/transcript-fixture";

/**
 * Slice 1 of `docs/plans/dev-tools-sessions-page.md` (#590), end to end: page
 * → dev middleware → `apps/web/dev/sessions.ts` → the transcript fixture's
 * working copy, which `playwright.config.ts` names as `CLAUDE_TRANSCRIPT_DIR`.
 *
 * What each card should say is worked out in
 * `fixtures/transcripts/README.md` ("What the Sessions page makes of them")
 * and restated here as literals, for the reason `dev-usage.spec.ts` gives:
 * recomputing it with the code under test would agree with any answer.
 *
 * The directory assertion comes first for that spec's reason too: a leftover
 * Vite on 4001, adopted by `reuseExistingServer`, reads this machine's own
 * transcripts, and every card below would then be wrong for a reason that has
 * nothing to do with the code.
 */

/** A session's card is named for its transcript, `<session>.jsonl`. */
const SESSION_A = "session-a";
const SESSION_B = "session-b";
const REVIEW = "a1111111111111111";
const NESTED = "a2222222222222222";
const BAD_META = "session-a/subagents/agent-a3333333333333333.meta.json";

/** The fixture's cards, from its README. */
const EXPECTED = {
  [SESSION_B]: {
    task: NO_TASK,
    type: SESSION_KIND_LABEL,
    model: NO_MODEL,
    state: SESSION_STATE.done,
    elapsed: "5m 0s",
    out: "93,000 output tokens",
  },
  [SESSION_A]: {
    task: "Implement issue #101.",
    type: SESSION_KIND_LABEL,
    model: "claude-opus-5-5",
    state: SESSION_STATE.running,
    elapsed: "15m 0s",
    out: "32,000 output tokens",
  },
  [REVIEW]: {
    task: "Review the fixture",
    type: "general-purpose",
    model: "claude-opus-5-5",
    state: SESSION_STATE.done,
    elapsed: "1m 55s",
    out: "8,000 output tokens",
  },
  [NESTED]: {
    task: "Find the fixture's specs",
    type: "Explore",
    model: "claude-haiku-5-5",
    state: SESSION_STATE.running,
    elapsed: "55s",
    out: "4,000 output tokens",
  },
} as const;

/** A card anywhere under `scope`. */
const cardIn = (scope: Page | Locator, id: string) =>
  scope.locator(`[data-session-card="${id}"]`);

/** A card directly under `parent`: one level down, never two. */
const childOf = (parent: Locator, id: string) =>
  parent.locator(`:scope > ol > li > [data-session-card="${id}"]`);

/** A card's own facts, not those of the subagents nested under it. */
const own = (card: Locator) => card.locator(":scope > div");

async function expectCard(card: Locator, id: keyof typeof EXPECTED) {
  const want = EXPECTED[id];
  const facts = own(card);
  await expect(facts.getByRole("heading")).toHaveText(want.task);
  await expect(facts.locator('[data-session-fact="Type"]')).toHaveText(
    want.type,
  );
  await expect(facts.locator('[data-session-fact="Model"]')).toHaveText(
    want.model,
  );
  await expect(facts.locator("[data-session-state]")).toHaveText(want.state);
  await expect(facts.locator('[data-session-fact="Elapsed"]')).toHaveText(
    want.elapsed,
  );
  await expect(facts.locator('[data-session-fact="Own output"]')).toHaveText(
    want.out,
  );
}

test.describe("dev tools: Sessions", () => {
  test.beforeEach(() => {
    resetTranscriptWorkingCopy();
  });

  test("reaches the page from the dev tools nav", async ({ page }) => {
    await page.goto(ROUTE.devMap.path);

    await page
      .getByRole("navigation", { name: "Dev tools" })
      .getByRole("link", { name: SESSIONS_TITLE, exact: true })
      .click();

    await expect(page).toHaveURL(new RegExp(`${ROUTE.devSessions.path}$`));
    await expect(
      page.getByRole("heading", { name: SESSIONS_TITLE, exact: true }),
    ).toBeVisible();
  });

  test("reaches the page from the sidebar's Dev group", async ({ page }) => {
    await signIn(page, USER_ROLE.admin);

    await page.getByRole("link", { name: SESSIONS_TITLE, exact: true }).click();

    await expect(page).toHaveURL(new RegExp(`${ROUTE.devSessions.path}$`));
  });

  test("draws the fixture's tree with the API unreachable, a warning naming the bad meta file", async ({
    page,
    baseURL,
  }) => {
    // Every request that is not to the Vite dev server fails, so a page that
    // leaned on the API, and through it the database, could not render a
    // single card.
    const devServer = new URL(baseURL ?? "").origin;
    await page.route(
      (url) => url.origin !== devServer,
      (route) => route.abort(),
    );

    await page.goto(ROUTE.devSessions.path);

    const main = page.getByRole("main");
    await expect(main).toContainText(TRANSCRIPT_WORKING_DIR);
    await expect(main).toContainText("2 sessions read from");

    // Most recently started first. A session's own card is the first in its
    // list item, in document order; the rest are nested under it.
    const sessions = main.locator(":scope > ol > li");
    await expect(sessions).toHaveCount(2);
    const outermost = (i: number) =>
      sessions.nth(i).locator("[data-session-card]").first();
    await expect(outermost(0)).toHaveAttribute("data-session-card", SESSION_B);
    await expect(outermost(1)).toHaveAttribute("data-session-card", SESSION_A);

    const a = cardIn(page, SESSION_A);
    const review = childOf(a, REVIEW);
    const nested = childOf(review, NESTED);
    await expect(review).toHaveCount(1);
    await expect(nested).toHaveCount(1);
    // Under the subagent that started it, and not beside it.
    await expect(childOf(a, NESTED)).toHaveCount(0);
    await expect(
      cardIn(page, SESSION_B).locator("[data-session-card]"),
    ).toHaveCount(0);

    await expectCard(cardIn(page, SESSION_B), SESSION_B);
    await expectCard(a, SESSION_A);
    await expectCard(review, REVIEW);
    await expectCard(nested, NESTED);

    // The unparseable meta file is named, and costs its own card only.
    const warning = page.locator(`[data-sessions-warning="${BAD_META}"]`);
    await expect(warning).toHaveCount(1);
    await expect(warning).toContainText(BAD_META);
    await expect(warning).toContainText("Couldn't read");
    await expect(cardIn(page, "a3333333333333333")).toHaveCount(0);
  });

  test("reads again on Refresh", async ({ page }) => {
    await page.goto(ROUTE.devSessions.path);
    await expect(cardIn(page, SESSION_A)).toBeVisible();

    rmSync(`${TRANSCRIPT_WORKING_DIR}/session-b.jsonl`);
    await page.getByRole("button", { name: "Refresh" }).click();

    await expect(cardIn(page, SESSION_B)).toHaveCount(0);
    await expect(cardIn(page, SESSION_A)).toBeVisible();
  });

  test("says where it looked when there are no transcripts at all", async ({
    page,
  }) => {
    rmSync(TRANSCRIPT_WORKING_DIR, { recursive: true, force: true });

    await page.goto(ROUTE.devSessions.path);

    const main = page.getByRole("main");
    await expect(main.getByText(/^No sessions in/)).toContainText(
      TRANSCRIPT_WORKING_DIR,
    );
    await expect(main.locator("[data-session-card]")).toHaveCount(0);
  });

  /**
   * R12: Claude Code's workers are sessions and subagents, and their progress
   * a state or a step, because `GLOSSARY.md` gives the other words to the
   * desk. File and directory names are left out of the check: they are
   * Claude Code's (`agent-<id>.meta.json`), not the page's words.
   */
  test("never uses the desk's words for Claude Code's workers", async ({
    page,
  }) => {
    await page.goto(ROUTE.devSessions.path);
    await expect(cardIn(page, SESSION_A)).toBeVisible();

    const words = await page.getByRole("main").evaluate((main) => {
      const copy = main.cloneNode(true) as HTMLElement;
      copy.querySelectorAll("code").forEach((code) => code.remove());
      const labels = [...main.querySelectorAll("[aria-label]")].map(
        (el) => el.getAttribute("aria-label") ?? "",
      );
      return [copy.textContent ?? "", ...labels].join(" ");
    });

    expect(words).not.toMatch(/\b(agents?|runs?|status|stages?|handoffs?)\b/i);
  });
});
