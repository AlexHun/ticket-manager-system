import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import {
  DASHBOARD_SCOPE,
  MESSAGE_DIRECTION,
  TICKET_CATEGORY,
  TICKET_STATUS,
  TUTORIAL_PAGE_KEY,
  USER_ROLE,
  type TicketAssigneesResponse,
  type TicketStatsResponse,
} from "@ticket/shared";
import { ticketDetailPath } from "../../apps/web/src/lib/routes";
import { CREDENTIALS } from "./helpers/auth";
import { resetDemoUsers, resetE2eEmails, testDb } from "./helpers/db";
import { API_URL } from "./helpers/env";

/**
 * "Use demo session" (#319, ADR-0022): one click on `/login`, a fresh identity
 * called "Demo visitor", no password.
 *
 * Runs against the ordinary :3002 server, which `.env.test` puts in demo mode.
 * The refusal is asserted against the AI server on :3003 instead, the suite's
 * one API with demo mode off (`.env.test.ai`). No web server fronts that one,
 * which is why the *button's* absence is `LoginPage.test.tsx`'s job rather
 * than this file's.
 */

/** The second, demo-off API — see `playwright.config.ts`. */
const DEMO_OFF_API_URL = "http://localhost:3003";

const DEMO_VISITOR = "Demo visitor";
const DEMO_BUTTON = { name: "Use demo session" };

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

/** Click the button and wait to land on the dashboard. */
async function startDemo(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByRole("button", DEMO_BUTTON).click();
  await page.waitForURL("/");
}

/** The walkthrough's dialog, named by its title. */
function walkthrough(page: Page) {
  return page.getByRole("dialog", { name: WALKTHROUGH_TITLE });
}

/** Status of a request made with the demo's own cookie. */
async function statusOf(
  request: APIRequestContext,
  method: "get" | "post" | "patch",
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
    // Agent screens: the demo is an `agent`, never `admin` (ADR-0022).
    await expect(page.getByRole("link", { name: "Users" })).toHaveCount(0);

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

  // R2, against a server with demo mode off. The plugin would otherwise mint
  // a user on every call whatever `disableSignUp` says, so the refusal has to
  // be the endpoint's own, not the button's absence.
  test("a demo-off server refuses to start one, and mints nobody", async ({
    request,
  }) => {
    const res = await request.post(
      `${DEMO_OFF_API_URL}/api/auth/sign-in/anonymous`,
    );

    expect(res.status()).toBe(403);
    expect(await testDb.user.count({ where: { isAnonymous: true } })).toBe(0);
  });
});
