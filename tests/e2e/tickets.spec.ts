import { test, expect, type Page } from "@playwright/test";
import {
  SORT_ORDER,
  TICKET_CATEGORY,
  TICKET_SORT_FIELD,
  TICKET_STATUS,
  type SortOrder,
  type Ticket,
  type TicketSortField,
} from "@ticket/shared";
import { signIn } from "./helpers/auth";
import { resetTickets, testDb } from "./helpers/db";
import { API_URL } from "./helpers/env";

const TICKETS_ENDPOINT = `${API_URL}/api/tickets`;

/**
 * Seed three tickets whose createdAt values are deliberately inserted
 * oldest-last, so a route that forgot to sort would return insertion order
 * and fail the newest-first assertions below.
 */
async function seedTickets(): Promise<void> {
  await testDb.ticket.createMany({
    data: [
      {
        subject: "Middle ticket",
        customerEmail: "middle@example.com",
        customerName: "Middle Customer",
        status: TICKET_STATUS.Resolved,
        category: TICKET_CATEGORY.Technical,
        createdAt: new Date("2025-05-02T12:00:00.000Z"),
        lastMessageAt: new Date("2025-05-02T12:00:00.000Z"),
      },
      {
        subject: "Newest ticket",
        customerEmail: "newest@example.com",
        customerName: "Newest Customer",
        createdAt: new Date("2025-05-03T12:00:00.000Z"),
        lastMessageAt: new Date("2025-05-03T12:00:00.000Z"),
      },
      {
        subject: "Oldest ticket",
        customerEmail: "oldest@example.com",
        customerName: "Oldest Customer",
        status: TICKET_STATUS.Closed,
        createdAt: new Date("2025-05-01T12:00:00.000Z"),
        lastMessageAt: new Date("2025-05-01T12:00:00.000Z"),
      },
    ],
  });
}

/**
 * Statuses seeded so that enum order (Open, Resolved, Closed) produces a
 * sequence that matches neither insertion order nor the default createdAt-desc
 * order — and differs from alphabetical, which would give Alpha, Bravo, Charlie.
 */
async function seedForStatusSort(): Promise<void> {
  await testDb.ticket.createMany({
    data: [
      { subject: "Alpha", status: TICKET_STATUS.Closed, day: "03" },
      { subject: "Bravo", status: TICKET_STATUS.Open, day: "02" },
      { subject: "Charlie", status: TICKET_STATUS.Resolved, day: "01" },
    ].map(({ subject, status, day }) => ({
      subject,
      status,
      customerEmail: `${subject.toLowerCase()}@example.com`,
      customerName: `${subject} Customer`,
      createdAt: new Date(`2025-07-${day}T12:00:00.000Z`),
      lastMessageAt: new Date(`2025-07-${day}T12:00:00.000Z`),
    })),
  });
}

/**
 * The uncategorised ticket is the newest, so the default order would put it
 * first — if it comes back last, `nulls: "last"` is doing its job.
 */
async function seedForCategorySort(): Promise<void> {
  await testDb.ticket.createMany({
    data: [
      { subject: "Cat-General", category: TICKET_CATEGORY.General, day: "04" },
      {
        subject: "Cat-Technical",
        category: TICKET_CATEGORY.Technical,
        day: "03",
      },
      { subject: "Cat-Refund", category: TICKET_CATEGORY.Refund, day: "02" },
      { subject: "Cat-None", category: null, day: "05" },
    ].map(({ subject, category, day }) => ({
      subject,
      category,
      customerEmail: `${subject.toLowerCase()}@example.com`,
      customerName: `${subject} Customer`,
      createdAt: new Date(`2025-07-${day}T12:00:00.000Z`),
      lastMessageAt: new Date(`2025-07-${day}T12:00:00.000Z`),
    })),
  });
}

async function fetchTickets(
  page: Page,
  sort?: { sort: TicketSortField; order: SortOrder },
): Promise<Ticket[]> {
  const res = await page.request.get(TICKETS_ENDPOINT, { params: sort });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { tickets: Ticket[] };
  return body.tickets;
}

async function fetchSubjects(
  page: Page,
  sort: TicketSortField,
  order: SortOrder,
): Promise<string[]> {
  const tickets = await fetchTickets(page, { sort, order });
  return tickets.map((t) => t.subject);
}

// ---------------------------------------------------------------------------
// API — access control
// ---------------------------------------------------------------------------

test.describe("Tickets API — access control", () => {
  test("GET /api/tickets -> 401 when unauthenticated", async ({ request }) => {
    const res = await request.get(TICKETS_ENDPOINT);
    expect(res.status()).toBe(401);
  });

  test("GET /api/tickets -> 200 for an agent (not admin-only)", async ({
    page,
  }) => {
    await signIn(page, "agent");
    const res = await page.request.get(TICKETS_ENDPOINT);
    expect(res.status()).toBe(200);
  });

  test("GET /api/tickets -> 200 for an admin", async ({ page }) => {
    await signIn(page, "admin");
    const res = await page.request.get(TICKETS_ENDPOINT);
    expect(res.status()).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// API — payload + ordering
// ---------------------------------------------------------------------------

test.describe("Tickets API — list", () => {
  test.beforeEach(async () => {
    await resetTickets();
  });

  test("returns an empty array when there are no tickets", async ({ page }) => {
    await signIn(page, "agent");
    expect(await fetchTickets(page)).toEqual([]);
  });

  test("sorts tickets newest first", async ({ page }) => {
    await seedTickets();
    await signIn(page, "agent");

    const tickets = await fetchTickets(page);
    expect(tickets.map((t) => t.subject)).toEqual([
      "Newest ticket",
      "Middle ticket",
      "Oldest ticket",
    ]);
  });

  test("breaks createdAt ties by descending id", async ({ page }) => {
    const sameInstant = new Date("2025-06-01T09:00:00.000Z");
    await testDb.ticket.createMany({
      data: ["First insert", "Second insert", "Third insert"].map((subject) => ({
        subject,
        customerEmail: "tie@example.com",
        customerName: "Tie Customer",
        createdAt: sameInstant,
        lastMessageAt: sameInstant,
      })),
    });
    await signIn(page, "agent");

    const tickets = await fetchTickets(page);
    expect(tickets.map((t) => t.subject)).toEqual([
      "Third insert",
      "Second insert",
      "First insert",
    ]);
    // Ids descend, confirming the tiebreaker rather than incidental ordering
    expect(tickets.map((t) => t.id)).toEqual(
      [...tickets.map((t) => t.id)].sort((a, b) => b - a),
    );
  });

  test("serialises every Ticket field with dates as ISO strings", async ({
    page,
  }) => {
    await seedTickets();
    await signIn(page, "agent");

    const [newest] = await fetchTickets(page);
    expect(newest).toMatchObject({
      subject: "Newest ticket",
      status: TICKET_STATUS.Open,
      category: null,
      customerEmail: "newest@example.com",
      customerName: "Newest Customer",
      assignedToId: null,
      createdAt: "2025-05-03T12:00:00.000Z",
      lastMessageAt: "2025-05-03T12:00:00.000Z",
    });
    expect(typeof newest.id).toBe("number");
    expect(new Date(newest.updatedAt).toISOString()).toBe(newest.updatedAt);
  });
});

// ---------------------------------------------------------------------------
// API — server-side sorting
// ---------------------------------------------------------------------------

test.describe("Tickets API — sorting", () => {
  test.beforeEach(async () => {
    await resetTickets();
  });

  test("sorts by subject in both directions", async ({ page }) => {
    await seedTickets();
    await signIn(page, "agent");

    expect(
      await fetchSubjects(page, TICKET_SORT_FIELD.subject, SORT_ORDER.asc),
    ).toEqual(["Middle ticket", "Newest ticket", "Oldest ticket"]);
    expect(
      await fetchSubjects(page, TICKET_SORT_FIELD.subject, SORT_ORDER.desc),
    ).toEqual(["Oldest ticket", "Newest ticket", "Middle ticket"]);
  });

  test("sorts by customer name in both directions", async ({ page }) => {
    await seedTickets();
    await signIn(page, "agent");

    expect(
      await fetchSubjects(page, TICKET_SORT_FIELD.customerName, SORT_ORDER.asc),
    ).toEqual(["Middle ticket", "Newest ticket", "Oldest ticket"]);
    expect(
      await fetchSubjects(page, TICKET_SORT_FIELD.customerName, SORT_ORDER.desc),
    ).toEqual(["Oldest ticket", "Newest ticket", "Middle ticket"]);
  });

  test("sorts by createdAt in both directions", async ({ page }) => {
    await seedTickets();
    await signIn(page, "agent");

    expect(
      await fetchSubjects(page, TICKET_SORT_FIELD.createdAt, SORT_ORDER.asc),
    ).toEqual(["Oldest ticket", "Middle ticket", "Newest ticket"]);
    expect(
      await fetchSubjects(page, TICKET_SORT_FIELD.createdAt, SORT_ORDER.desc),
    ).toEqual(["Newest ticket", "Middle ticket", "Oldest ticket"]);
  });

  test("sorts by status in enum order, not alphabetically", async ({
    page,
  }) => {
    await seedForStatusSort();
    await signIn(page, "agent");

    // Open -> Resolved -> Closed. Alphabetical would give Alpha, Bravo, Charlie.
    expect(
      await fetchSubjects(page, TICKET_SORT_FIELD.status, SORT_ORDER.asc),
    ).toEqual(["Bravo", "Charlie", "Alpha"]);
    expect(
      await fetchSubjects(page, TICKET_SORT_FIELD.status, SORT_ORDER.desc),
    ).toEqual(["Alpha", "Charlie", "Bravo"]);
  });

  test("sorts by category in enum order and keeps nulls last", async ({
    page,
  }) => {
    await seedForCategorySort();
    await signIn(page, "agent");

    // General -> Technical -> Refund, uncategorised last despite being newest.
    expect(
      await fetchSubjects(page, TICKET_SORT_FIELD.category, SORT_ORDER.asc),
    ).toEqual(["Cat-General", "Cat-Technical", "Cat-Refund", "Cat-None"]);
    expect(
      await fetchSubjects(page, TICKET_SORT_FIELD.category, SORT_ORDER.desc),
    ).toEqual(["Cat-Refund", "Cat-Technical", "Cat-General", "Cat-None"]);
  });

  test("breaks ties by descending id under a non-default sort", async ({
    page,
  }) => {
    await testDb.ticket.createMany({
      data: [1, 2, 3].map((n) => ({
        subject: "Same subject",
        customerEmail: `tie${n}@example.com`,
        customerName: `Tie Customer ${n}`,
        createdAt: new Date(`2025-08-0${n}T12:00:00.000Z`),
        lastMessageAt: new Date(`2025-08-0${n}T12:00:00.000Z`),
      })),
    });
    await signIn(page, "agent");

    const tickets = await fetchTickets(page, {
      sort: TICKET_SORT_FIELD.subject,
      order: SORT_ORDER.asc,
    });
    const ids = tickets.map((t) => t.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
  });

  test("rejects an unknown sort field", async ({ page }) => {
    await signIn(page, "agent");
    const res = await page.request.get(TICKETS_ENDPOINT, {
      params: { sort: "customerEmail; drop table ticket", order: "asc" },
    });

    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe("Invalid sort field");
  });

  test("rejects an unknown sort order", async ({ page }) => {
    await signIn(page, "agent");
    const res = await page.request.get(TICKETS_ENDPOINT, {
      params: { sort: TICKET_SORT_FIELD.subject, order: "sideways" },
    });

    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe("Invalid sort order");
  });

  test("falls back to the default order when params are omitted", async ({
    page,
  }) => {
    await seedTickets();
    await signIn(page, "agent");

    const tickets = await fetchTickets(page);
    expect(tickets.map((t) => t.subject)).toEqual([
      "Newest ticket",
      "Middle ticket",
      "Oldest ticket",
    ]);
  });
});

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

test.describe("Tickets page", () => {
  test.beforeEach(async () => {
    await resetTickets();
  });

  test("redirects to /login when unauthenticated", async ({ page }) => {
    await page.goto("/tickets");
    await expect(page).toHaveURL("/login");
  });

  test("agent can reach /tickets from the navbar link", async ({ page }) => {
    await signIn(page, "agent");
    await page.getByRole("link", { name: "Tickets" }).click();

    await expect(page).toHaveURL("/tickets");
    await expect(
      page.getByRole("heading", { name: "Tickets", level: 1 }),
    ).toBeVisible();
  });

  test("admin can reach /tickets too", async ({ page }) => {
    await signIn(page, "admin");
    await page.goto("/tickets");

    await expect(
      page.getByRole("heading", { name: "Tickets", level: 1 }),
    ).toBeVisible();
  });

  test("shows the empty state when there are no tickets", async ({ page }) => {
    await signIn(page, "agent");
    await page.goto("/tickets");

    await expect(page.getByText("No tickets found.")).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
  });

  test("renders seeded tickets newest first with customer and status", async ({
    page,
  }) => {
    await seedTickets();
    await signIn(page, "agent");
    await page.goto("/tickets");

    const rows = page.getByRole("row");
    // Row 0 is the header
    await expect(rows.nth(1)).toContainText("Newest ticket");
    await expect(rows.nth(1)).toContainText("Newest Customer");
    await expect(rows.nth(1)).toContainText("newest@example.com");
    await expect(rows.nth(1)).toContainText(TICKET_STATUS.Open);

    await expect(rows.nth(2)).toContainText("Middle ticket");
    await expect(rows.nth(2)).toContainText(TICKET_STATUS.Resolved);
    await expect(rows.nth(2)).toContainText(TICKET_CATEGORY.Technical);

    await expect(rows.nth(3)).toContainText("Oldest ticket");
    await expect(rows.nth(3)).toContainText(TICKET_STATUS.Closed);
  });

  test("shows a dash for an uncategorised ticket", async ({ page }) => {
    await seedTickets();
    await signIn(page, "agent");
    await page.goto("/tickets");

    const newestRow = page.getByRole("row").nth(1);
    await expect(newestRow).toContainText("—");
  });

  test("clicking a header re-sorts the rows via the server", async ({
    page,
  }) => {
    await seedTickets();
    await signIn(page, "agent");
    await page.goto("/tickets");

    const rows = page.getByRole("row");
    await expect(rows.nth(1)).toContainText("Newest ticket");

    const request = page.waitForRequest(
      (req) =>
        req.url().includes("/api/tickets") &&
        req.url().includes(`sort=${TICKET_SORT_FIELD.customerName}`) &&
        req.url().includes(`order=${SORT_ORDER.asc}`),
    );
    await page.getByRole("button", { name: "Customer" }).click();
    await request;

    // customerName ascending: Middle, Newest, Oldest
    await expect(rows.nth(1)).toContainText("Middle Customer");
    await expect(rows.nth(2)).toContainText("Newest Customer");
    await expect(rows.nth(3)).toContainText("Oldest Customer");
  });

  test("moves the aria-sort marker to the clicked column", async ({ page }) => {
    await seedTickets();
    await signIn(page, "agent");
    await page.goto("/tickets");

    const created = page.getByRole("columnheader", { name: "Created" });
    const subject = page.getByRole("columnheader", { name: "Subject" });
    await expect(created).toHaveAttribute("aria-sort", "descending");
    await expect(subject).toHaveAttribute("aria-sort", "none");

    await page.getByRole("button", { name: "Subject" }).click();

    await expect(subject).toHaveAttribute("aria-sort", "ascending");
    await expect(created).toHaveAttribute("aria-sort", "none");
    await expect(page.getByRole("row").nth(1)).toContainText("Middle ticket");
  });
});
