import { test, expect, type Page } from "@playwright/test";
import {
  CATEGORY_NONE,
  DEFAULT_PAGE_SIZE,
  FIRST_PAGE,
  MAX_MESSAGE_BODY_LENGTH,
  MAX_PAGE_SIZE,
  MAX_TICKET_ID,
  MESSAGE_DIRECTION,
  SORT_ORDER,
  TICKET_CATEGORY,
  TICKET_SEARCH_MAX_LENGTH,
  TICKET_SORT_FIELD,
  TICKET_STATUS,
  USER_ROLE,
  type CreateTicketMessageResponse,
  type SortOrder,
  type Ticket,
  type TicketAssignee,
  type TicketAssigneesResponse,
  type TicketDetail,
  type TicketDetailResponse,
  type TicketsListResponse,
  type TicketSortField,
  type UpdateTicketResponse,
} from "@ticket/shared";
import { CREDENTIALS, signIn } from "./helpers/auth";
import { resetE2eUsers, resetTickets, testDb } from "./helpers/db";
import {
  API_URL,
  WEBHOOK_PASSWORD,
  WEBHOOK_URL,
  WEBHOOK_USERNAME,
} from "./helpers/env";

const TICKETS_ENDPOINT = `${API_URL}/api/tickets`;
const ASSIGNEES_ENDPOINT = `${TICKETS_ENDPOINT}/assignees`;

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
        // Explicit, and deliberately not the column default. The status
        // assertion below is a substring match, and "New" is a substring of both
        // "Newest ticket" and "Newest Customer" — so a row left on the default
        // would pass that assertion without rendering a badge at all.
        status: TICKET_STATUS.Open,
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
 * Statuses seeded so that enum order produces a sequence matching neither
 * insertion order nor the default createdAt-desc order — and differing from
 * alphabetical, which would give Alpha, Bravo, Charlie.
 *
 * The enum is New, Processing, Open, Resolved, Closed; these three sit in its
 * back half, and their order relative to each other is what this checks.
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

interface ThreadSeedOptions {
  subject?: string;
  /** Assigned to nobody unless a user id is passed. */
  assignedToId?: string;
  /** Raw inbound HTML, to prove it never reaches the client. */
  htmlBody?: string;
}

/**
 * A ticket with a three-message thread, created out of chronological order so
 * that a route which returned insertion order would fail the ascending
 * assertions. Message.createdAt has a default, so the explicit values are what
 * make the ordering meaningful at all.
 */
async function seedTicketWithThread(
  options: ThreadSeedOptions = {},
): Promise<number> {
  const { subject = "Threaded ticket", assignedToId, htmlBody } = options;
  const at = (day: string) => new Date(`2025-09-${day}T12:00:00.000Z`);

  const ticket = await testDb.ticket.create({
    data: {
      subject,
      customerEmail: "threaded@example.com",
      customerName: "Threaded Customer",
      category: TICKET_CATEGORY.Technical,
      // Explicit rather than the column default, which is now `New`. A ticket
      // that already carries a support reply is past the untriaged state by
      // definition, and "replying leaves the status alone" is only a meaningful
      // assertion against a status somebody chose.
      status: TICKET_STATUS.Open,
      assignedToId,
      createdAt: at("01"),
      lastMessageAt: at("03"),
      messages: {
        create: [
          {
            messageId: `<middle-${Date.now()}@example.com>`,
            senderEmail: "support@example.com",
            senderName: "Support Team",
            textBody: "Second message, from support.",
            htmlBody,
            direction: MESSAGE_DIRECTION.outbound,
            createdAt: at("02"),
          },
          {
            messageId: `<first-${Date.now()}@example.com>`,
            senderEmail: "threaded@example.com",
            senderName: "Threaded Customer",
            textBody: "First message, from the customer.",
            direction: MESSAGE_DIRECTION.inbound,
            createdAt: at("01"),
          },
          {
            messageId: `<last-${Date.now()}@example.com>`,
            senderEmail: "threaded@example.com",
            senderName: "Threaded Customer",
            textBody: "Third message, from the customer.",
            direction: MESSAGE_DIRECTION.inbound,
            createdAt: at("03"),
          },
        ],
      },
    },
    select: { id: true },
  });

  return ticket.id;
}

/** The signed-in agent's row, for assignment assertions. */
async function agentUserId(): Promise<string> {
  const user = await testDb.user.findUniqueOrThrow({
    where: { email: CREDENTIALS.agent.email },
    select: { id: true },
  });
  return user.id;
}

function detailEndpoint(id: number | string): string {
  return `${TICKETS_ENDPOINT}/${id}`;
}

function assigneeEndpoint(id: number | string): string {
  return `${TICKETS_ENDPOINT}/${id}/assignee`;
}

function messagesEndpoint(id: number | string): string {
  return `${TICKETS_ENDPOINT}/${id}/messages`;
}

/**
 * `textBody` is deliberately `unknown`: the rejection tests point it at values
 * the client could never produce, which is the whole reason the server
 * validates rather than trusting the composer.
 */
async function reply(
  page: Page,
  ticketId: number | string,
  textBody: unknown,
) {
  return page.request.post(messagesEndpoint(ticketId), { data: { textBody } });
}

/** A ticket with nothing on it — the state a first reply threads nothing onto. */
async function seedEmptyTicket(): Promise<number> {
  const ticket = await testDb.ticket.create({
    data: {
      subject: "Nothing said yet",
      customerEmail: "quiet@example.com",
      customerName: "Quiet Customer",
    },
    select: { id: true },
  });
  return ticket.id;
}

/**
 * Extra people for the assignment tests: two agents to hand a ticket between,
 * an admin who is offered alongside them, and a user deleted after the fact.
 *
 * Ids are written out because `User.id` has no database default — Better Auth
 * mints one per real sign-up, and these rows only ever exist to be pointed at.
 * The `e2e-` prefix is what lets `resetE2eUsers` sweep them again.
 */
const SEEDED_USERS = [
  {
    id: "e2e-assignee-zoe",
    name: "Zoe Assignee",
    email: "e2e-assignee-zoe@example.com",
    role: USER_ROLE.agent,
    deletedAt: null,
  },
  {
    id: "e2e-assignee-yuri",
    name: "Yuri Assignee",
    email: "e2e-assignee-yuri@example.com",
    role: USER_ROLE.agent,
    deletedAt: null,
  },
  {
    id: "e2e-assignee-admin",
    name: "Extra Admin",
    email: "e2e-assignee-admin@example.com",
    role: USER_ROLE.admin,
    deletedAt: null,
  },
  {
    id: "e2e-assignee-deleted",
    name: "Deleted Assignee",
    email: "e2e-assignee-deleted@example.com",
    role: USER_ROLE.agent,
    deletedAt: new Date("2025-01-01T00:00:00.000Z"),
  },
] as const;

const ZOE = SEEDED_USERS[0];
const YURI = SEEDED_USERS[1];
const EXTRA_ADMIN = SEEDED_USERS[2];
const DELETED_USER = SEEDED_USERS[3];

/** Recreated rather than upserted, so a half-finished earlier run can't skew it. */
async function seedAssignableUsers(): Promise<void> {
  const ids = SEEDED_USERS.map((u) => u.id);
  await testDb.user.deleteMany({ where: { id: { in: ids } } });
  await testDb.user.createMany({ data: [...SEEDED_USERS] });
}

async function fetchAssignees(page: Page): Promise<TicketAssignee[]> {
  const res = await page.request.get(ASSIGNEES_ENDPOINT);
  expect(res.status()).toBe(200);
  return ((await res.json()) as TicketAssigneesResponse).assignees;
}

async function assign(
  page: Page,
  ticketId: number | string,
  assignedToId: unknown,
) {
  return page.request.patch(assigneeEndpoint(ticketId), {
    data: { assignedToId },
  });
}

async function fetchDetail(page: Page, id: number): Promise<TicketDetail> {
  const res = await page.request.get(detailEndpoint(id));
  expect(res.status()).toBe(200);
  return ((await res.json()) as TicketDetailResponse).ticket;
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
 * By role, not by label: the column headers carry the same names as the
 * filters ("Status", "Category"), so getByLabel would match both.
 */
function filterControl(page: Page, label: string) {
  return page.getByRole("combobox", { name: label, exact: true });
}

/**
 * The messages in the thread, and nothing else.
 *
 * Scoped to the named list rather than `page.locator("ol > li")`, which is not
 * specific enough: sonner renders its toasts as an `<ol>` of `<li>`, so the
 * "Reply added to the thread" toast counted as a fourth message and the reply
 * test failed with "Expected: 4, Received: 5" whenever the assertion ran before
 * the toast timed out. A race, so it passed often enough to look fine.
 */
function threadMessages(page: Page) {
  return page.getByRole("list", { name: "Message thread" }).locator("> li");
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
  await filterControl(page, label).click();
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

/** Rendered width of every column header, keyed by label. */
async function columnWidths(page: Page): Promise<Record<string, number>> {
  // Wait for the real table, not just *a* columnheader: the loading skeleton's
  // <th>s carry the same label as plain text and no aria-label, so a
  // role/name query matches them too and can resolve while the skeleton is
  // still up — evaluateAll then reads widths keyed by "" instead of the
  // column names, and `.Subject` comes back undefined. aria-label is the one
  // thing only the loaded table sets, so scope both the wait and the read to it.
  await page.locator('th[aria-label="Subject"]').waitFor();
  return page.locator("th[aria-label]").evaluateAll((els) =>
    Object.fromEntries(
      els.map((el) => [
        el.getAttribute("aria-label") ?? "",
        el.getBoundingClientRect().width,
      ]),
    ),
  );
}

function resizeHandleFor(page: Page, column: string) {
  return page.getByRole("separator", { name: `Resize ${column} column` });
}

/** Drag a column edge by `dx` pixels. */
async function dragHandle(
  page: Page,
  column: string,
  dx: number,
): Promise<void> {
  const handle = resizeHandleFor(page, column);
  const box = await handle.boundingBox();
  if (!box) throw new Error(`no resize handle for ${column}`);

  const y = box.y + box.height / 2;
  const x = box.x + box.width / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();

  // Wait for the component to say the drag started, rather than assuming it.
  //
  // TanStack registers its document-level mousemove listener inside the React
  // `onMouseDown` handler, so any move dispatched before that render commits
  // lands nowhere and the drag silently does nothing at all — the column comes
  // back the exact same width, which is how this failed intermittently under
  // load ("Expected: > 332.71875, Received: 332.71875"). `ResizeHandle` sets
  // `data-resizing` for precisely this state, so it is a real signal and not a
  // sleep.
  await expect(handle).toHaveAttribute("data-resizing", "true");

  // Two moves minimum, and stepped: one jump can be coalesced, and the
  // intermediate events are what a drag actually looks like.
  await page.mouse.move(x + dx / 2, y, { steps: 5 });
  await page.mouse.move(x + dx, y, { steps: 5 });
  await page.mouse.up();
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
// API — single ticket
// ---------------------------------------------------------------------------

test.describe("Ticket detail API", () => {
  test.beforeEach(async () => {
    await resetTickets();
  });

  test("-> 401 when unauthenticated, even for an id that doesn't exist", async ({
    request,
  }) => {
    const id = await seedTicketWithThread();

    // Both must 401 identically: a 404 for the missing id would tell a signed-out
    // caller which ticket ids are real.
    for (const target of [id, MAX_TICKET_ID]) {
      const res = await request.get(detailEndpoint(target));
      expect(res.status(), `id=${target}`).toBe(401);
    }
  });

  // One test per role rather than a loop: signing in twice in the same context
  // never reaches the login form the second time, because /login redirects an
  // already-authenticated visitor away.
  test("-> 200 for an agent (not admin-only)", async ({ page }) => {
    const id = await seedTicketWithThread();
    await signIn(page, "agent");

    const res = await page.request.get(detailEndpoint(id));
    expect(res.status()).toBe(200);
  });

  test("-> 200 for an admin", async ({ page }) => {
    const id = await seedTicketWithThread();
    await signIn(page, "admin");

    const res = await page.request.get(detailEndpoint(id));
    expect(res.status()).toBe(200);
  });

  test("returns the ticket fields with dates as ISO strings", async ({
    page,
  }) => {
    const id = await seedTicketWithThread({ subject: "Serialised ticket" });
    await signIn(page, "agent");

    expect(await fetchDetail(page, id)).toMatchObject({
      id,
      subject: "Serialised ticket",
      status: TICKET_STATUS.Open,
      category: TICKET_CATEGORY.Technical,
      customerEmail: "threaded@example.com",
      customerName: "Threaded Customer",
      assignedToId: null,
      assignedTo: null,
      createdAt: "2025-09-01T12:00:00.000Z",
      lastMessageAt: "2025-09-03T12:00:00.000Z",
    });
  });

  test("returns the thread oldest first", async ({ page }) => {
    const id = await seedTicketWithThread();
    await signIn(page, "agent");

    const { messages } = await fetchDetail(page, id);
    // Seeded middle-first, so insertion order would put "Second" at the top.
    expect(messages.map((m) => m.textBody)).toEqual([
      "First message, from the customer.",
      "Second message, from support.",
      "Third message, from the customer.",
    ]);
    expect(messages.map((m) => m.direction)).toEqual([
      MESSAGE_DIRECTION.inbound,
      MESSAGE_DIRECTION.outbound,
      MESSAGE_DIRECTION.inbound,
    ]);
    expect(messages[0].createdAt).toBe("2025-09-01T12:00:00.000Z");
  });

  test("breaks message ties by ascending id", async ({ page }) => {
    const sameInstant = new Date("2025-09-05T09:00:00.000Z");
    const ticket = await testDb.ticket.create({
      data: {
        subject: "Tied thread",
        customerEmail: "tied@example.com",
        customerName: "Tied Customer",
        messages: {
          create: ["First insert", "Second insert", "Third insert"].map(
            (textBody, i) => ({
              messageId: `<tie-${i}-${Date.now()}@example.com>`,
              senderEmail: "tied@example.com",
              senderName: "Tied Customer",
              textBody,
              createdAt: sameInstant,
            }),
          ),
        },
      },
      select: { id: true },
    });
    await signIn(page, "agent");

    const { messages } = await fetchDetail(page, ticket.id);
    expect(messages.map((m) => m.textBody)).toEqual([
      "First insert",
      "Second insert",
      "Third insert",
    ]);
    expect(messages.map((m) => m.id)).toEqual(
      [...messages.map((m) => m.id)].sort((a, b) => a - b),
    );
  });

  test("never sends htmlBody, even when the row has one", async ({ page }) => {
    const id = await seedTicketWithThread({
      htmlBody: '<img src="x" onerror="alert(1)">',
    });
    await signIn(page, "agent");

    const { messages } = await fetchDetail(page, id);
    for (const message of messages) {
      expect(message).not.toHaveProperty("htmlBody");
    }
  });

  test("embeds the assignee without leaking the rest of the user row", async ({
    page,
  }) => {
    const assignedToId = await agentUserId();
    const id = await seedTicketWithThread({ assignedToId });
    await signIn(page, "agent");

    const { assignedTo } = await fetchDetail(page, id);
    expect(assignedTo).toMatchObject({
      id: assignedToId,
      email: CREDENTIALS.agent.email,
    });
    expect(assignedTo?.name).toBeTruthy();
    expect(assignedTo).not.toHaveProperty("role");
    expect(assignedTo).not.toHaveProperty("emailVerified");
  });

  test("-> 404 for a well-formed id with no row", async ({ page }) => {
    await signIn(page, "agent");

    const res = await page.request.get(detailEndpoint(MAX_TICKET_ID));
    expect(res.status()).toBe(404);
    expect((await res.json()).error).toBe("Ticket not found");
  });

  test("-> 400 for a malformed id", async ({ page }) => {
    await signIn(page, "agent");

    // The last one is the regression guard: an id past int4 used to reach
    // Prisma and come back as a 500.
    for (const value of ["abc", "0", "-1", "1.5", String(MAX_TICKET_ID + 1)]) {
      const res = await page.request.get(detailEndpoint(value));
      expect(res.status(), `id=${value}`).toBe(400);
      expect((await res.json()).error, `id=${value}`).toBe("Invalid ticket id");
    }
  });
});

// ---------------------------------------------------------------------------
// API — assignment
// ---------------------------------------------------------------------------

test.describe("Ticket assignees API", () => {
  test.beforeAll(async () => {
    await seedAssignableUsers();
  });

  test.afterAll(async () => {
    await resetE2eUsers();
  });

  test("-> 401 when unauthenticated", async ({ request }) => {
    const res = await request.get(ASSIGNEES_ENDPOINT);
    expect(res.status()).toBe(401);
  });

  test("lists the users, in name order", async ({ page }) => {
    await signIn(page, "agent");

    const assignees = await fetchAssignees(page);
    const names = assignees.map((a) => a.name);

    expect(names).toContain(ZOE.name);
    expect(names).toContain(YURI.name);
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
  });

  test("offers admins too — every role works tickets", async ({ page }) => {
    await signIn(page, "agent");

    const emails = (await fetchAssignees(page)).map((a) => a.email);
    expect(emails).toContain(EXTRA_ADMIN.email);
    expect(emails).toContain(CREDENTIALS.admin.email);
  });

  test("drops a user who has been deleted", async ({ page }) => {
    await signIn(page, "agent");

    const emails = (await fetchAssignees(page)).map((a) => a.email);
    expect(emails).toContain(ZOE.email);
    expect(emails).not.toContain(DELETED_USER.email);
  });

  test("sends only the three columns a picker shows", async ({ page }) => {
    await signIn(page, "agent");

    for (const assignee of await fetchAssignees(page)) {
      expect(Object.keys(assignee).sort()).toEqual(["email", "id", "name"]);
    }
  });
});

test.describe("Ticket assignment API", () => {
  test.beforeAll(async () => {
    await seedAssignableUsers();
  });

  test.afterAll(async () => {
    await resetE2eUsers();
  });

  test.beforeEach(async () => {
    await resetTickets();
  });

  test("-> 401 when unauthenticated", async ({ request }) => {
    const id = await seedTicketWithThread();

    const res = await request.patch(assigneeEndpoint(id), {
      data: { assignedToId: ZOE.id },
    });
    expect(res.status()).toBe(401);
  });

  test("assigns a ticket and answers with the resolved assignee", async ({
    page,
  }) => {
    const id = await seedTicketWithThread();
    await signIn(page, "agent");

    const res = await assign(page, id, ZOE.id);

    expect(res.status()).toBe(200);
    const { ticket } = (await res.json()) as UpdateTicketResponse;
    expect(ticket).toMatchObject({
      id,
      assignedToId: ZOE.id,
      assignedTo: { id: ZOE.id, name: ZOE.name, email: ZOE.email },
    });
    // The id alone would leave the client unable to name who it picked: agents
    // can't read /api/users.
    expect(ticket.assignedTo).not.toHaveProperty("role");
    expect(ticket).not.toHaveProperty("messages");
  });

  test("the change is what the detail endpoint reports afterwards", async ({
    page,
  }) => {
    const id = await seedTicketWithThread();
    await signIn(page, "agent");

    await assign(page, id, YURI.id);

    const detail = await fetchDetail(page, id);
    expect(detail.assignedToId).toBe(YURI.id);
    expect(detail.assignedTo?.email).toBe(YURI.email);
    // Assignment is not an edit of the conversation.
    expect(detail.messages).toHaveLength(3);
  });

  test("hands a ticket from one agent to another", async ({ page }) => {
    const id = await seedTicketWithThread({ assignedToId: ZOE.id });
    await signIn(page, "agent");

    const res = await assign(page, id, YURI.id);

    expect(res.status()).toBe(200);
    expect(((await res.json()) as UpdateTicketResponse).ticket.assignedToId).toBe(
      YURI.id,
    );
  });

  test("unassigns on null", async ({ page }) => {
    const id = await seedTicketWithThread({ assignedToId: ZOE.id });
    await signIn(page, "agent");

    const res = await assign(page, id, null);

    expect(res.status()).toBe(200);
    const { ticket } = (await res.json()) as UpdateTicketResponse;
    expect(ticket.assignedToId).toBeNull();
    expect(ticket.assignedTo).toBeNull();
  });

  test("an admin can assign too", async ({ page }) => {
    const id = await seedTicketWithThread();
    await signIn(page, "admin");

    const res = await assign(page, id, ZOE.id);
    expect(res.status()).toBe(200);
  });

  test("hands a ticket to an admin", async ({ page }) => {
    const id = await seedTicketWithThread();
    await signIn(page, "agent");

    // The other side of the test above: there the admin was the caller, here
    // they are the target. It gets its own test because the write path checks
    // the id a second time — were that predicate to narrow back to agents, the
    // picker would go on offering a name the API refuses.
    const res = await assign(page, id, EXTRA_ADMIN.id);

    expect(res.status()).toBe(200);
    const { ticket } = (await res.json()) as UpdateTicketResponse;
    expect(ticket.assignedToId).toBe(EXTRA_ADMIN.id);
    expect(ticket.assignedTo?.email).toBe(EXTRA_ADMIN.email);
  });

  test("-> 400 for someone who cannot be assigned", async ({ page }) => {
    const id = await seedTicketWithThread();
    await signIn(page, "agent");

    // The FK would happily accept the deleted row — being in the user table is
    // not the same as being assignable.
    for (const candidate of ["no-such-user", DELETED_USER.id]) {
      const res = await assign(page, id, candidate);
      expect(res.status(), candidate).toBe(400);
      expect((await res.json()).error, candidate).toBe("Assignee not found");
    }

    // …and the ticket is untouched by any of them.
    expect((await fetchDetail(page, id)).assignedToId).toBeNull();
  });

  test("-> 400 for a malformed body", async ({ page }) => {
    const id = await seedTicketWithThread();
    await signIn(page, "agent");

    for (const value of ["", "   ", 42, ["x"], undefined]) {
      const res = await assign(page, id, value);
      expect(res.status(), JSON.stringify(value ?? null)).toBe(400);
      expect((await res.json()).error).toBe("Invalid assignee");
    }
  });

  test("-> 404 for a ticket that doesn't exist", async ({ page }) => {
    await signIn(page, "agent");

    const res = await assign(page, MAX_TICKET_ID, ZOE.id);
    expect(res.status()).toBe(404);
    expect((await res.json()).error).toBe("Ticket not found");
  });

  test("-> 400 for a malformed ticket id", async ({ page }) => {
    await signIn(page, "agent");

    for (const value of ["abc", "0", "-1", String(MAX_TICKET_ID + 1)]) {
      const res = await assign(page, value, ZOE.id);
      expect(res.status(), `id=${value}`).toBe(400);
      expect((await res.json()).error, `id=${value}`).toBe("Invalid ticket id");
    }
  });
});

test.describe("Ticket reply API", () => {
  test.beforeEach(async () => {
    await resetTickets();
  });

  test("-> 401 when unauthenticated", async ({ request }) => {
    const id = await seedTicketWithThread();

    const res = await request.post(messagesEndpoint(id), {
      data: { textBody: "Let me in." },
    });

    expect(res.status()).toBe(401);
    expect(await testDb.message.count({ where: { ticketId: id } })).toBe(3);
  });

  test("appends an outbound message and answers with it", async ({ page }) => {
    const id = await seedTicketWithThread();
    await signIn(page, "agent");

    const res = await reply(page, id, "Have you tried the reset link?");

    expect(res.status()).toBe(201);
    const { message } = (await res.json()) as CreateTicketMessageResponse;
    expect(message).toMatchObject({
      ticketId: id,
      textBody: "Have you tried the reset link?",
      direction: MESSAGE_DIRECTION.outbound,
      // From the session, never the body — the sender is whoever is signed in.
      senderEmail: CREDENTIALS.agent.email,
    });
  });

  test("threads the reply onto whatever the thread currently ends with", async ({
    page,
  }) => {
    const id = await seedTicketWithThread();
    await signIn(page, "agent");
    const before = await fetchDetail(page, id);
    const last = before.messages[before.messages.length - 1];

    const res = await reply(page, id, "Answering your last note.");

    const { message } = (await res.json()) as CreateTicketMessageResponse;
    // The parent is the message an agent can see at the bottom of the pane, not
    // whichever row the database happened to return first.
    expect(message.inReplyTo).toBe(last.messageId);
  });

  test("a first reply on an empty thread has no parent", async ({ page }) => {
    const id = await seedEmptyTicket();
    await signIn(page, "agent");

    const res = await reply(page, id, "Reaching out first.");

    expect(res.status()).toBe(201);
    const { message } = (await res.json()) as CreateTicketMessageResponse;
    expect(message.inReplyTo).toBeNull();
  });

  test("credits the signed-in user as author as well as sender", async ({
    page,
  }) => {
    const id = await seedTicketWithThread();
    await signIn(page, "agent");

    await reply(page, id, "Signed by whoever is logged in.");

    const row = await testDb.message.findFirstOrThrow({
      where: { ticketId: id, textBody: "Signed by whoever is logged in." },
    });
    // Both, on purpose: the FK is nulled when that agent is deleted, and the
    // thread still has to say who wrote this.
    expect(row.authorId).toBe(await agentUserId());
    expect(row.senderEmail).toBe(CREDENTIALS.agent.email);
  });

  test("never sends htmlBody or authorId to the client", async ({ page }) => {
    const id = await seedTicketWithThread();
    await signIn(page, "agent");

    const res = await reply(page, id, "Nothing internal in this reply.");

    const { message } = (await res.json()) as CreateTicketMessageResponse;
    expect(message).not.toHaveProperty("htmlBody");
    // A ticket is not a window onto the user table, and nothing in the thread
    // renders an author id.
    expect(message).not.toHaveProperty("authorId");
  });

  test("the reply is what the detail endpoint reports afterwards", async ({
    page,
  }) => {
    const id = await seedTicketWithThread();
    await signIn(page, "agent");

    const res = await reply(page, id, "Last word.");
    const { message } = (await res.json()) as CreateTicketMessageResponse;

    const detail = await fetchDetail(page, id);
    expect(detail.messages).toHaveLength(4);
    expect(detail.messages[3]).toMatchObject({
      id: message.id,
      textBody: "Last word.",
      direction: MESSAGE_DIRECTION.outbound,
    });
    // Written from one instant inside one transaction, which is what lets the
    // client move "Last message" to the reply it just got back.
    expect(detail.lastMessageAt).toBe(message.createdAt);
  });

  test("leaves the ticket's status alone", async ({ page }) => {
    const id = await seedTicketWithThread();
    await signIn(page, "agent");

    await reply(page, id, "Answered, but not necessarily resolved.");

    // Replying is not a lifecycle decision: an agent asking a follow-up
    // question has not resolved anything.
    expect((await fetchDetail(page, id)).status).toBe(TICKET_STATUS.Open);
  });

  test("an admin can reply too", async ({ page }) => {
    const id = await seedTicketWithThread();
    await signIn(page, "admin");

    const res = await reply(page, id, "Admins work tickets as well.");

    expect(res.status()).toBe(201);
    const { message } = (await res.json()) as CreateTicketMessageResponse;
    expect(message.senderEmail).toBe(CREDENTIALS.admin.email);
  });

  test("mints a Message-ID a customer's answer threads back onto", async ({
    page,
    request,
  }) => {
    const id = await seedTicketWithThread();
    await signIn(page, "agent");

    const res = await reply(page, id, "Here is a fresh link.");
    const { message } = (await res.json()) as CreateTicketMessageResponse;

    // Stored bare. The webhook strips the brackets a real mail client sends
    // before it looks the parent up, so an id kept *with* them would never
    // match and the customer's answer would open a second ticket instead.
    expect(message.messageId).not.toMatch(/[<>]/);

    const answer = await request.post(WEBHOOK_URL, {
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${WEBHOOK_USERNAME}:${WEBHOOK_PASSWORD}`,
        ).toString("base64")}`,
      },
      data: {
        messageId: `e2e-roundtrip-${Date.now()}@mail.example.com`,
        subject: "Re: Threaded ticket",
        senderEmail: "threaded@example.com",
        senderName: "Threaded Customer",
        textBody: "That worked, thank you.",
        // Brackets on, the way In-Reply-To actually arrives.
        inReplyTo: `<${message.messageId}>`,
      },
    });

    expect(answer.status()).toBe(201);
    expect(await answer.json()).toMatchObject({ ticketId: id, threaded: true });
  });

  test("-> 400 for an empty, blank or non-string reply", async ({ page }) => {
    const id = await seedTicketWithThread();
    await signIn(page, "agent");

    for (const value of ["", "   ", "\n\t ", 42, ["x"], null, undefined]) {
      const res = await reply(page, id, value);
      expect(res.status(), JSON.stringify(value ?? null)).toBe(400);
      expect((await res.json()).error, JSON.stringify(value ?? null)).toBe(
        "Write a reply before sending",
      );
    }

    // …and none of them wrote a row.
    expect(await testDb.message.count({ where: { ticketId: id } })).toBe(3);
  });

  test("-> 400 for a reply past the length cap", async ({ page }) => {
    const id = await seedTicketWithThread();
    await signIn(page, "agent");

    const res = await reply(page, id, "x".repeat(MAX_MESSAGE_BODY_LENGTH + 1));

    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe(
      `A reply is limited to ${MAX_MESSAGE_BODY_LENGTH} characters`,
    );
    // The cap is on the trimmed value, so one right at it still goes through.
    expect(
      (await reply(page, id, "x".repeat(MAX_MESSAGE_BODY_LENGTH))).status(),
    ).toBe(201);
  });

  test("stores the trimmed reply, not the whitespace around it", async ({
    page,
  }) => {
    const id = await seedTicketWithThread();
    await signIn(page, "agent");

    const res = await reply(page, id, "  Padded on both sides.\n\n");

    const { message } = (await res.json()) as CreateTicketMessageResponse;
    expect(message.textBody).toBe("Padded on both sides.");
  });

  test("-> 404 for a ticket that doesn't exist", async ({ page }) => {
    await signIn(page, "agent");

    const res = await reply(page, MAX_TICKET_ID, "Into the void.");

    expect(res.status()).toBe(404);
    expect((await res.json()).error).toBe("Ticket not found");
  });

  test("-> 400 for a malformed ticket id", async ({ page }) => {
    await signIn(page, "agent");

    for (const value of ["abc", "0", "-1", String(MAX_TICKET_ID + 1)]) {
      const res = await reply(page, value, "Bad address.");
      expect(res.status(), `id=${value}`).toBe(400);
      expect((await res.json()).error, `id=${value}`).toBe("Invalid ticket id");
    }
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

  test("agent can reach /tickets from the sidebar link", async ({ page }) => {
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
    await filterControl(page, "Status").waitFor();

    // Still asserted because scrollbars and the search field's native clear
    // button are drawn by the browser even though the dropdown no longer is.
    const scheme = await page.evaluate(
      () => getComputedStyle(document.documentElement).colorScheme,
    );
    expect(scheme).toBe("dark");

    await filterControl(page, "Status").click();
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
      const trigger = filterControl(page, label);
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

  test("keeps column widths identical across pages", async ({ page }) => {
    // Page 1 holds "Ticket 30".."Ticket 06", page 2 the rest. Auto table layout
    // would size Subject to whatever text is on screen; fixed widths must not.
    await seedNumberedTickets(30);
    await testDb.ticket.create({
      data: {
        subject: "A dramatically longer subject line that would stretch a column",
        customerEmail: "long@example.com",
        customerName: "A Very Long Customer Name Indeed",
        createdAt: new Date(Date.UTC(2024, 0, 1, 12)),
        lastMessageAt: new Date(Date.UTC(2024, 0, 1, 12)),
      },
    });
    await signIn(page, "agent");
    await page.goto("/tickets");

    const widths = () =>
      page
        .getByRole("columnheader")
        .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));

    await expect(page.getByRole("row").nth(1)).toContainText("Ticket 30");
    const first = await widths();

    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page.getByRole("row").nth(1)).toContainText("Ticket 05");

    expect(await widths()).toEqual(first);
  });

  test("stretches the columns to fill the frame", async ({ page }) => {
    await seedNumberedTickets(5);
    await signIn(page, "agent");
    await page.goto("/tickets");
    await page.getByRole("columnheader", { name: "Subject" }).waitFor();

    const { table, frame } = await page.evaluate(() => {
      const t = document.querySelector("table") as HTMLTableElement;
      return {
        table: t.getBoundingClientRect().width,
        frame: (t.parentElement as HTMLElement).clientWidth,
      };
    });

    // No dead strip on the right: the columns own the whole frame.
    expect(table).toBeCloseTo(frame, 0);
  });

  test("badges are distinct and legible", async ({ page }) => {
    await testDb.ticket.createMany({
      data: [
        { subject: "S-Open", status: TICKET_STATUS.Open, category: TICKET_CATEGORY.General },
        { subject: "S-Resolved", status: TICKET_STATUS.Resolved, category: TICKET_CATEGORY.Technical },
        { subject: "S-Closed", status: TICKET_STATUS.Closed, category: TICKET_CATEGORY.Refund },
        { subject: "S-Other", status: TICKET_STATUS.Open, category: TICKET_CATEGORY.Other },
      ].map((t, i) => ({
        ...t,
        customerEmail: `badge${i}@example.com`,
        customerName: `Badge Customer ${i}`,
        createdAt: new Date(Date.UTC(2025, 5, i + 1, 12)),
        lastMessageAt: new Date(Date.UTC(2025, 5, i + 1, 12)),
      })),
    });
    await signIn(page, "agent");
    await page.goto("/tickets");
    await expect(page.getByRole("table")).toBeVisible();

    // One theme, and it is dark — see the note at the top of index.css. This
    // used to loop over dark and light and click a theme toggle; both the
    // toggle and the light palette are gone, so the loop was removed rather
    // than left failing. The contrast and hue checks below are unchanged.
    const readings = await page.evaluate(() => {
      // The theme is authored in oklch and Chrome reports computed colours
      // in oklch too, so a naive rgb() parse reads chroma/hue as channels.
      // Canvas fillStyle normalises any CSS colour to sRGB hex/rgba.
      // Reading `fillStyle` back is not enough — Chrome echoes oklch()
      // unchanged. Actually painting the colour forces it through the
      // canvas's sRGB pipeline, and getImageData returns real bytes.
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d", {
        willReadFrequently: true,
      }) as CanvasRenderingContext2D;
      const parse = (color: string): number[] => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        return [d[0], d[1], d[2], d[3] / 255];
      };
      const over = (fg: number[], bg: number[]) => {
        const a = fg[3] ?? 1;
        return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a));
      };
      const lum = (c: number[]) =>
        0.2126 * chan(c[0]) + 0.7152 * chan(c[1]) + 0.0722 * chan(c[2]);
      function chan(v: number) {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      }
      const page$ = parse(getComputedStyle(document.body).backgroundColor);

      const badges = Array.from(
        document.querySelectorAll('[data-slot="badge"]'),
      );
      return badges.map((el) => {
        const cs = getComputedStyle(el);
        // Tints are translucent, so composite them over the page colour
        // before judging whether the label on top is readable.
        const bg = over(parse(cs.backgroundColor), page$);
        const fg = over(parse(cs.color), bg);
        const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
        return {
          label: el.textContent ?? "",
          look: cs.color + "|" + cs.backgroundColor,
          contrast: (hi + 0.05) / (lo + 0.05),
        };
      });
    });

    expect(readings.length).toBeGreaterThanOrEqual(8);
    for (const r of readings) {
      // WCAG AA for small text — these badges are text-xs.
      expect(r.contrast, `${r.label} (${r.contrast.toFixed(2)}:1)`).toBeGreaterThanOrEqual(4.5);
    }

    const categories = readings.filter((r) =>
      ["General", "Technical", "Refund", "Other"].includes(r.label.trim()),
    );
    const distinct = new Set(categories.map((r) => r.look));
    expect(distinct.size, "category hues").toBe(categories.length);
  });

  test("shows a resize divider at rest and the right cursors", async ({
    page,
  }) => {
    await seedNumberedTickets(5);
    await signIn(page, "agent");
    await page.goto("/tickets");

    const cursorOf = (locator: ReturnType<typeof page.locator>) =>
      locator.evaluate((el) => getComputedStyle(el).cursor);

    // Clickable things say so.
    expect(await cursorOf(page.getByRole("button", { name: "Subject" }))).toBe(
      "pointer",
    );
    expect(await cursorOf(filterControl(page, "Status"))).toBe("pointer");

    const handle = resizeHandleFor(page, "Subject");
    expect(await cursorOf(handle)).toBe("col-resize");

    // The divider is painted before you hover it, not only on hover.
    const divider = handle.locator("span");
    const background = await divider.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    expect(background).not.toBe("rgba(0, 0, 0, 0)");
    await expect(divider).toBeVisible();
  });

  test("drags a column wider, taking the space from the others", async ({
    page,
  }) => {
    await seedNumberedTickets(5);
    await signIn(page, "agent");
    await page.goto("/tickets");

    const before = await columnWidths(page);
    // Within the headroom COLUMN_META leaves between the default total and the
    // frame (~96px at this viewport). Drag further than that and the table
    // legitimately stops redistributing and starts scrolling sideways instead,
    // which is a different behaviour with its own test below.
    await dragHandle(page, "Subject", 60);
    const after = await columnWidths(page);

    expect(after.Subject).toBeGreaterThan(before.Subject);
    // The table stays full width, so widening one column narrows the rest
    // rather than adding to the total.
    const sum = (w: Record<string, number>) =>
      Object.values(w).reduce((a, b) => a + b, 0);
    expect(sum(after)).toBeCloseTo(sum(before), 0);
  });

  test("honours the minimum width when dragged far left", async ({ page }) => {
    await seedNumberedTickets(5);
    await signIn(page, "agent");
    await page.goto("/tickets");

    await dragHandle(page, "Subject", -600);

    // minSize is 160; without it the column would collapse to nothing.
    expect((await columnWidths(page)).Subject).toBeGreaterThanOrEqual(150);
  });

  test("double-clicking a handle restores the default width", async ({
    page,
  }) => {
    await seedNumberedTickets(5);
    await signIn(page, "agent");
    await page.goto("/tickets");

    const before = await columnWidths(page);
    await dragHandle(page, "Subject", 120);
    expect((await columnWidths(page)).Subject).toBeGreaterThan(before.Subject);

    await resizeHandleFor(page, "Subject").dblclick();
    await expect
      .poll(async () => (await columnWidths(page)).Subject)
      .toBeCloseTo(before.Subject, 0);
  });

  test("resizes from the keyboard", async ({ page }) => {
    await seedNumberedTickets(5);
    await signIn(page, "agent");
    await page.goto("/tickets");

    const before = await columnWidths(page);
    await resizeHandleFor(page, "Subject").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");

    await expect
      .poll(async () => (await columnWidths(page)).Subject)
      .toBeGreaterThan(before.Subject);
  });

  test("keeps a resized width when the page changes", async ({ page }) => {
    await seedNumberedTickets(30);
    await signIn(page, "agent");
    await page.goto("/tickets");

    await dragHandle(page, "Subject", 90);
    const resized = (await columnWidths(page)).Subject;

    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page.getByRole("row").nth(1)).toContainText("Ticket 05");

    expect((await columnWidths(page)).Subject).toBeCloseTo(resized, 0);
  });

  test("fits the viewport: the window never scrolls", async ({ page }) => {
    await seedNumberedTickets(30);
    await signIn(page, "agent");
    await page.goto("/tickets");
    await expect(page.getByText("1–25 of 30")).toBeVisible();

    const overflow = await page.evaluate(() => {
      const el = document.documentElement;
      return el.scrollHeight - el.clientHeight;
    });
    expect(overflow).toBeLessThanOrEqual(1);

    // The pagination controls must be reachable without scrolling the page.
    await expect(page.getByRole("button", { name: "Next page" })).toBeInViewport();
  });

  test("keeps the header visible while the rows scroll", async ({ page }) => {
    await seedNumberedTickets(30);
    await signIn(page, "agent");
    await page.goto("/tickets");

    const header = page.getByRole("columnheader", { name: "Subject" });
    await expect(header).toBeVisible();
    const before = await header.boundingBox();
    if (!before) throw new Error("no header box");

    const scrolled = await page.evaluate(() => {
      const frame = document.querySelector("table")?.parentElement;
      if (!frame) return 0;
      frame.scrollTop = 400;
      return frame.scrollTop;
    });
    expect(scrolled).toBeGreaterThan(0);

    // The frame scrolled, not the window, and the sticky header held its place.
    await expect(header).toBeInViewport();
    const after = await header.boundingBox();
    expect(after?.y).toBeCloseTo(before.y, 0);
  });

  /**
   * The sibling above scrolls the frame by assignment, which proves the sticky
   * header but says nothing about whether anyone *without a mouse* can cause
   * that scroll. That was the whole of #111: the frame was `overflow-auto` and
   * unfocusable, so the rows below the fold had no keyboard path at all. jsdom
   * reports every scroll dimension as 0, so this is the only place the claim
   * can be held.
   */
  test("scrolls the rows from the keyboard, header still held", async ({ page }) => {
    await seedNumberedTickets(30);
    await signIn(page, "agent");
    await page.goto("/tickets");

    const header = page.getByRole("columnheader", { name: "Subject" });
    await expect(header).toBeVisible();
    const before = await header.boundingBox();
    if (!before) throw new Error("no header box");

    // Named, so it is a landmark rather than an anonymous tab stop.
    const frame = page.getByRole("region", { name: "Tickets" });
    await frame.focus();
    await expect(frame).toBeFocused();

    await page.keyboard.press("PageDown");

    expect(await frame.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    await expect(header).toBeInViewport();
    const after = await header.boundingBox();
    expect(after?.y).toBeCloseTo(before.y, 0);
  });

  test("moves the aria-sort marker to the clicked column", async ({ page }) => {
    await seedTickets();
    await signIn(page, "agent");
    await page.goto("/tickets");

    // The default sort is `lastMessageAt` desc, whose column is labelled
    // "Activity" — not `createdAt`. See DEFAULT_TICKET_SORT in @ticket/shared
    // for why: a customer replying to an old ticket has to reach the top, and
    // sorting by creation left it buried under three weeks of newer arrivals.
    const activity = page.getByRole("columnheader", { name: "Activity" });
    const subject = page.getByRole("columnheader", { name: "Subject" });
    await expect(activity).toHaveAttribute("aria-sort", "descending");
    await expect(subject).toHaveAttribute("aria-sort", "none");

    await page.getByRole("button", { name: "Subject" }).click();

    await expect(subject).toHaveAttribute("aria-sort", "ascending");
    await expect(activity).toHaveAttribute("aria-sort", "none");
    await expect(page.getByRole("row").nth(1)).toContainText("Middle ticket");
  });
});

// ---------------------------------------------------------------------------
// UI — ticket detail
// ---------------------------------------------------------------------------

test.describe("Ticket detail page", () => {
  test.beforeEach(async () => {
    await resetTickets();
  });

  test("redirects to /login when unauthenticated", async ({ page }) => {
    const id = await seedTicketWithThread();

    await page.goto(`/tickets/${id}`);
    await expect(page).toHaveURL("/login");
  });

  test("opens from the ticket list by clicking the subject", async ({
    page,
  }) => {
    const id = await seedTicketWithThread({ subject: "Clickable subject" });
    await signIn(page, "agent");
    await page.goto("/tickets");

    await page.getByRole("link", { name: "Clickable subject" }).click();

    await expect(page).toHaveURL(`/tickets/${id}`);
    await expect(
      page.getByRole("heading", { name: "Clickable subject", level: 1 }),
    ).toBeVisible();
    await expect(page.getByText("Threaded Customer").first()).toBeVisible();
    // Scoped to the field. Bare `getByText("Unassigned")` is ambiguous — the
    // sidebar's saved-view links carry the same word — and an ambiguous locator
    // is a strict-mode failure, not a soft one.
    await expect(
      page.getByRole("combobox", { name: "Assigned to" }),
    ).toContainText("Unassigned");
  });

  test("renders the whole thread oldest first", async ({ page }) => {
    const id = await seedTicketWithThread();
    await signIn(page, "agent");
    await page.goto(`/tickets/${id}`);

    await expect(page.getByText("Messages (3)")).toBeVisible();
    const messages = threadMessages(page);
    await expect(messages).toHaveCount(3);
    await expect(messages.nth(0)).toContainText(
      "First message, from the customer.",
    );
    await expect(messages.nth(1)).toContainText("Second message, from support.");
    await expect(messages.nth(1)).toContainText("From support");
    await expect(messages.nth(2)).toContainText(
      "Third message, from the customer.",
    );
  });

  test("an agent replies and the message joins the thread", async ({ page }) => {
    const id = await seedTicketWithThread();
    await signIn(page, "agent");
    await page.goto(`/tickets/${id}`);

    const box = page.getByRole("textbox", { name: "Reply" });
    await box.fill("Thanks for the details — that is fixed now.");
    await page.getByRole("button", { name: "Send reply" }).click();

    await expect(page.getByText("Messages (4)")).toBeVisible();
    const messages = threadMessages(page);
    await expect(messages).toHaveCount(4);
    await expect(messages.nth(3)).toContainText(
      "Thanks for the details — that is fixed now.",
    );
    await expect(messages.nth(3)).toContainText("From support");
    // Cleared on success, so the next reply starts from a blank box.
    await expect(box).toHaveValue("");
  });

  test("a rejected reply keeps the draft in the box", async ({ page }) => {
    const id = await seedTicketWithThread();
    await signIn(page, "agent");
    await page.goto(`/tickets/${id}`);
    // The thread is on screen; the ticket is gone by the time Send is pressed.
    // Longer than the default 5000ms: under a full-suite run this page's first
    // render can be slow enough to trip the default, which reads as a reply-path
    // regression when it is really just a late paint (see #34).
    await expect(page.getByText("Messages (3)")).toBeVisible({
      timeout: 15_000,
    });
    await testDb.ticket.delete({ where: { id } });

    const box = page.getByRole("textbox", { name: "Reply" });
    await box.fill("Worth not losing.");
    await page.getByRole("button", { name: "Send reply" }).click();

    await expect(page.getByRole("alert")).toContainText("Ticket not found");
    await expect(box).toHaveValue("Worth not losing.");
  });

  test("refuses to send an empty reply", async ({ page }) => {
    const id = await seedTicketWithThread();
    await signIn(page, "agent");
    await page.goto(`/tickets/${id}`);

    // An empty box disables Send, so the click never happens; the keyboard
    // gesture is the way left in, and validation catches it there.
    await expect(
      page.getByRole("button", { name: "Send reply" }),
    ).toBeDisabled();
    const box = page.getByRole("textbox", { name: "Reply" });
    await box.click();
    await page.keyboard.press("Control+Enter");

    await expect(page.getByRole("alert")).toContainText(
      "Write a reply before sending",
    );
    await expect(page.getByText("Messages (3)")).toBeVisible();
  });

  test("works as a deep link, without the list state", async ({ page }) => {
    const id = await seedTicketWithThread({ subject: "Deep linked" });
    await signIn(page, "agent");

    await page.goto(`/tickets/${id}`);

    await expect(
      page.getByRole("heading", { name: "Deep linked", level: 1 }),
    ).toBeVisible();
    // No list state to return to, so the back link falls back to a bare list.
    await expect(page.getByRole("link", { name: "Back to tickets" })).toHaveAttribute(
      "href",
      "/tickets",
    );
  });

  test("explains an unknown ticket instead of rendering a blank page", async ({
    page,
  }) => {
    await signIn(page, "agent");

    await page.goto(`/tickets/${MAX_TICKET_ID}`);

    await expect(
      page.getByRole("heading", { name: "Ticket not found", level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to tickets" })).toBeVisible();
  });

  test("never renders a message's inbound HTML", async ({ page }) => {
    const id = await seedTicketWithThread({
      htmlBody: '<img src="x" onerror="window.__xss = true">',
    });
    await signIn(page, "agent");
    await page.goto(`/tickets/${id}`);

    await expect(page.getByText("Second message, from support.")).toBeVisible();
    // The plain-text part renders; the attacker-supplied markup does not exist
    // in the document at all, because the API never sent it.
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    expect(await page.evaluate(() => "__xss" in window)).toBe(false);
  });

  test("back returns to the same filtered, sorted, paged list", async ({
    page,
  }) => {
    await seedNumberedTickets(30);
    await signIn(page, "agent");
    await page.goto("/tickets");

    // Build a view that is not the default in three ways at once.
    // `New`, because that is what `seedNumberedTickets` actually produces: it
    // sets no status, so the rows take the schema default, and that default
    // became `New` when the auto-reply pipeline landed.
    //
    // Filtering on `Open` matched none of the thirty, which swapped the entire
    // table — column headers included — for the empty state. The sort click
    // below then had no "Subject" button to hit, and this test only passed by
    // racing that render: the click landed on the outgoing header and sorted
    // against the pre-filter URL, which silently dropped `status` and left all
    // thirty tickets on screen in subject order. Green for the wrong reason,
    // and it went red the moment CI was slow enough to lose the race the other
    // way. Filtered properly, sorting keeps the filter: the URL below is
    // `?status=New&sort=subject&order=asc`.
    await chooseFilter(page, "Status", TICKET_STATUS.New);
    await page.getByRole("button", { name: "Subject" }).click();
    await expect(page.getByRole("row").nth(1)).toContainText("Ticket 01");
    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page.getByText("Page 2 of 2")).toBeVisible();

    const listUrl = page.url();
    const firstRowSubject = await page.getByRole("row").nth(1).textContent();

    await page.getByRole("row").nth(1).getByRole("link").click();
    await expect(
      page.getByRole("heading", { level: 1 }).first(),
    ).toBeVisible();

    await page.goBack();

    await expect(page).toHaveURL(listUrl);
    await expect(page.getByText("Page 2 of 2")).toBeVisible();
    await expect(page.getByRole("row").nth(1)).toHaveText(
      firstRowSubject ?? "",
    );
  });

  test("the back link returns to the same list view", async ({ page }) => {
    await seedNumberedTickets(30);
    await signIn(page, "agent");
    await page.goto("/tickets");

    // `New`, for the reason spelled out in the test above: these thirty take the
    // schema default, and filtering them on `Open` leaves the list empty and the
    // pager gone. This one was green in CI, but only by winning the same race —
    // it clicks Next before the empty state has replaced the table.
    await chooseFilter(page, "Status", TICKET_STATUS.New);
    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page.getByText("Page 2 of 2")).toBeVisible();
    const listUrl = page.url();

    await page.getByRole("row").nth(1).getByRole("link").click();
    await page.getByRole("link", { name: "Back to tickets" }).click();

    await expect(page).toHaveURL(listUrl);
    await expect(page.getByText("Page 2 of 2")).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// UI — assignment
// ---------------------------------------------------------------------------

test.describe("Ticket assignment (detail page)", () => {
  test.beforeAll(async () => {
    await seedAssignableUsers();
  });

  test.afterAll(async () => {
    await resetE2eUsers();
  });

  test.beforeEach(async () => {
    await resetTickets();
  });

  const picker = (page: Page) =>
    page.getByRole("combobox", { name: "Assigned to" });

  test("assigns a ticket, and it stays assigned", async ({ page }) => {
    const id = await seedTicketWithThread();
    await signIn(page, "agent");
    await page.goto(`/tickets/${id}`);

    await expect(picker(page)).toContainText("Unassigned");
    await expect(picker(page)).toBeEnabled();

    await picker(page).click();
    await page.getByRole("option", { name: ZOE.name, exact: true }).click();

    await expect(picker(page)).toContainText(ZOE.name);
    await expect(page.getByText(ZOE.email)).toBeVisible();

    // Not just on screen: reloading asks the API again.
    await page.reload();
    await expect(picker(page)).toContainText(ZOE.name);
  });

  test("hands the ticket back to nobody", async ({ page }) => {
    const id = await seedTicketWithThread({ assignedToId: ZOE.id });
    await signIn(page, "agent");
    await page.goto(`/tickets/${id}`);

    await expect(picker(page)).toContainText(ZOE.name);

    await picker(page).click();
    await page.getByRole("option", { name: "Unassigned", exact: true }).click();

    await expect(picker(page)).toContainText("Unassigned");
    await page.reload();
    await expect(picker(page)).toContainText("Unassigned");
  });

  test("offers every active user, whatever their role", async ({ page }) => {
    const id = await seedTicketWithThread();
    await signIn(page, "agent");
    await page.goto(`/tickets/${id}`);

    await expect(picker(page)).toBeEnabled();
    await picker(page).click();

    const options = page.getByRole("option");
    await expect(options.filter({ hasText: ZOE.name })).toHaveCount(1);
    await expect(options.filter({ hasText: YURI.name })).toHaveCount(1);
    await expect(options.filter({ hasText: EXTRA_ADMIN.name })).toHaveCount(1);
    await expect(options.filter({ hasText: DELETED_USER.name })).toHaveCount(0);
  });

  test("is reachable by keyboard, with the field's own label", async ({
    page,
  }) => {
    const id = await seedTicketWithThread();
    await signIn(page, "agent");
    await page.goto(`/tickets/${id}`);
    await expect(picker(page)).toBeEnabled();

    // Clicking the term in the definition list opens the control beside it,
    // which is only true if the <dt> is a real label for it.
    await page.getByText("Assigned to", { exact: true }).click();
    await expect(
      page.getByRole("option", { name: ZOE.name, exact: true }),
    ).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(picker(page)).toBeFocused();
  });
});

// ---------------------------------------------------------------------------
// UI — shareable list URLs
// ---------------------------------------------------------------------------

test.describe("Tickets list URL state", () => {
  test.beforeEach(async () => {
    await resetTickets();
  });

  test("restores filters and sort from a shared link", async ({ page }) => {
    await seedTickets();
    await signIn(page, "agent");

    await page.goto(
      `/tickets?status=${TICKET_STATUS.Resolved}&sort=${TICKET_SORT_FIELD.subject}&order=${SORT_ORDER.asc}`,
    );

    await expect(page.getByRole("row")).toHaveCount(2); // header + 1
    await expect(page.getByRole("row").nth(1)).toContainText("Middle ticket");
    await expect(filterControl(page, "Status")).toContainText(
      TICKET_STATUS.Resolved,
    );
    await expect(
      page.getByRole("columnheader", { name: "Subject" }),
    ).toHaveAttribute("aria-sort", "ascending");
  });

  test("writes filters to the URL and drops the page when they change", async ({
    page,
  }) => {
    await seedNumberedTickets(30);
    await signIn(page, "agent");
    await page.goto("/tickets");

    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page).toHaveURL(/page=2/);

    await chooseFilter(page, "Status", TICKET_STATUS.Open);

    await expect(page).toHaveURL(new RegExp(`status=${TICKET_STATUS.Open}`));
    // Page 2 of the old result set means nothing in the new one.
    await expect(page).not.toHaveURL(/page=/);
  });

  test("leaves the URL clean when nothing has been chosen", async ({ page }) => {
    await seedTickets();
    await signIn(page, "agent");
    await page.goto("/tickets");

    await expect(page.getByRole("row").nth(1)).toContainText("Newest ticket");
    // Defaults are never written back, so the resting URL stays bare.
    await expect(page).toHaveURL("/tickets");
  });
});
