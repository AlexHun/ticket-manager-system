import { test, expect, type Page } from "@playwright/test";
import { TICKET_STATUS } from "@ticket/shared";
import { signIn } from "./helpers/auth";
import { resetTickets, testDb } from "./helpers/db";

/**
 * Slice 5 of `docs/plans/route-level-data-prefetching.md`: the three routes the
 * epic moved a fetch on each bracket navigation-start to data-populated-render
 * with a named mark pair and the measure between them.
 *
 * What this proves is that the instrumentation is *wired* — that the entries
 * exist, on the real navigation each route is reached by. It deliberately
 * asserts nothing about the durations beyond their being positive: there is no
 * target to check against yet. Producing one is the manual recording pass the
 * issue defers, run against the pre-loader and post-loader states and written
 * back into the PRD's success-metrics table.
 *
 * The names are spelled out here rather than imported from
 * `apps/web/src/lib/route-timing.tsx`, which is a React module and not the
 * plain data kind this suite reaches into (see the note in
 * `dashboard-layout.spec.ts`). Nothing is lost by restating them: a rename on
 * either side leaves the measure missing, and every test below fails.
 */
const ROUTE = {
  dashboard: "dashboard",
  tickets: "tickets",
  ticketDetail: "ticket-detail",
} as const;

type RouteKey = (typeof ROUTE)[keyof typeof ROUTE];

function entryNames(key: RouteKey) {
  return {
    navigate: `${key}:navigate`,
    rendered: `${key}:rendered`,
    measure: `${key}:time-to-data`,
  };
}

async function entries(
  page: Page,
  name: string,
  type: "mark" | "measure",
): Promise<{ startTime: number; duration: number }[]> {
  return page.evaluate(
    ([entryName, entryType]) =>
      performance
        .getEntriesByName(entryName, entryType)
        .map((entry) => ({
          startTime: entry.startTime,
          duration: entry.duration,
        })),
    [name, type] as const,
  );
}

/**
 * Waits for the route's bracket to close, then asserts the whole trio.
 *
 * Polled rather than read once: the rendered mark is written from an effect
 * after React commits, so it lands a tick after whatever DOM assertion got the
 * test here.
 */
async function expectBracketed(page: Page, key: RouteKey): Promise<void> {
  const { navigate, rendered, measure } = entryNames(key);

  await expect
    .poll(async () => (await entries(page, measure, "measure")).length)
    .toBeGreaterThan(0);

  expect(await entries(page, navigate, "mark")).not.toHaveLength(0);
  expect(await entries(page, rendered, "mark")).not.toHaveLength(0);

  // A real fetch separates the two marks, so a zero-length span would mean the
  // pair was written back to back by something that never waited.
  const [span] = await entries(page, measure, "measure");
  expect(span!.duration).toBeGreaterThan(0);
}

async function seedTicket(subject: string): Promise<void> {
  await testDb.ticket.create({
    data: {
      subject,
      customerEmail: "e2e-timing@example.com",
      customerName: "Timing Customer",
      status: TICKET_STATUS.Open,
    },
  });
}

test.describe("route timing instrumentation", () => {
  test.beforeEach(async () => {
    await resetTickets();
    await seedTicket("Timed ticket");
  });

  test("signing in brackets the dashboard's first data render", async ({
    page,
  }) => {
    // The navigation this route is actually reached by, for every user: the
    // redirect out of /login. `RouteTimingLayout` sits above `ProtectedRoute`
    // precisely so it is mounted to see this one start.
    await signIn(page, "agent");

    await expectBracketed(page, ROUTE.dashboard);
  });

  test("opening the ticket list brackets its first data render", async ({
    page,
  }) => {
    await signIn(page, "agent");

    await page.getByRole("link", { name: "Tickets" }).click();
    await expect(page.getByRole("heading", { name: "Tickets" })).toBeVisible();

    await expectBracketed(page, ROUTE.tickets);
  });

  test("opening a ticket brackets its first data render", async ({ page }) => {
    await signIn(page, "agent");
    await page.goto("/tickets");

    await page.getByRole("row").nth(1).getByRole("link").click();
    await page.waitForURL(/\/tickets\/\d+$/);

    await expectBracketed(page, ROUTE.ticketDetail);
  });

  test("a cold load measures from the document's navigation start", async ({
    page,
  }) => {
    await signIn(page, "agent");

    // A document load, not a client navigation: the router's navigation state
    // stays idle through the initial load, so this is the seeded path in
    // `route-timing.tsx` rather than the one the layout's effect writes.
    await page.goto("/tickets");
    await expect(page.getByRole("heading", { name: "Tickets" })).toBeVisible();

    await expectBracketed(page, ROUTE.tickets);

    // `timeOrigin` — the browser's own navigation start, so the entry chunk
    // this visit waited for is inside the span rather than in front of it.
    const [navigate] = await entries(page, "tickets:navigate", "mark");
    expect(navigate!.startTime).toBe(0);
  });
});
