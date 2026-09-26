import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import {
  DASHBOARD_SCOPE,
  DEMO_READ_ONLY_NOTE,
  EVAL_CORPUS,
  EVAL_RUN_STATUS,
  EVAL_THRESHOLD,
  MESSAGE_DIRECTION,
  PIPELINE_OUTCOME,
  TICKET_CATEGORY,
  TICKET_STATUS,
  TUTORIAL_PAGE_KEY,
  USER_ROLE,
  type TicketAssigneesResponse,
  type TicketStatsResponse,
} from "@ticket/shared";
import { DEMO_VISITOR_NAME } from "../../apps/api/src/demo/mode";
import { ROUTE, ticketDetailPath } from "../../apps/web/src/lib/routes";
import { CREDENTIALS } from "./helpers/auth";
import { resetDemoUsers, resetE2eEmails, testDb } from "./helpers/db";
import {
  DEMO_BUTTON,
  backdateDemoSession,
  lapseSessionCache,
  startDemo,
} from "./helpers/demo";
import { API_URL } from "./helpers/env";

/**
 * "Use demo session" (#319, ADR-0022): one click on `/login`, a fresh identity
 * called "Demo visitor", no password.
 *
 * Runs against the ordinary :3002 server, which `.env.test` puts in demo mode.
 * No E2E server runs with demo mode off since #321 put the AI server in demo
 * mode for `demo-ai-budget.spec.ts`, so both halves of R2's "off" are unit
 * tests: the button's absence is `LoginPage.test.tsx`'s, and the refusal of
 * `/sign-in/anonymous` is `routes/users.test.ts`'s, through the real
 * `auth.handler`. So is the switch ending a session already open (#324).
 */

/** Imported rather than retyped: `demo/mode.ts` is import-free, like `routes.ts`. */
const DEMO_VISITOR = DEMO_VISITOR_NAME;

/**
 * A dashboard walkthrough, so R12 has something to show. The test database has
 * no tutorial copy at all (the seed writes none), which is what keeps every
 * other spec free of pop-ups, so this spec writes one and puts back whatever
 * was there when it finishes.
 */
const WALKTHROUGH_TITLE = "Demo visitor walkthrough (E2E)";

/** Every address this spec mails is swept by `resetE2eEmails`. */
const CUSTOMER_EMAIL = "e2e-demo-customer@example.com";

let ticketId: number;
let savedWalkthrough: Awaited<
  ReturnType<typeof testDb.tutorialContent.findUnique>
>;

test.beforeAll(async () => {
  savedWalkthrough = await testDb.tutorialContent.findUnique({
    where: { pageKey: TUTORIAL_PAGE_KEY.dashboard },
  });
  await testDb.tutorialContent.upsert({
    where: { pageKey: TUTORIAL_PAGE_KEY.dashboard },
    create: {
      pageKey: TUTORIAL_PAGE_KEY.dashboard,
      title: WALKTHROUGH_TITLE,
      steps: [{ title: "The dashboard", body: "Everything at a glance." }],
    },
    update: {
      title: WALKTHROUGH_TITLE,
      steps: [{ title: "The dashboard", body: "Everything at a glance." }],
    },
  });
});

test.beforeEach(async () => {
  await resetDemoUsers();
  const ticket = await testDb.ticket.create({
    data: {
      subject: "Demo visitor works this one",
      customerEmail: CUSTOMER_EMAIL,
      customerName: "Dana Demo",
      status: TICKET_STATUS.Open,
      messages: {
        create: {
          messageId: `<e2e-demo-${Date.now()}@example.com>`,
          direction: MESSAGE_DIRECTION.inbound,
          senderEmail: CUSTOMER_EMAIL,
          senderName: "Dana Demo",
          textBody: "My order never arrived.",
        },
      },
    },
    select: { id: true },
  });
  ticketId = ticket.id;
});

test.afterEach(async () => {
  await testDb.ticket.deleteMany({ where: { id: ticketId } });
  await resetE2eEmails();
});

test.afterAll(async () => {
  await resetDemoUsers();
  if (savedWalkthrough) {
    const { pageKey, title, steps, updatedById, updatedByName } =
      savedWalkthrough;
    await testDb.tutorialContent.update({
      where: { pageKey },
      data: { title, steps: steps ?? [], updatedById, updatedByName },
    });
  } else {
    await testDb.tutorialContent.deleteMany({
      where: { pageKey: TUTORIAL_PAGE_KEY.dashboard },
    });
  }
});

/** The walkthrough's dialog, named by its title. */
function walkthrough(page: Page) {
  return page.getByRole("dialog", { name: WALKTHROUGH_TITLE });
}

/** Status of a request made with the demo's own cookie. */
async function statusOf(
  request: APIRequestContext,
  method: "get" | "post" | "patch" | "put" | "delete",
  path: string,
  data?: unknown,
): Promise<number> {
  const res = await request[method](`${API_URL}${path}`, { data });
  return res.status();
}

test.describe("Demo session", () => {
  test("the button lands on the dashboard, signed in as the demo visitor", async ({
    page,
  }) => {
    await startDemo(page);

    // Scoped to the top bar for the reason auth.spec.ts gives: `/` is the
    // dashboard, and names appear on it as workload rows too.
    await expect(page.locator("header").getByText(DEMO_VISITOR)).toBeVisible();
    // The demo is an `agent`, never `admin` (ADR-0022); the admin screens it
    // does see come from `isAnonymous`, asserted below.
    const visitor = await testDb.user.findFirstOrThrow({
      where: { isAnonymous: true },
      select: { role: true, name: true },
    });
    expect(visitor).toEqual({ role: USER_ROLE.agent, name: DEMO_VISITOR });
  });

  test("a status change sticks, and the trail names the demo visitor", async ({
    page,
  }) => {
    await startDemo(page);
    await page.goto(ticketDetailPath(ticketId));

    const status = page.getByRole("combobox", { name: "Status" });
    await status.click();
    const saved = page.waitForResponse(
      (res) =>
        res.url().endsWith(`/api/tickets/${ticketId}/status`) &&
        res.request().method() === "PATCH",
    );
    await page
      .getByRole("option", { name: TICKET_STATUS.Resolved, exact: true })
      .click();
    expect((await saved).status()).toBe(200);

    await page.reload();
    await expect(page.getByRole("combobox", { name: "Status" })).toContainText(
      TICKET_STATUS.Resolved,
    );

    // R11: the change is filed under the visitor, visibly labelled as one.
    const thread = page.locator("section", {
      has: page.getByRole("heading", { name: /^Messages/ }),
    });
    await expect(thread.getByText(DEMO_VISITOR).first()).toBeVisible();
    const entry = await testDb.ticketActivity.findFirstOrThrow({
      where: { ticketId, action: "status_changed" },
      select: { actor: { select: { name: true, isAnonymous: true } } },
    });
    expect(entry.actor).toEqual({ name: DEMO_VISITOR, isAnonymous: true });
  });

  // R4 through the API with the demo's cookie. Polish and summarise answer
  // 503 here because this server has no AI key — the same answer an admin
  // gets, and proof the demo got past `requireAuth` to be told so.
  test("can reply, recategorise and reassign, and reach polish and summarise", async ({
    page,
  }) => {
    await startDemo(page);
    const agent = await testDb.user.findUniqueOrThrow({
      where: { email: CREDENTIALS.agent.email },
      select: { id: true },
    });

    expect(
      await statusOf(
        page.request,
        "post",
        `/api/tickets/${ticketId}/messages`,
        {
          textBody: "Sorry about that — it is on its way.",
        },
      ),
    ).toBe(201);
    expect(
      await statusOf(
        page.request,
        "patch",
        `/api/tickets/${ticketId}/category`,
        {
          category: TICKET_CATEGORY.Technical,
        },
      ),
    ).toBe(200);
    expect(
      await statusOf(
        page.request,
        "patch",
        `/api/tickets/${ticketId}/assignee`,
        {
          assignedToId: agent.id,
        },
      ),
    ).toBe(200);
    expect(
      await statusOf(page.request, "post", "/api/ai/polish-reply", {
        ticketId,
        draft: "on its way",
      }),
    ).toBe(503);
    expect(
      await statusOf(page.request, "post", "/api/ai/summarize-ticket", {
        ticketId,
      }),
    ).toBe(503);

    const reply = await testDb.message.findFirstOrThrow({
      where: { ticketId, direction: MESSAGE_DIRECTION.outbound },
      select: { author: { select: { name: true } } },
    });
    expect(reply.author?.name).toBe(DEMO_VISITOR);
  });

  // R11: nowhere a list of the people is drawn does a visitor appear among
  // them. The workload panel lists every account, zero-ticket ones included,
  // so without its own exclusion each click would add a row.
  test("is never listed among the people: not as an assignee, not on the desk's workload", async ({
    page,
  }) => {
    await startDemo(page);

    const picker = await page.request.get(`${API_URL}/api/tickets/assignees`);
    expect(picker.status()).toBe(200);
    const { assignees } = (await picker.json()) as TicketAssigneesResponse;
    expect(assignees.map((a) => a.name)).not.toContain(DEMO_VISITOR);

    const stats = await page.request.get(
      `${API_URL}/api/tickets/stats?scope=${DASHBOARD_SCOPE.all}`,
    );
    expect(stats.status()).toBe(200);
    const { workload } = (await stats.json()) as TicketStatsResponse;
    expect(workload.map((row) => row.name)).not.toContain(DEMO_VISITOR);
  });

  // The admin plugin serves these to its admin role without `requireAdmin`
  // in the way — which is why the demo must never hold that role.
  test("is refused by Better Auth's own admin endpoints", async ({ page }) => {
    await startDemo(page);

    expect(
      await statusOf(page.request, "get", "/api/auth/admin/list-users"),
    ).toBe(403);
  });

  /* ── Admin screens without the admin role (#320) ───────────────────────── */

  // R3. Read on `/tickets` rather than on the dashboard it lands on: the
  // dashboard's walkthrough is a modal, which hides the sidebar from the
  // accessibility tree, and a hidden "Users" link would pass the absence
  // check for the wrong reason.
  test("the navigation shows the showcase screens, and not Users or Outbox", async ({
    page,
  }) => {
    await startDemo(page);
    await page.goto(ROUTE.tickets.path);

    for (const name of [
      "Pipeline",
      "Knowledge base",
      "Evals",
      "Activity",
      "Tutorials",
    ]) {
      await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
    }
    // Tickets first, so the two absences below are read off a sidebar that
    // has demonstrably rendered.
    await expect(
      page.getByRole("link", { name: "Tickets", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Users", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Outbox", exact: true }),
    ).toHaveCount(0);
  });

  // R3: not found, rather than a redirect that would say the page exists.
  test("a typed URL to Users or Outbox shows the not-found page", async ({
    page,
  }) => {
    await startDemo(page);

    for (const path of [ROUTE.users.path, ROUTE.outbox.path]) {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { name: "No such page" }),
      ).toBeVisible();
      await expect(page).toHaveURL(path);
    }
  });

  // The API is the control; the two tests above are UX. Every showcase read
  // opens to the demo's cookie and Users and Outbox do not. The writes on the
  // showcase screens are the next section's.
  test("the API opens the showcase reads and refuses Users and Outbox", async ({
    page,
  }) => {
    await startDemo(page);

    for (const path of [
      "/api/pipeline",
      "/api/automation",
      "/api/knowledge-articles",
      "/api/knowledge-articles/pending-revisions",
      "/api/evals/runs",
      "/api/evals/schedule",
      "/api/activity",
      "/api/tutorials",
    ]) {
      expect(await statusOf(page.request, "get", path), path).toBe(200);
    }

    expect(await statusOf(page.request, "get", "/api/users")).toBe(403);
    expect(await statusOf(page.request, "get", "/api/outbox")).toBe(403);
    expect(
      await statusOf(page.request, "post", "/api/users", {
        name: "Demo invitee",
        email: "e2e-demo-invitee@example.com",
        role: USER_ROLE.admin,
      }),
    ).toBe(403);
    expect(await statusOf(page.request, "post", "/api/outbox/1/retry")).toBe(
      403,
    );
  });

  /* ── Settings are read-only (#326) ─────────────────────────────────────── */

  // R5, R15, and the simulator the plan's Deferred section keeps shut. Every
  // write behind the showcase screens, sent with the demo's own cookie through
  // the real guards: the route tests stub them, so this is where a write
  // mounted on `requireAuth` or `requireAdminView` would show. The ids need
  // not exist — the guard answers before the handler looks.
  test("the API refuses every settings write and the pipeline simulator", async ({
    page,
  }) => {
    await startDemo(page);

    const writes = [
      ["post", "/api/knowledge-articles"],
      ["patch", "/api/knowledge-articles/KB-001"],
      ["post", "/api/knowledge-articles/KB-001/archive"],
      ["post", "/api/knowledge-articles/KB-001/revisions/1/approve"],
      ["post", "/api/knowledge-articles/KB-001/revisions/1/reject"],
      ["patch", "/api/automation/handoff"],
      ["post", "/api/evals/runs"],
      ["patch", "/api/evals/schedule"],
      ["post", "/api/evals/planned-runs"],
      ["delete", "/api/evals/planned-runs/1"],
      ["put", `/api/tutorials/${TUTORIAL_PAGE_KEY.dashboard}`],
      ["post", "/api/pipeline/simulate"],
    ] as const;
    for (const [method, path] of writes) {
      expect(
        await statusOf(page.request, method, path, {}),
        `${method} ${path}`,
      ).toBe(403);
    }
  });

  // R5 on the page: the article opens, and its save control is off with the
  // note saying why. Seeded because the test database has no corpus, as
  // `KB-000`: `nextArticleId` counts on from the highest id, so this one sorts
  // below every id a concurrent spec's create could be handed.
  test("a knowledge article opens read-only, its save control disabled", async ({
    page,
  }) => {
    await testDb.knowledgeArticle.deleteMany({ where: { id: "KB-000" } });
    const article = await testDb.knowledgeArticle.create({
      data: {
        id: "KB-000",
        title: "Can a demo visitor read this article?",
        category: TICKET_CATEGORY.General,
        body: "Yes, and change none of it.",
        autoReply: false,
      },
    });

    try {
      await startDemo(page);
      await page.goto(ROUTE.knowledge.path);

      await expect(page.getByText(DEMO_READ_ONLY_NOTE)).toBeVisible();
      await expect(
        page.getByRole("button", { name: "New article" }),
      ).toBeDisabled();

      const row = page.getByRole("listitem").filter({ hasText: article.title });
      await row.getByRole("button", { name: "Edit" }).click();
      const dialog = page.getByRole("dialog", { name: `Edit ${article.id}` });
      await expect(dialog.getByLabel("Question")).toHaveValue(article.title);
      await expect(
        dialog.getByRole("button", { name: "Save changes" }),
      ).toBeDisabled();
      await expect(dialog.getByText(DEMO_READ_ONLY_NOTE)).toBeVisible();
    } finally {
      await testDb.knowledgeArticle.delete({ where: { id: article.id } });
    }
  });

  // R15: a past run and the cases it answered, on the page itself. Seeded,
  // like `evals.spec.ts`'s cards, and dated just ahead of now for that file's
  // reason: the database is never wiped, and an older row could sink below
  // the page's run limit.
  test("can browse a past eval run and its results", async ({ page }) => {
    const run = await testDb.evalRun.create({
      data: {
        corpus: EVAL_CORPUS.frozen,
        status: EVAL_RUN_STATUS.completed,
        startedAt: new Date(Date.now() + 1000),
        finishedAt: new Date(Date.now() + 1000),
        repeats: 5,
        attempts: 5,
        matches: 5,
        classifiedRepeats: 5,
        classifyMatches: 5,
        thresholds: EVAL_THRESHOLD,
        results: {
          create: {
            caseId: "demo-visible-case",
            caseName: "Case a demo visitor can read",
            adversarial: false,
            expectedOutcome: PIPELINE_OUTCOME.resolved,
            expectedCategory: TICKET_CATEGORY.General,
            repeats: 5,
            matches: 5,
            classifiedRepeats: 5,
            classifyMatches: 5,
            verdicts: Array.from({ length: 5 }, () => ({
              outcome: PIPELINE_OUTCOME.resolved,
              decline: null,
              matched: true,
              caught: false,
              escaped: false,
              category: TICKET_CATEGORY.General,
            })),
          },
        },
      },
    });

    try {
      await startDemo(page);
      await page.goto(ROUTE.evals.path);

      const card = page.locator('[data-slot="card"]', {
        has: page.getByText(`Run ${run.id}`, { exact: true }),
      });
      const runToggle = card.getByRole("button", { name: `Run ${run.id}` });
      await expect(runToggle).toBeVisible();
      if ((await runToggle.getAttribute("aria-expanded")) === "false") {
        await runToggle.click();
      }
      await card
        .getByRole("button", { name: "1 case, 5 repeats each" })
        .click();
      await expect(
        card
          .getByRole("region", { name: `Cases answered by run ${run.id}` })
          .getByText("Case a demo visitor can read"),
      ).toBeVisible();
    } finally {
      await testDb.evalRun.delete({ where: { id: run.id } });
    }
  });

  /* ── Two hours, the off switch, the banner (#324) ─────────────────────── */

  // R13. On `/tickets` for the reason the navigation test gives: the
  // dashboard's walkthrough is a modal, and it hides the rest of the page from
  // the accessibility tree.
  test("a banner says this is a demo, and Exit demo returns to the login page with the button", async ({
    page,
  }) => {
    await startDemo(page);
    await page.goto(ROUTE.tickets.path);

    const banner = page.getByRole("region", { name: "Demo session" });
    await expect(banner).toContainText("resets every night");
    await banner.getByRole("button", { name: "Exit demo" }).click();

    await page.waitForURL(ROUTE.login.path);
    await expect(page.getByRole("button", DEMO_BUTTON)).toBeVisible();
    // Signed out for real: a protected page sends the browser straight back.
    await page.goto(ROUTE.tickets.path);
    await expect(page).toHaveURL(ROUTE.login.path);
  });

  // R7. The unit tests hold the two hours themselves; this is what the
  // visitor meets once they are up, by each of the two ways a session is
  // refused: Better Auth's own expiry (a `null`), and `auth.ts`'s two-hour
  // rule read off the start (a 401, which the page must read as signed out).
  // The cache is let lapse first because a row changed behind its back is
  // served from it for up to its 60 seconds.
  for (const column of ["expiresAt", "createdAt"] as const) {
    test(`once its session has ended (${column} backdated), the next navigation lands on the login page with the button`, async ({
      page,
    }) => {
      await startDemo(page);
      await page.goto(ROUTE.tickets.path);
      await expect(
        page.getByRole("region", { name: "Demo session" }),
      ).toBeVisible();

      await backdateDemoSession(page, column);
      await lapseSessionCache(page);
      await page.goto(ROUTE.tickets.path);

      await expect(page).toHaveURL(ROUTE.login.path);
      await expect(page.getByRole("button", DEMO_BUTTON)).toBeVisible();
    });
  }

  // R12, and it comes free: each click is a new identity, and walkthrough
  // progress is stored per user.
  test("a second visitor is somebody else, and sees the walkthrough the first dismissed", async ({
    page,
    browser,
  }) => {
    await startDemo(page);
    await expect(walkthrough(page)).toBeVisible();
    await walkthrough(page).getByRole("button", { name: "Got it" }).click();
    await expect(walkthrough(page)).toHaveCount(0);

    // Dismissed for good: the first visitor does not see it again.
    await page.reload();
    await expect(page.locator("header").getByText(DEMO_VISITOR)).toBeVisible();
    await expect(walkthrough(page)).toHaveCount(0);

    const second = await browser.newContext();
    try {
      const other = await second.newPage();
      await startDemo(other);
      await expect(walkthrough(other)).toBeVisible();
    } finally {
      await second.close();
    }

    expect(await testDb.user.count({ where: { isAnonymous: true } })).toBe(2);
  });
});
