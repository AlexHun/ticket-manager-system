import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { USER_ROLE } from "@ticket/shared";
import { ROUTE } from "../../apps/web/src/lib/routes";
import {
  NO_MODEL,
  NO_SESSIONS_LEAD,
  NO_TASK,
  SESSIONS_TITLE,
  SESSION_KIND_LABEL,
  sessionCount,
  waitingCount,
} from "../../apps/web/src/dev/sessions-copy";
import {
  SESSION_IDLE_MS,
  SESSION_STATE,
} from "../../apps/web/src/dev/sessions-protocol";
import { signIn } from "./helpers/auth";
import {
  resetTranscriptWorkingCopy,
  TRANSCRIPT_WORKING_DIR,
  WAITING_WORKING_DIR,
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
/** The subagent whose meta file is cut off mid-key, on purpose. */
const UNPARSEABLE = "a3333333333333333";
const BAD_META = `session-a/subagents/agent-${UNPARSEABLE}.meta.json`;

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

/**
 * R4: a change on disk is on the open page within 5 seconds. Every live
 * assertion waits this long and no longer, so a slower stream fails here.
 */
const R4_MS = 5_000;

const SESSION_A_FILE = "session-a.jsonl";
const SUBAGENTS = `${TRANSCRIPT_WORKING_DIR}/session-a/subagents`;

/**
 * A response of 1,000 output tokens appended to `session-a.jsonl`, taking the
 * session from the README's 32,000 to 33,000. No timestamp, so its elapsed
 * time stands. (The fixture's cut-off line ends in a newline in the
 * repository, so finishing it is not on offer: what followed would be a
 * second bad line.)
 */
const NEW_RESPONSE = `${JSON.stringify({
  sessionId: "a",
  gitBranch: "feat/101-a",
  message: { usage: { output_tokens: 1000 } },
})}\n`;

/** A subagent started while the page is open, by `LIVE_CALL`'s call. */
const LIVE = "a4444444444444444";
const LIVE_META = {
  agentType: "Explore",
  description: "Follow the fixture live",
  toolUseId: "toolu_fixture_live",
};
/** Session a's response that makes the call: 500 output tokens more. */
const LIVE_CALL = `${JSON.stringify({
  sessionId: "a",
  gitBranch: "feat/101-a",
  timestamp: "2026-09-02T09:15:00.000Z",
  message: {
    model: "claude-opus-5-5",
    content: [
      { type: "tool_use", id: LIVE_META.toolUseId, name: "Agent", input: {} },
    ],
    usage: { output_tokens: 500 },
  },
})}\n`;
const LIVE_RESPONSE = `${JSON.stringify({
  timestamp: "2026-09-02T09:15:00.000Z",
  message: { model: "claude-haiku-5-5", usage: { output_tokens: 600 } },
})}\n`;
/** 32,000 + the new response's 1,000 + the call's 500. */
const LIVE_SESSION_OUT = "33,500 output tokens";

function appendTranscript(file: string, ...text: string[]) {
  appendFileSync(`${TRANSCRIPT_WORKING_DIR}/${file}`, text.join(""), "utf8");
}

/** Writes a subagent's meta file, and its transcript when given one. */
function writeSubagent(id: string, meta: object, transcript?: string) {
  writeFileSync(`${SUBAGENTS}/agent-${id}.meta.json`, JSON.stringify(meta));
  if (transcript !== undefined) {
    writeFileSync(`${SUBAGENTS}/agent-${id}.jsonl`, transcript);
  }
}

/** Every file of session a, last written a minute past the idle time ago. */
function backdateSessionA() {
  const at = (Date.now() - SESSION_IDLE_MS - 60_000) / 1000;
  utimesSync(`${TRANSCRIPT_WORKING_DIR}/${SESSION_A_FILE}`, at, at);
  for (const name of readdirSync(SUBAGENTS)) {
    utimesSync(`${SUBAGENTS}/${name}`, at, at);
  }
}

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
  await expect(facts.locator('[data-session-fact="State"]')).toHaveText(
    want.state,
  );
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
    await expect(main).toContainText(`${sessionCount(2)} read from`);

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
    await expect(cardIn(page, UNPARSEABLE)).toHaveCount(0);
  });

  test("follows the transcripts without a reload: a new response, a new subagent, a change of state", async ({
    page,
  }) => {
    await page.goto(ROUTE.devSessions.path);
    const a = cardIn(page, SESSION_A);
    await expectCard(a, SESSION_A);

    // Claude Code writes a response, then one whose call starts a subagent,
    // and the subagent's files.
    appendTranscript(SESSION_A_FILE, NEW_RESPONSE, LIVE_CALL);
    writeSubagent(LIVE, LIVE_META, LIVE_RESPONSE);

    const facts = own(a);
    await expect(facts.locator('[data-session-fact="Own output"]')).toHaveText(
      LIVE_SESSION_OUT,
      { timeout: R4_MS },
    );
    const live = childOf(a, LIVE);
    await expect(live).toHaveCount(1, { timeout: R4_MS });
    await expect(own(live).getByRole("heading")).toHaveText(
      LIVE_META.description,
    );
    await expect(
      own(live).locator('[data-session-fact="Own output"]'),
    ).toHaveText("600 output tokens");
    await expect(own(live).locator('[data-session-fact="State"]')).toHaveText(
      SESSION_STATE.running,
    );

    writeSubagent(LIVE, { ...LIVE_META, finished: true });

    await expect(own(live).locator('[data-session-fact="State"]')).toHaveText(
      SESSION_STATE.done,
      { timeout: R4_MS },
    );
  });

  test("reads a session left unfinished Stopped once it has been idle, and Running again when it grows", async ({
    page,
  }) => {
    await page.goto(ROUTE.devSessions.path);
    const a = cardIn(page, SESSION_A);
    const nested = childOf(childOf(a, REVIEW), NESTED);
    await expectCard(a, SESSION_A);
    await expectCard(nested, NESTED);

    // The idle time passing, without the spec waiting it out: every file of
    // session a last written longer ago than `SESSION_IDLE_MS`.
    backdateSessionA();

    const stateOf = (card: Locator) =>
      own(card).locator('[data-session-fact="State"]');
    await expect(stateOf(a)).toHaveText(SESSION_STATE.stopped, {
      timeout: R4_MS,
    });
    await expect(stateOf(nested)).toHaveText(SESSION_STATE.stopped);
    // Done is its own final word, however long ago.
    await expect(stateOf(childOf(a, REVIEW))).toHaveText(SESSION_STATE.done);

    appendTranscript(SESSION_A_FILE, NEW_RESPONSE);

    await expect(stateOf(a)).toHaveText(SESSION_STATE.running, {
      timeout: R4_MS,
    });
    await expect(stateOf(nested)).toHaveText(SESSION_STATE.stopped);
  });

  test("reads the nested subagent Waiting for you while a record names it, and counts it in the header", async ({
    page,
  }) => {
    await page.goto(ROUTE.devSessions.path);
    const a = cardIn(page, SESSION_A);
    const nested = childOf(childOf(a, REVIEW), NESTED);
    await expectCard(nested, NESTED);
    const count = page.locator("[data-sessions-waiting]");
    await expect(count).toHaveText("");

    // What `.claude/hooks/record-waiting.mjs` writes when a subagent's
    // permission prompt or question holds it.
    mkdirSync(WAITING_WORKING_DIR, { recursive: true });
    const record = `${WAITING_WORKING_DIR}/${SESSION_A}.${NESTED}.json`;
    writeFileSync(
      record,
      JSON.stringify({ sessionId: SESSION_A, agentId: NESTED }),
    );

    const stateOf = (card: Locator) =>
      own(card).locator('[data-session-fact="State"]');
    await expect(stateOf(nested)).toHaveText(SESSION_STATE.waiting, {
      timeout: R4_MS,
    });
    await expect(count).toHaveText(waitingCount(1));
    // The wait is the subagent's, not the cards above it.
    await expect(stateOf(a)).toHaveText(SESSION_STATE.running);
    await expect(stateOf(childOf(a, REVIEW))).toHaveText(SESSION_STATE.done);

    // Answered: the hook removes the record.
    rmSync(record);

    await expect(stateOf(nested)).toHaveText(SESSION_STATE.running, {
      timeout: R4_MS,
    });
    await expect(count).toHaveText("");
  });

  test("picks the stream up again after the page is left and reopened", async ({
    page,
  }) => {
    await page.goto(ROUTE.devSessions.path);
    await expect(cardIn(page, SESSION_A)).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Dev tools" });

    // Left: the page unmounts and its stream closes.
    await nav.getByRole("link", { name: "Project map", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${ROUTE.devMap.path}$`));
    rmSync(`${TRANSCRIPT_WORKING_DIR}/session-b.jsonl`);

    await nav.getByRole("link", { name: SESSIONS_TITLE, exact: true }).click();

    // Reopened on a fresh reading, never the one from before it was left...
    await expect(cardIn(page, SESSION_A)).toBeVisible();
    await expect(cardIn(page, SESSION_B)).toHaveCount(0);
    // ...and following again.
    appendTranscript(SESSION_A_FILE, NEW_RESPONSE);
    await expect(
      own(cardIn(page, SESSION_A)).locator('[data-session-fact="Own output"]'),
    ).toHaveText("33,000 output tokens", { timeout: R4_MS });
  });

  test("says where it looked when there are no transcripts at all", async ({
    page,
  }) => {
    rmSync(TRANSCRIPT_WORKING_DIR, { recursive: true, force: true });

    await page.goto(ROUTE.devSessions.path);

    const main = page.getByRole("main");
    await expect(
      main.getByText(new RegExp(`^${NO_SESSIONS_LEAD}`)),
    ).toContainText(TRANSCRIPT_WORKING_DIR);
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
