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
  CHAIN_ORDER_UNKNOWN,
  CHAIN_WORKERS_LABEL,
  NO_MODEL,
  NO_SESSIONS_LEAD,
  NO_TASK,
  NO_TOOLS,
  SESSIONS_TITLE,
  SESSION_KIND_LABEL,
  issueGroupTitle,
  sessionCount,
  stepLabel,
  chainIssuesLabel,
  toggleSubagentsLabel,
  waitingCount,
  workerOn,
} from "../../apps/web/src/dev/sessions-copy";
import {
  USAGE_COLUMNS,
  USAGE_TABLE_LABEL,
} from "../../apps/web/src/dev/usage-copy";
import {
  CHAIN_ISSUE_STATE,
  IMPLEMENT_STEP,
  SESSION_IDLE_MS,
  SESSION_STATE,
} from "../../apps/web/src/dev/sessions-protocol";
import { signIn } from "./helpers/auth";
import {
  resetTranscriptWorkingCopy,
  TRANSCRIPT_WORKING_DIR,
  WAITING_WORKING_DIR,
} from "./fixtures/transcript-fixture";
import {
  removeGhChainIssuesFixture,
  writeGhChainIssuesFixture,
} from "./fixtures/gh-issues";

/**
 * Slice 1 of `docs/plans/dev-tools-sessions-page.md` (#590), end to end: page
 * → dev middleware → `apps/web/dev/sessions.ts` → the transcript fixture's
 * working copy, which `playwright.config.ts` names as `CLAUDE_TRANSCRIPT_DIR`.
 * Later slices extend it: the live stream (#591), Waiting for you (#592), and
 * the groups by issue with each card's share of them (#593), whose `#101`
 * total is read off this page and the Usage page in one run and compared,
 * and a running chain's issues in its order (#594).
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

/**
 * The fixture's cards, from its README. `tools` is each tool a card's
 * transcript called, in the order it first called each, as the card reads it
 * (#595). None of them runs `implement`, so none shows a step.
 */
const EXPECTED = {
  [SESSION_B]: {
    task: NO_TASK,
    type: SESSION_KIND_LABEL,
    model: NO_MODEL,
    state: SESSION_STATE.done,
    elapsed: "5m 0s",
    tools: [],
  },
  [SESSION_A]: {
    task: "Implement issue #101.",
    type: SESSION_KIND_LABEL,
    model: "claude-opus-5-5",
    state: SESSION_STATE.running,
    elapsed: "15m 0s",
    tools: ["Agent"],
  },
  [REVIEW]: {
    task: "Review the fixture",
    type: "general-purpose",
    model: "claude-opus-5-5",
    state: SESSION_STATE.done,
    elapsed: "1m 55s",
    tools: ["Read", "Agent"],
  },
  [NESTED]: {
    task: "Find the fixture's specs",
    type: "Explore",
    model: "claude-haiku-5-5",
    state: SESSION_STATE.running,
    elapsed: "55s",
    tools: ["Grep"],
  },
} as const;

/** The groups, in the order the page lists them, from the README. */
const GROUP = {
  issue102: "issue:102",
  issue105: "issue:105",
  issue101: "issue:101",
  base: "base",
  other: "other",
} as const;

/**
 * Each group's total and each card's share of it, from the README: the own
 * output tokens, and with its subagents where it has any in the group.
 */
const SHARES = {
  [GROUP.issue102]: {
    total: "3,000 output tokens",
    cards: { [SESSION_B]: { own: "3,000 output tokens" } },
  },
  [GROUP.issue105]: {
    total: "90,000 output tokens",
    cards: { [SESSION_B]: { own: "90,000 output tokens" } },
  },
  [GROUP.issue101]: {
    total: "32,000 output tokens",
    cards: {
      [SESSION_A]: {
        own: "20,000 output tokens",
        with: "32,000 output tokens with its subagents",
      },
      [REVIEW]: {
        own: "8,000 output tokens",
        with: "12,000 output tokens with its subagents",
      },
      [NESTED]: { own: "4,000 output tokens" },
    },
  },
  [GROUP.base]: {
    total: "6,000 output tokens",
    cards: {
      [SESSION_B]: { own: "1,000 output tokens" },
      [SESSION_A]: { own: "5,000 output tokens" },
    },
  },
  [GROUP.other]: {
    total: "7,000 output tokens",
    cards: { [SESSION_A]: { own: "7,000 output tokens" } },
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
 * session's share of `#101` from the README's 20,000 to 21,000, and `#101`
 * from 32,000 to 33,000. No timestamp, so its elapsed time stands. (The
 * fixture's cut-off line ends in a newline in the repository, so finishing it
 * is not on offer: what followed would be a second bad line.)
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
  sessionId: "a",
  gitBranch: "feat/101-a",
  timestamp: "2026-09-02T09:15:00.000Z",
  message: { model: "claude-haiku-5-5", usage: { output_tokens: 600 } },
})}\n`;
/** Session a's 20,000 of `#101` + the new response's 1,000 + the call's 500. */
const LIVE_SESSION_OUT = "21,500 output tokens";
/** `#101`'s 32,000 + 1,000 + 500 + the new subagent's 600. */
const LIVE_ISSUE_OUT = "34,100 output tokens";

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

/**
 * A `/chain` conductor (#594), written into the working copy by the chain
 * tests alone, so every other test's cards and figures stand. Its prompt is
 * what Claude Code records for `/chain <plan>`, and its two `Agent` calls are
 * `chain` step 2's: Ember on `#201`, finished, and Flint on `#202`, still
 * running, which keeps the conductor Running. Ember has no transcript.
 * Flint's holds the calls `implement` makes up to opening its PR (#595), and
 * no `usage`, so no figure on the page moves.
 */
const CONDUCTOR = "session-c";
const EMBER = "a5555555555555555";
const FLINT = "a6666666666666666";
/** Flint's branch, which puts it and its conductor in `#202`'s group. */
const FLINT_GROUP = "issue:202";

/** Flint's calls, one response each, in `implement`'s order. */
const FLINT_CALLS: [string, object][] = [
  ["Skill", { skill: "implement", args: "#202" }],
  ["PowerShell", { command: "gh issue view 202 --json number,title,body" }],
  [
    "PowerShell",
    {
      command:
        "git fetch origin; git switch -c feat/202-fixture origin/develop",
    },
  ],
  ["Skill", { skill: "coding-standards" }],
  ["Skill", { skill: "mattpocock-skills:tdd" }],
  ["Edit", { file_path: "apps/web/src/fixture.ts" }],
  [
    "PowerShell",
    {
      command:
        'gh issue comment 202 --body "Progress: built, next is review (step 7)"',
    },
  ],
  ["Skill", { skill: "mattpocock-skills:code-review" }],
  ["PowerShell", { command: "gh pr create --body-file .scratch/pr-202.md" }],
];
/** What Flint's card lists for them. */
const FLINT_TOOLS = ["Skill ×4", "PowerShell ×4", "Edit"];

const flintTranscript = () =>
  [
    ...FLINT_CALLS.map(([name, input], i) =>
      JSON.stringify({
        type: "assistant",
        isSidechain: true,
        agentId: FLINT,
        sessionId: CONDUCTOR,
        gitBranch: "feat/202-fixture",
        timestamp: `2026-09-03T10:02:${String(i * 5).padStart(2, "0")}.000Z`,
        message: {
          model: "claude-opus-5-5",
          content: [
            { type: "tool_use", id: `toolu_fixture_flint_${i}`, name, input },
          ],
        },
      }),
    ),
    "",
  ].join("\n");
const CHAIN_PLAN = "docs/plans/fixture-chain.md";
const workerCall = (call: string, name: string, issue: number) =>
  JSON.stringify({
    type: "assistant",
    sessionId: CONDUCTOR,
    gitBranch: "develop",
    timestamp: "2026-09-03T10:01:00.000Z",
    message: {
      model: "claude-opus-5-5",
      content: [
        {
          type: "tool_use",
          id: call,
          name: "Agent",
          input: {
            description: `${name} implements issue #${issue}`,
            prompt: `You are ${name}, on the team. Invoke the \`implement\` skill for issue #${issue} and follow it to the end.`,
          },
        },
      ],
    },
  });

function writeConductor() {
  writeFileSync(
    `${TRANSCRIPT_WORKING_DIR}/${CONDUCTOR}.jsonl`,
    [
      JSON.stringify({
        type: "user",
        sessionId: CONDUCTOR,
        gitBranch: "develop",
        timestamp: "2026-09-03T10:00:00.000Z",
        message: {
          role: "user",
          content: `<command-message>chain</command-message>\n<command-name>/chain</command-name>\n<command-args>${CHAIN_PLAN}</command-args>`,
        },
      }),
      workerCall("toolu_fixture_ember", "Ember", 201),
      workerCall("toolu_fixture_flint", "Flint", 202),
      "",
    ].join("\n"),
  );
  const subagents = `${TRANSCRIPT_WORKING_DIR}/${CONDUCTOR}/subagents`;
  mkdirSync(subagents, { recursive: true });
  const meta = (id: string, name: string, issue: number, finished: boolean) =>
    writeFileSync(
      `${subagents}/agent-${id}.meta.json`,
      JSON.stringify({
        agentType: "general-purpose",
        description: `${name} implements issue #${issue}`,
        toolUseId: `toolu_fixture_${name.toLowerCase()}`,
        ...(finished ? { finished: true } : {}),
      }),
    );
  meta(EMBER, "Ember", 201, true);
  meta(FLINT, "Flint", 202, false);
  writeFileSync(`${subagents}/agent-${FLINT}.jsonl`, flintTranscript());
}

/** One group by its key (`issue:101`, `base`, `other`). */
const groupIn = (page: Page, key: string) =>
  page.locator(`[data-session-group="${key}"]`);

/** A card anywhere under `scope`. A session that worked on several branches
 *  is in each of their groups, so a card is found within one. */
const cardIn = (scope: Page | Locator, id: string) =>
  scope.locator(`[data-session-card="${id}"]`);

/** Session a's card in `#101`'s group, where its subagents are. */
const sessionAIn101 = (page: Page) =>
  cardIn(groupIn(page, GROUP.issue101), SESSION_A);

const totalOf = (group: Locator) => group.locator("[data-session-group-total]");

/** A card directly under `parent`: one level down, never two. */
const childOf = (parent: Locator, id: string) =>
  parent.locator(`:scope > ol > li > [data-session-card="${id}"]`);

/** A card's own facts, not those of the subagents nested under it. */
const own = (card: Locator) => card.locator(":scope > div");

/** A card's facts, and its share of the group `key` it is found in. */
async function expectCard(
  card: Locator,
  id: keyof typeof EXPECTED,
  key: keyof typeof SHARES,
) {
  const want = EXPECTED[id];
  const shares: Record<string, { own: string; with?: string }> =
    SHARES[key].cards;
  const share = shares[id];
  if (!share) throw new Error(`${id} has no share of ${key} in the README`);
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
    share.own,
  );
  const withSubagents = facts.locator('[data-session-fact="With subagents"]');
  if (share.with) {
    await expect(withSubagents).toHaveText(share.with);
  } else {
    await expect(withSubagents).toHaveCount(0);
  }
  await expect(facts.locator('[data-session-fact="Step"]')).toHaveCount(0);
  await expectTools(facts, want.tools);
}

/**
 * A card's tools, each its name as the card shows it, then `×n` when it was
 * called more than once: `["Skill ×4", "Edit"]`. None reads "No tools called".
 */
async function expectTools(facts: Locator, tools: readonly string[]) {
  const shown = facts.locator('[data-session-fact="Tools"]');
  if (tools.length === 0) {
    await expect(shown).toHaveText(NO_TOOLS);
    return;
  }
  await expect(shown.locator("[data-session-tool]")).toHaveText([...tools]);
}

test.describe("dev tools: Sessions", () => {
  test.beforeEach(() => {
    resetTranscriptWorkingCopy();
  });

  test.afterEach(() => {
    removeGhChainIssuesFixture();
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

    // Issue groups by their most recent session, then develop and main, then
    // the rest; each with its total.
    const groups = main.locator("[data-session-group]");
    await expect(groups).toHaveCount(Object.keys(GROUP).length);
    for (const [i, key] of Object.values(GROUP).entries()) {
      await expect(groups.nth(i)).toHaveAttribute("data-session-group", key);
      await expect(totalOf(groups.nth(i))).toHaveText(SHARES[key].total);
    }
    await expect(
      groupIn(page, GROUP.issue101).getByRole("link", {
        name: issueGroupTitle(101),
      }),
    ).toHaveAttribute("href", /\/AlexHun\/ticket-manager-system\/issues\/101$/);

    // Each group's sessions most recently started first. A session's own card
    // is the first in its list item, in document order; the rest are nested
    // under it.
    const sessionsOf = (key: string) =>
      groupIn(page, key).locator(":scope > ol > li");
    const outermost = (key: string, i: number) =>
      sessionsOf(key).nth(i).locator("[data-session-card]").first();
    await expect(sessionsOf(GROUP.base)).toHaveCount(2);
    await expect(outermost(GROUP.base, 0)).toHaveAttribute(
      "data-session-card",
      SESSION_B,
    );
    await expect(outermost(GROUP.base, 1)).toHaveAttribute(
      "data-session-card",
      SESSION_A,
    );

    const a = sessionAIn101(page);
    const review = childOf(a, REVIEW);
    const nested = childOf(review, NESTED);
    await expect(review).toHaveCount(1);
    await expect(nested).toHaveCount(1);
    // Under the subagent that started it, and not beside it.
    await expect(childOf(a, NESTED)).toHaveCount(0);
    // A's subagents ran on #101's branch alone, so no other group draws them.
    for (const key of [GROUP.base, GROUP.other]) {
      await expect(
        cardIn(groupIn(page, key), SESSION_A).locator("[data-session-card]"),
      ).toHaveCount(0);
    }

    for (const [key, { cards }] of Object.entries(SHARES)) {
      for (const id of Object.keys(cards)) {
        const card =
          id === REVIEW
            ? review
            : id === NESTED
              ? nested
              : cardIn(groupIn(page, key), id);
        await expectCard(
          card,
          id as keyof typeof EXPECTED,
          key as keyof typeof SHARES,
        );
      }
    }

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
    const a = sessionAIn101(page);
    await expectCard(a, SESSION_A, GROUP.issue101);

    // Claude Code writes a response, then one whose call starts a subagent,
    // and the subagent's files.
    appendTranscript(SESSION_A_FILE, NEW_RESPONSE, LIVE_CALL);
    writeSubagent(LIVE, LIVE_META, LIVE_RESPONSE);

    const facts = own(a);
    await expect(facts.locator('[data-session-fact="Own output"]')).toHaveText(
      LIVE_SESSION_OUT,
      { timeout: R4_MS },
    );
    await expect(totalOf(groupIn(page, GROUP.issue101))).toHaveText(
      LIVE_ISSUE_OUT,
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
    const a = sessionAIn101(page);
    const nested = childOf(childOf(a, REVIEW), NESTED);
    await expectCard(a, SESSION_A, GROUP.issue101);
    await expectCard(nested, NESTED, GROUP.issue101);

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
    const a = sessionAIn101(page);
    const nested = childOf(childOf(a, REVIEW), NESTED);
    await expectCard(nested, NESTED, GROUP.issue101);
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
    await expect(sessionAIn101(page)).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Dev tools" });

    // Left: the page unmounts and its stream closes.
    await nav.getByRole("link", { name: "Project map", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${ROUTE.devMap.path}$`));
    rmSync(`${TRANSCRIPT_WORKING_DIR}/session-b.jsonl`);

    await nav.getByRole("link", { name: SESSIONS_TITLE, exact: true }).click();

    // Reopened on a fresh reading, never the one from before it was left...
    await expect(sessionAIn101(page)).toBeVisible();
    await expect(cardIn(page, SESSION_B)).toHaveCount(0);
    // ...and following again.
    appendTranscript(SESSION_A_FILE, NEW_RESPONSE);
    await expect(
      own(sessionAIn101(page)).locator('[data-session-fact="Own output"]'),
    ).toHaveText("21,000 output tokens", { timeout: R4_MS });
  });

  test("folds a card's subagents away and keeps its figures", async ({
    page,
  }) => {
    await page.goto(ROUTE.devSessions.path);
    const a = sessionAIn101(page);
    await expectCard(a, SESSION_A, GROUP.issue101);
    const task = EXPECTED[SESSION_A].task;

    await own(a)
      .getByRole("button", { name: toggleSubagentsLabel(true, task) })
      .click();

    await expect(childOf(a, REVIEW)).toHaveCount(0);
    await expect(a.locator("[data-session-card]")).toHaveCount(0);
    await expectCard(a, SESSION_A, GROUP.issue101);
    await expect(totalOf(groupIn(page, GROUP.issue101))).toHaveText(
      SHARES[GROUP.issue101].total,
    );

    await own(a)
      .getByRole("button", { name: toggleSubagentsLabel(false, task) })
      .click();

    await expect(childOf(childOf(a, REVIEW), NESTED)).toHaveCount(1);
  });

  /**
   * R7: an issue's total here is the Usage page's. Read off both pages in one
   * run rather than restated, so the claim is that they agree, whatever the
   * fixture says.
   */
  test("totals the fixture issue as the Usage page does", async ({ page }) => {
    await page.goto(ROUTE.devUsage.path);
    await page.getByRole("button", { name: "Scan" }).click();
    const row = page
      .getByRole("region", { name: USAGE_TABLE_LABEL })
      .getByRole("row")
      .filter({
        has: page.getByRole("rowheader", { name: "#101", exact: true }),
      });
    const usageOut = row.getByRole("cell").nth(USAGE_COLUMNS.indexOf("out"));
    await expect(usageOut).toHaveText(/\d/);
    const onUsage = (await usageOut.textContent()) ?? "";

    await page.goto(ROUTE.devSessions.path);
    const total = totalOf(groupIn(page, GROUP.issue101));
    await expect(total).toHaveText(/\d/);
    const onSessions = (await total.textContent()) ?? "";

    const digits = (text: string) => text.replace(/\D/g, "");
    expect(digits(onSessions)).not.toBe("");
    expect(digits(onSessions)).toBe(digits(onUsage));
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

  /** R8 (#594): a running chain's issues in the order it works them. */
  test("lists a running chain's issues in order: merged, in progress with its worker, next, and blocked", async ({
    page,
  }) => {
    writeConductor();
    writeGhChainIssuesFixture();

    await page.goto(ROUTE.devSessions.path);

    const chain = page.locator(`[data-chain="${CONDUCTOR}"]`);
    await expect(chain).toContainText(CHAIN_PLAN);
    const issues = chain
      .getByRole("list", { name: chainIssuesLabel(CHAIN_PLAN) })
      .locator("[data-chain-issue]");
    const expected = [
      [201, CHAIN_ISSUE_STATE.merged, null],
      [202, CHAIN_ISSUE_STATE.inProgress, "Flint"],
      [203, CHAIN_ISSUE_STATE.next, null],
      [204, CHAIN_ISSUE_STATE.blocked, null],
    ] as const;
    await expect(issues).toHaveCount(expected.length);
    for (const [i, [issue, state, worker]] of expected.entries()) {
      const row = issues.nth(i);
      await expect(row).toHaveAttribute("data-chain-issue", String(issue));
      await expect(row.locator("[data-chain-state]")).toHaveText(state);
      const named = row.locator("[data-chain-worker]");
      if (worker) await expect(named).toHaveText(worker);
      else await expect(named).toHaveCount(0);
    }
    // The blocker outside the chain is named.
    await expect(issues.nth(3)).toContainText("#299");
    await expect(chain.locator("[data-chain-unknown]")).toHaveCount(0);
  });

  test("says a chain's order is unknown without a listing, and still lists its workers", async ({
    page,
  }) => {
    writeConductor();
    removeGhChainIssuesFixture();

    await page.goto(ROUTE.devSessions.path);

    const chain = page.locator(`[data-chain="${CONDUCTOR}"]`);
    await expect(chain.locator("[data-chain-unknown]")).toContainText(
      CHAIN_ORDER_UNKNOWN,
    );
    await expect(chain.locator("[data-chain-issue]")).toHaveCount(0);
    const workers = chain
      .getByRole("list", { name: CHAIN_WORKERS_LABEL })
      .getByRole("listitem");
    await expect(workers).toHaveCount(2);
    await expect(workers.nth(0)).toContainText(workerOn("Ember", 201));
    await expect(workers.nth(0)).toContainText(SESSION_STATE.done);
    await expect(workers.nth(1)).toContainText(workerOn("Flint", 202));
    await expect(workers.nth(1)).toContainText(SESSION_STATE.running);
  });

  /** R9 and R10 (#595): the `implement` step a worker has reached, and the
   *  tools every card has called. */
  test("reads the worker that opened its PR at Ship, and lists the tools it called", async ({
    page,
  }) => {
    writeConductor();

    await page.goto(ROUTE.devSessions.path);

    const group = groupIn(page, FLINT_GROUP);
    const flint = own(childOf(cardIn(group, CONDUCTOR), FLINT));
    await expect(flint.locator('[data-session-fact="Step"]')).toHaveText(
      stepLabel(IMPLEMENT_STEP.ship),
    );
    await expectTools(flint, FLINT_TOOLS);

    // The conductor started two workers and runs no `implement` itself, and
    // Ember, with no transcript, has called nothing: neither shows a step.
    const conductor = own(cardIn(groupIn(page, GROUP.base), CONDUCTOR));
    await expect(conductor.locator('[data-session-fact="Step"]')).toHaveCount(
      0,
    );
    await expectTools(conductor, ["Agent ×2"]);
    const ember = own(
      childOf(cardIn(groupIn(page, GROUP.base), CONDUCTOR), EMBER),
    );
    await expect(ember.locator('[data-session-fact="Step"]')).toHaveCount(0);
    await expectTools(ember, []);
  });

  /**
   * R12: Claude Code's workers are sessions and subagents, and their progress
   * a state or a step, because `GLOSSARY.md` gives the other words to the
   * desk. File and directory names, and the tools a card lists (`Agent`
   * among them, #595), are left out of the check: every one is in `<code>`
   * and is Claude Code's (`agent-<id>.meta.json`), not the page's words.
   */
  test("never uses the desk's words for Claude Code's workers", async ({
    page,
  }) => {
    // A running chain too, so its words are held to the rule (#594).
    writeConductor();
    writeGhChainIssuesFixture();
    await page.goto(ROUTE.devSessions.path);
    await expect(sessionAIn101(page)).toBeVisible();
    await expect(page.locator("[data-chain-issue]")).toHaveCount(4);

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
