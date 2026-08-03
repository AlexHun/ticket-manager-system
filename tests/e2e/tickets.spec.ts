import { test, expect, type Page } from "@playwright/test";
import { TICKET_CATEGORY, TICKET_STATUS, type Ticket } from "@ticket/shared";
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

async function fetchTickets(page: Page): Promise<Ticket[]> {
  const res = await page.request.get(TICKETS_ENDPOINT);
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { tickets: Ticket[] };
  return body.tickets;
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
});
