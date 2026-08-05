import { test, expect, type Page } from "@playwright/test";
import {
  CATEGORY_NONE,
  DEFAULT_PAGE_SIZE,
  FIRST_PAGE,
  MAX_PAGE_SIZE,
  SORT_ORDER,
  TICKET_CATEGORY,
  TICKET_SEARCH_MAX_LENGTH,
  TICKET_SORT_FIELD,
  TICKET_STATUS,
  type SortOrder,
  type Ticket,
  type TicketsListResponse,
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

interface TicketsQueryParams {
  sort?: TicketSortField;
  order?: SortOrder;
  status?: string;
  category?: string;
  q?: string;
  page?: number | string;
  pageSize?: number | string;
}

/** Playwright's `params` takes a flat record — drop unset keys. */
function toSearchParams(
  params: TicketsQueryParams,
): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined),
  ) as Record<string, string | number>;
}

/**
 * Seeds `count` tickets named "Ticket 01"… with ascending createdAt, so the
 * default newest-first order is the exact reverse of the subject order — a
 * page that ignored either would be obvious.
 */
async function seedNumberedTickets(count: number): Promise<void> {
  await testDb.ticket.createMany({
    data: Array.from({ length: count }, (_, i) => {
      const n = String(i + 1).padStart(2, "0");
      const at = new Date(Date.UTC(2025, 0, i + 1, 12));
      return {
        subject: `Ticket ${n}`,
        customerEmail: `ticket${n}@example.com`,
        customerName: `Customer ${n}`,
        createdAt: at,
        lastMessageAt: at,
      };
    }),
  });
}

async function fetchPage(
  page: Page,
  params?: TicketsQueryParams,
): Promise<TicketsListResponse> {
  const res = await page.request.get(TICKETS_ENDPOINT, {
    params: params && toSearchParams(params),
  });
  expect(res.status()).toBe(200);
  return (await res.json()) as TicketsListResponse;
}

async function fetchTickets(
  page: Page,
  params?: TicketsQueryParams,
): Promise<Ticket[]> {
  return (await fetchPage(page, params)).tickets;
}

async function fetchSubjects(
  page: Page,
  sort: TicketSortField,
  order: SortOrder,
): Promise<string[]> {
  const tickets = await fetchTickets(page, { sort, order });
  return tickets.map((t) => t.subject);
}

/**
 * The filters use the shadcn (Radix) Select: a combobox trigger plus a
 * portalled listbox, so there is no native <select> to `selectOption`.
 */
async function chooseFilter(
  page: Page,
  label: string,
  optionName: string,
): Promise<void> {
  await page.getByLabel(label).click();
  // Exact: option names are matched as substrings by default, so "10" would
  // also hit the "100" page-size row.
  await page.getByRole("option", { name: optionName, exact: true }).click();
}

async function filterSubjects(
  page: Page,
  params: TicketsQueryParams,
): Promise<string[]> {
  const tickets = await fetchTickets(page, params);
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
// API — filtering
// ---------------------------------------------------------------------------

test.describe("Tickets API — filtering", () => {
  test.beforeEach(async () => {
    await resetTickets();
  });

  test("filters by status", async ({ page }) => {
    await seedTickets();
    await signIn(page, "agent");

    expect(await filterSubjects(page, { status: TICKET_STATUS.Open })).toEqual([
      "Newest ticket",
    ]);
    expect(
      await filterSubjects(page, { status: TICKET_STATUS.Resolved }),
    ).toEqual(["Middle ticket"]);
    expect(await filterSubjects(page, { status: TICKET_STATUS.Closed })).toEqual(
      ["Oldest ticket"],
    );
  });

  test("filters by category", async ({ page }) => {
    await seedTickets();
    await signIn(page, "agent");

    expect(
      await filterSubjects(page, { category: TICKET_CATEGORY.Technical }),
    ).toEqual(["Middle ticket"]);
    expect(
      await filterSubjects(page, { category: TICKET_CATEGORY.Refund }),
    ).toEqual([]);
  });

  test("filters to uncategorised tickets with category=none", async ({
    page,
  }) => {
    await seedTickets();
    await signIn(page, "agent");

    // Only "Middle ticket" has a category, so the other two come back.
    expect(await filterSubjects(page, { category: CATEGORY_NONE })).toEqual([
      "Newest ticket",
      "Oldest ticket",
    ]);
  });

  test("searches subject, customer name and customer email", async ({
    page,
  }) => {
    await seedTickets();
    await signIn(page, "agent");

    expect(await filterSubjects(page, { q: "Oldest ticket" })).toEqual([
      "Oldest ticket",
    ]);
    expect(await filterSubjects(page, { q: "Middle Customer" })).toEqual([
      "Middle ticket",
    ]);
    expect(await filterSubjects(page, { q: "newest@example.com" })).toEqual([
      "Newest ticket",
    ]);
    // Substring shared by all three customer names
    expect((await filterSubjects(page, { q: "Customer" })).sort()).toEqual([
      "Middle ticket",
      "Newest ticket",
      "Oldest ticket",
    ]);
  });

  test("search is case-insensitive", async ({ page }) => {
    await seedTickets();
    await signIn(page, "agent");

    expect(await filterSubjects(page, { q: "OLDEST TICKET" })).toEqual([
      "Oldest ticket",
    ]);
    expect(await filterSubjects(page, { q: "oldest ticket" })).toEqual([
      "Oldest ticket",
    ]);
  });

  test("returns an empty list when nothing matches", async ({ page }) => {
    await seedTickets();
    await signIn(page, "agent");

    expect(await filterSubjects(page, { q: "no-such-ticket-anywhere" })).toEqual(
      [],
    );
  });

  test("combines filters as AND", async ({ page }) => {
    await seedTickets();
    await signIn(page, "agent");

    expect(
      await filterSubjects(page, {
        status: TICKET_STATUS.Open,
        category: CATEGORY_NONE,
      }),
    ).toEqual(["Newest ticket"]);
    // Open tickets that are also Technical: none, since Middle is Resolved.
    expect(
      await filterSubjects(page, {
        status: TICKET_STATUS.Open,
        category: TICKET_CATEGORY.Technical,
      }),
    ).toEqual([]);
  });

  test("applies filters and sorting together", async ({ page }) => {
    await seedTickets();
    await signIn(page, "agent");

    expect(
      await filterSubjects(page, {
        category: CATEGORY_NONE,
        sort: TICKET_SORT_FIELD.subject,
        order: SORT_ORDER.asc,
      }),
    ).toEqual(["Newest ticket", "Oldest ticket"]);
    expect(
      await filterSubjects(page, {
        category: CATEGORY_NONE,
        sort: TICKET_SORT_FIELD.subject,
        order: SORT_ORDER.desc,
      }),
    ).toEqual(["Oldest ticket", "Newest ticket"]);
  });

  test("treats a blank search as no filter", async ({ page }) => {
    await seedTickets();
    await signIn(page, "agent");

    expect((await filterSubjects(page, { q: "   " })).length).toBe(3);
  });

  test("rejects an unknown status filter", async ({ page }) => {
    await signIn(page, "agent");
    const res = await page.request.get(TICKETS_ENDPOINT, {
      params: { status: "Escalated" },
    });

    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe("Invalid status filter");
  });

  test("rejects an unknown category filter", async ({ page }) => {
    await signIn(page, "agent");
    const res = await page.request.get(TICKETS_ENDPOINT, {
      params: { category: "Billing" },
    });

    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe("Invalid category filter");
  });

  test("rejects an over-long search", async ({ page }) => {
    await signIn(page, "agent");
    const res = await page.request.get(TICKETS_ENDPOINT, {
      params: { q: "x".repeat(TICKET_SEARCH_MAX_LENGTH + 1) },
    });

    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain("100 characters");
  });
});

// ---------------------------------------------------------------------------
// API — pagination
// ---------------------------------------------------------------------------

test.describe("Tickets API — pagination", () => {
  test.beforeEach(async () => {
    await resetTickets();
  });

  test("defaults to the first page and echoes the paging back", async ({
    page,
  }) => {
    await seedNumberedTickets(30);
    await signIn(page, "agent");

    const body = await fetchPage(page);
    expect(body.page).toBe(FIRST_PAGE);
    expect(body.pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(body.total).toBe(30);
    expect(body.tickets).toHaveLength(DEFAULT_PAGE_SIZE);
  });

  test("total counts every match, not just the page", async ({ page }) => {
    await seedNumberedTickets(30);
    await signIn(page, "agent");

    const body = await fetchPage(page, { pageSize: 10 });
    expect(body.tickets).toHaveLength(10);
    expect(body.total).toBe(30);
  });

  test("walks pages without repeating or skipping a ticket", async ({
    page,
  }) => {
    await seedNumberedTickets(30);
    await signIn(page, "agent");

    const seen: string[] = [];
    for (const n of [1, 2, 3]) {
      const body = await fetchPage(page, { page: n, pageSize: 10 });
      expect(body.page).toBe(n);
      seen.push(...body.tickets.map((t) => t.subject));
    }

    expect(seen).toHaveLength(30);
    expect(new Set(seen).size).toBe(30);
  });

  test("returns the last partial page", async ({ page }) => {
    await seedNumberedTickets(30);
    await signIn(page, "agent");

    // 30 tickets at 25 per page: page 2 is the last and holds the remaining 5.
    const body = await fetchPage(page, { page: 2, pageSize: 25 });
    expect(body.tickets).toHaveLength(5);
    expect(body.total).toBe(30);
  });

  test("returns an empty page past the end", async ({ page }) => {
    await seedNumberedTickets(30);
    await signIn(page, "agent");

    const body = await fetchPage(page, { page: 99, pageSize: 10 });
    expect(body.tickets).toEqual([]);
    // The total still describes the result set, so the UI can recover.
    expect(body.total).toBe(30);
  });

  test("pages within the requested sort", async ({ page }) => {
    await seedNumberedTickets(30);
    await signIn(page, "agent");

    const body = await fetchPage(page, {
      sort: TICKET_SORT_FIELD.subject,
      order: SORT_ORDER.asc,
      page: 2,
      pageSize: 10,
    });
    expect(body.tickets.map((t) => t.subject)).toEqual(
      Array.from({ length: 10 }, (_, i) => `Ticket ${11 + i}`),
    );
  });

  test("counts only filtered tickets", async ({ page }) => {
    await seedNumberedTickets(30);
    await seedTickets();
    await signIn(page, "agent");

    const body = await fetchPage(page, { q: "Ticket 1", pageSize: 5 });
    // Subjects are zero-padded, so "Ticket 1" matches "Ticket 10".."Ticket 19"
    // only — 10 of the 33 seeded rows, returned 5 at a time.
    expect(body.total).toBe(10);
    expect(body.tickets).toHaveLength(5);
  });

  test("rejects a non-numeric or out-of-range page", async ({ page }) => {
    await signIn(page, "agent");

    for (const value of ["abc", "0", "-1", "1.5"]) {
      const res = await page.request.get(TICKETS_ENDPOINT, {
        params: { page: value },
      });
      expect(res.status(), `page=${value}`).toBe(400);
      expect((await res.json()).error).toBe("Invalid page");
    }
  });

  test("rejects a page size above the cap", async ({ page }) => {
    await signIn(page, "agent");

    const res = await page.request.get(TICKETS_ENDPOINT, {
      params: { pageSize: MAX_PAGE_SIZE + 1 },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain(String(MAX_PAGE_SIZE));
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

  test("renders filter dropdowns as themed in-page popovers", async ({
    page,
  }) => {
    await signIn(page, "agent");
    await page.goto("/tickets");
    await page.getByLabel("Status").waitFor();

    // Still asserted because scrollbars and the search field's native clear
    // button are drawn by the browser even though the dropdown no longer is.
    const scheme = await page.evaluate(
      () => getComputedStyle(document.documentElement).colorScheme,
    );
    expect(scheme).toBe("dark");

    await page.getByLabel("Status").click();
    const listbox = page.getByRole("listbox");
    await expect(listbox).toBeVisible();

    // An OS-drawn menu would have no computed style to read. This one is our
    // DOM, painted from --popover, so it cannot land white-on-white.
    const background = await listbox.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    expect(background).not.toBe("rgba(0, 0, 0, 0)");
    await expect(
      page.getByRole("option", { name: TICKET_STATUS.Open }),
    ).toBeVisible();
  });

  test("opens dropdowns at least as wide as the control", async ({ page }) => {
    await signIn(page, "agent");
    await page.goto("/tickets");

    for (const label of ["Status", "Category"]) {
      const trigger = page.getByLabel(label);
      // Measure while closed: once open, "Any status" / "Any category" also
      // match getByLabel, and the control's resting width is what we care about.
      const triggerBox = await trigger.boundingBox();
      await trigger.click();

      const listbox = page.getByRole("listbox");
      await expect(listbox).toBeVisible();

      if (!triggerBox) throw new Error(`no box for ${label}`);

      // A narrower menu than its own control reads as a rendering bug. Polled
      // rather than measured once: the open animation zooms from 95%, so a
      // single read can catch it mid-flight and under-report the width.
      await expect
        .poll(async () => (await listbox.boundingBox())?.width ?? 0)
        .toBeGreaterThanOrEqual(triggerBox.width);

      await page.keyboard.press("Escape");
      await expect(listbox).toBeHidden();
    }
  });

  test("narrows the list with the status filter", async ({ page }) => {
    await seedTickets();
    await signIn(page, "agent");
    await page.goto("/tickets");
    await expect(page.getByRole("row")).toHaveCount(4); // header + 3

    await chooseFilter(page, "Status", TICKET_STATUS.Resolved);

    await expect(page.getByRole("row")).toHaveCount(2); // header + 1
    await expect(page.getByRole("row").nth(1)).toContainText("Middle ticket");
  });

  test("narrows the list with the category filter, including uncategorised", async ({
    page,
  }) => {
    await seedTickets();
    await signIn(page, "agent");
    await page.goto("/tickets");

    await chooseFilter(page, "Category", TICKET_CATEGORY.Technical);
    await expect(page.getByRole("row")).toHaveCount(2);
    await expect(page.getByRole("row").nth(1)).toContainText("Middle ticket");

    await chooseFilter(page, "Category", "Uncategorised");
    await expect(page.getByRole("row")).toHaveCount(3);
    await expect(page.getByRole("row").nth(1)).toContainText("Newest ticket");
  });

  test("searches across subject and customer", async ({ page }) => {
    await seedTickets();
    await signIn(page, "agent");
    await page.goto("/tickets");

    await page.getByLabel("Search").fill("oldest@example.com");

    await expect(page.getByRole("row")).toHaveCount(2);
    await expect(page.getByRole("row").nth(1)).toContainText("Oldest ticket");
  });

  test("explains an empty result and lets the filter be cleared", async ({
    page,
  }) => {
    await seedTickets();
    await signIn(page, "agent");
    await page.goto("/tickets");

    await page.getByLabel("Search").fill("no-such-ticket-anywhere");

    await expect(
      page.getByText("No tickets match these filters."),
    ).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);

    await page.getByRole("button", { name: "Clear filters" }).click();

    await expect(page.getByRole("row")).toHaveCount(4);
    await expect(page.getByLabel("Search")).toHaveValue("");
  });

  test("keeps the filter applied while re-sorting", async ({ page }) => {
    await seedTickets();
    await signIn(page, "agent");
    await page.goto("/tickets");

    await chooseFilter(page, "Category", "Uncategorised");
    await expect(page.getByRole("row")).toHaveCount(3);

    await page.getByRole("button", { name: "Subject" }).click();

    // Still only the two uncategorised tickets, now subject-ascending.
    await expect(page.getByRole("row")).toHaveCount(3);
    await expect(page.getByRole("row").nth(1)).toContainText("Newest ticket");
    await expect(page.getByRole("row").nth(2)).toContainText("Oldest ticket");
  });

  test("pages through the list and back", async ({ page }) => {
    await seedNumberedTickets(30);
    await signIn(page, "agent");
    await page.goto("/tickets");

    // Default order is newest-first, so page 1 starts at Ticket 30.
    await expect(page.getByRole("row")).toHaveCount(DEFAULT_PAGE_SIZE + 1);
    await expect(page.getByText("1–25 of 30")).toBeVisible();
    await expect(page.getByText("Page 1 of 2")).toBeVisible();
    await expect(page.getByRole("row").nth(1)).toContainText("Ticket 30");

    const previous = page.getByRole("button", { name: "Previous page" });
    const next = page.getByRole("button", { name: "Next page" });
    await expect(previous).toBeDisabled();

    await next.click();

    await expect(page.getByText("26–30 of 30")).toBeVisible();
    await expect(page.getByRole("row")).toHaveCount(6);
    await expect(page.getByRole("row").nth(1)).toContainText("Ticket 05");
    await expect(next).toBeDisabled();
    await expect(previous).toBeEnabled();

    await previous.click();
    await expect(page.getByText("1–25 of 30")).toBeVisible();
  });

  test("changing the page size returns to the first page", async ({ page }) => {
    await seedNumberedTickets(30);
    await signIn(page, "agent");
    await page.goto("/tickets");

    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page.getByText("Page 2 of 2")).toBeVisible();

    await chooseFilter(page, "Per page", "10");

    await expect(page.getByText("1–10 of 30")).toBeVisible();
    await expect(page.getByText("Page 1 of 3")).toBeVisible();
    await expect(page.getByRole("row")).toHaveCount(11);
  });

  test("filtering resets paging and recounts", async ({ page }) => {
    await seedNumberedTickets(30);
    await signIn(page, "agent");
    await page.goto("/tickets");

    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page.getByText("Page 2 of 2")).toBeVisible();

    await page.getByLabel("Search").fill("Ticket 2");

    // Zero-padded subjects: "Ticket 20".."Ticket 29", 10 matches, back on page 1.
    await expect(page.getByText("1–10 of 10")).toBeVisible();
    await expect(page.getByText("Page 1 of 1")).toBeVisible();
  });

  test("hides pagination when nothing matches", async ({ page }) => {
    await seedNumberedTickets(30);
    await signIn(page, "agent");
    await page.goto("/tickets");

    await page.getByLabel("Search").fill("no-such-ticket-anywhere");

    await expect(
      page.getByText("No tickets match these filters."),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Pagination" }),
    ).toHaveCount(0);
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
