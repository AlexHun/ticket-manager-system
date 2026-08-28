import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  ACTIVITY_ENTITY_TYPE,
  DEFAULT_PAGE_SIZE,
  FIRST_PAGE,
  USER_ROLE,
  type ActivityEntry,
  type ActivityFeedResponse,
  type User,
} from "@ticket/shared";
import { renderWithQuery } from "@/test/render";
import { ActivityPage } from "./ActivityPage";

// --- Mocks ----------------------------------------------------------------

const mockGet = vi.fn();
// Answers the `<Tutorial>` mounted on this page — not what any test here
// exercises, so it always resolves to "nothing to show" and never touches
// `mockGet`'s own call count or `mockResolvedValueOnce` queue.
const mockTutorialGet = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    get: (url: string, ...rest: unknown[]) =>
      url.startsWith("/api/tutorials/")
        ? mockTutorialGet(url, ...rest)
        : mockGet(url, ...rest),
  },
}));

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({
    data: { user: { name: "Aaron Admin", role: USER_ROLE.admin } },
    isPending: false,
  }),
  authClient: { signOut: vi.fn() },
}));

// --- Fixtures ---------------------------------------------------------------

function makeEntry(overrides: Partial<ActivityEntry> & Pick<ActivityEntry, "id">): ActivityEntry {
  return {
    entityType: ACTIVITY_ENTITY_TYPE.ticket,
    entityId: "42",
    action: "status_changed",
    actorId: "user-1",
    actorName: "Priya Raman",
    fromValue: "Open",
    toValue: "Resolved",
    createdAt: "2026-08-17T22:26:31.000Z",
    ...overrides,
  };
}

function activityResponse(
  entries: ActivityEntry[],
  overrides: Partial<ActivityFeedResponse> = {},
): { data: ActivityFeedResponse } {
  return {
    data: {
      entries,
      total: entries.length,
      page: FIRST_PAGE,
      pageSize: DEFAULT_PAGE_SIZE,
      ...overrides,
    },
  };
}

function makeUser(overrides: Partial<User> & Pick<User, "id" | "name">): User {
  return {
    email: `${overrides.id}@example.com`,
    role: USER_ROLE.agent,
    emailVerified: true,
    automated: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const ticketEntry = makeEntry({ id: "ticket_activity:1" });
const knowledgeEntry = makeEntry({
  id: "knowledge_revision:1",
  entityType: ACTIVITY_ENTITY_TYPE.knowledge,
  entityId: "KB-004",
  action: "updated",
  fromValue: null,
  toValue: null,
});
const automationEntry = makeEntry({
  id: "automation_revision:1",
  entityType: ACTIVITY_ENTITY_TYPE.automation,
  entityId: null,
  action: "handoff_changed",
  fromValue: "unassigned",
  toValue: "admin",
});

/** Routes `api.get` by URL, the way the real axios instance would dispatch. */
function mockApiRoutes({
  activity,
  users = [],
}: {
  activity: ReturnType<typeof activityResponse> | Promise<never>;
  users?: User[];
}) {
  mockGet.mockImplementation((url: string) => {
    if (url === "/api/activity") return activity;
    if (url === "/api/users") return Promise.resolve({ data: { users } });
    throw new Error(`Unexpected GET ${url}`);
  });
}

/** Only the calls to `/api/activity` — `/api/users` calls (the actor roster,
 *  fetched lazily on open) share the same mock and must not shift indices. */
function activityCalls() {
  return mockGet.mock.calls.filter(
    ([url]) => url === "/api/activity",
  ) as [string, { params: Record<string, unknown> }][];
}

/** `page`/`pageSize` are always sent, so `params` is never actually absent. */
function activityParamsOfCall(index: number): Record<string, unknown> {
  return activityCalls()[index][1].params;
}

function activityCallCount(): number {
  return activityCalls().length;
}

// --- Tests ------------------------------------------------------------------

beforeEach(() => {
  mockGet.mockReset();
  mockTutorialGet.mockReset();
  mockTutorialGet.mockResolvedValue({
    data: { tutorial: { content: { steps: [] }, shouldShow: false } },
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("ActivityPage", () => {
  test("renders the skeleton while the request is pending", () => {
    mockApiRoutes({ activity: new Promise(() => {}) });
    renderWithQuery(<ActivityPage />);

    const skeleton = screen.getByLabelText("Loading activity");
    expect(skeleton).toBeInTheDocument();
    expect(skeleton).toHaveAttribute("aria-busy", "true");
  });

  test("calls GET /api/activity with a cancellation signal on mount", async () => {
    mockApiRoutes({ activity: activityResponse([ticketEntry]) });
    renderWithQuery(<ActivityPage />);

    await screen.findByText("Status changed");

    const [url, options] = mockGet.mock.calls.find(([u]) => u === "/api/activity") as [
      string,
      { signal: AbortSignal },
    ];
    expect(url).toBe("/api/activity");
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  test("requests the first page at the default size on mount", async () => {
    mockApiRoutes({ activity: activityResponse([ticketEntry]) });
    renderWithQuery(<ActivityPage />);

    await screen.findByText("Status changed");

    expect(activityParamsOfCall(0)).toEqual({
      page: FIRST_PAGE,
      pageSize: DEFAULT_PAGE_SIZE,
    });
  });

  test("renders the column headers", async () => {
    mockApiRoutes({ activity: activityResponse([ticketEntry]) });
    renderWithQuery(<ActivityPage />);

    await screen.findByText("Status changed");

    for (const header of ["When", "Actor", "Entity", "Action", "Change"]) {
      expect(screen.getByRole("columnheader", { name: header })).toBeInTheDocument();
    }
  });

  test("renders the actor name, action label and change", async () => {
    mockApiRoutes({ activity: activityResponse([ticketEntry]) });
    renderWithQuery(<ActivityPage />);

    await screen.findByText("Status changed");
    expect(screen.getByText("Priya Raman")).toBeInTheDocument();
    expect(screen.getByText("Open → Resolved")).toBeInTheDocument();
  });

  test("renders a dash when an entry has no from/to value", async () => {
    mockApiRoutes({ activity: activityResponse([knowledgeEntry]) });
    renderWithQuery(<ActivityPage />);

    const row = (await screen.findByText("Edited")).closest("tr");
    if (!row) throw new Error("row not found");
    expect(within(row).getByText("—")).toBeInTheDocument();
  });

  test("links a ticket entry to its detail page", async () => {
    mockApiRoutes({ activity: activityResponse([ticketEntry]) });
    renderWithQuery(<ActivityPage />);

    expect(await screen.findByRole("link", { name: "Ticket #42" })).toHaveAttribute(
      "href",
      "/tickets/42",
    );
  });

  test("links a knowledge entry to the knowledge base", async () => {
    mockApiRoutes({ activity: activityResponse([knowledgeEntry]) });
    renderWithQuery(<ActivityPage />);

    expect(
      await screen.findByRole("link", { name: "Knowledge KB-004" }),
    ).toHaveAttribute("href", "/knowledge");
  });

  test("renders an automation entry with no link", async () => {
    mockApiRoutes({ activity: activityResponse([automationEntry]) });
    renderWithQuery(<ActivityPage />);

    await screen.findByText("Handoff changed");
    expect(screen.getByText("Automation")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Automation/ })).not.toBeInTheDocument();
  });

  test("renders an empty-state message when nothing is returned", async () => {
    mockApiRoutes({ activity: activityResponse([]) });
    renderWithQuery(<ActivityPage />);

    expect(await screen.findByText("Nothing recorded yet.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  test("renders an alert when the request fails", async () => {
    mockApiRoutes({ activity: Promise.reject(new Error("boom")) });
    renderWithQuery(<ActivityPage />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("boom");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("ActivityPage filtering", () => {
  const allEntries = [ticketEntry, knowledgeEntry];

  async function renderLoaded() {
    mockApiRoutes({
      activity: activityResponse(allEntries),
      users: [makeUser({ id: "user-1", name: "Priya Raman" })],
    });
    const user = userEvent.setup();
    renderWithQuery(<ActivityPage />);
    await screen.findByText("Status changed");
    return user;
  }

  test("sends no filter params until a filter is set", async () => {
    await renderLoaded();

    expect(activityParamsOfCall(0)).not.toHaveProperty("entityType");
    expect(activityParamsOfCall(0)).not.toHaveProperty("actorId");
    expect(activityParamsOfCall(0)).not.toHaveProperty("from");
    expect(activityParamsOfCall(0)).not.toHaveProperty("to");
  });

  test("filters by entity type", async () => {
    const user = await renderLoaded();

    await user.click(screen.getByRole("combobox", { name: "Entity" }));
    await user.click(await screen.findByRole("option", { name: "Knowledge" }));

    await waitFor(() => expect(activityCallCount()).toBe(2));
    expect(activityParamsOfCall(1)).toMatchObject({
      entityType: ACTIVITY_ENTITY_TYPE.knowledge,
    });
  });

  test("fetches the roster and filters by actor once the dropdown opens", async () => {
    const user = await renderLoaded();

    await user.click(screen.getByRole("combobox", { name: "Actor" }));
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/api/users", expect.anything()));

    await user.click(await screen.findByRole("option", { name: "Priya Raman" }));

    await waitFor(() => expect(activityCallCount()).toBe(2));
    expect(activityParamsOfCall(1)).toMatchObject({ actorId: "user-1" });
  });

  test("labels the automated assistant distinctly in the actor list", async () => {
    mockApiRoutes({
      activity: activityResponse(allEntries),
      users: [makeUser({ id: "assistant-1", name: "AI Assistant", automated: true })],
    });
    const user = userEvent.setup();
    renderWithQuery(<ActivityPage />);
    await screen.findByText("Status changed");

    await user.click(screen.getByRole("combobox", { name: "Actor" }));
    expect(
      await screen.findByRole("option", { name: "AI Assistant (assistant)" }),
    ).toBeInTheDocument();
  });

  /** Opens the field's popover and clicks the given day-of-month in the
   *  currently displayed month — pinned by `vi.setSystemTime` in each test
   *  below so "today" (the Calendar's default month) always lands on the
   *  month the test means to pick from. */
  async function pickDate(
    user: ReturnType<typeof userEvent.setup>,
    fieldLabel: "From" | "To",
    dayOfMonth: string,
  ) {
    await user.click(screen.getByRole("button", { name: fieldLabel }));
    const popover = await screen.findByRole("dialog");
    await user.click(within(popover).getByText(dayOfMonth));
  }

  test("sends the date range with an exclusive upper bound", async () => {
    vi.setSystemTime(new Date(2026, 7, 15));
    const user = await renderLoaded();

    await pickDate(user, "From", "1");
    await waitFor(() => expect(activityCallCount()).toBe(2));

    await pickDate(user, "To", "24");
    await waitFor(() => expect(activityCallCount()).toBe(3));

    expect(activityParamsOfCall(2)).toMatchObject({
      from: "2026-08-01",
      // The field reads as the whole day of the 24th; the wire's `to` is
      // exclusive, so the day after is what is actually sent.
      to: "2026-08-25",
    });
  });

  test("shows an inline error and skips the request for an inverted range", async () => {
    vi.setSystemTime(new Date(2026, 7, 15));
    const user = await renderLoaded();

    await pickDate(user, "From", "24");
    await waitFor(() => expect(activityCallCount()).toBe(2));

    await pickDate(user, "To", "1");

    expect(
      await screen.findByText('"From" must be on or before "To".'),
    ).toBeInTheDocument();
    // No third request — the invalid range is caught before it reaches the API.
    expect(activityCallCount()).toBe(2);
  });

  test("clears every filter at once", async () => {
    const user = await renderLoaded();

    await user.click(screen.getByRole("combobox", { name: "Entity" }));
    await user.click(await screen.findByRole("option", { name: "Knowledge" }));
    await waitFor(() => expect(activityCallCount()).toBe(2));

    await user.click(screen.getByRole("button", { name: /clear filters/i }));

    await waitFor(() => expect(activityCallCount()).toBe(3));
    expect(activityParamsOfCall(2)).not.toHaveProperty("entityType");
  });

  test("explains an empty result differently when filters are active", async () => {
    const user = await renderLoaded();

    mockGet.mockImplementation((url: string) => {
      if (url === "/api/activity") return Promise.resolve(activityResponse([]));
      if (url === "/api/users") return Promise.resolve({ data: { users: [] } });
      throw new Error(`Unexpected GET ${url}`);
    });
    await user.click(screen.getByRole("combobox", { name: "Entity" }));
    await user.click(await screen.findByRole("option", { name: "Admin" }));

    expect(
      await screen.findByText("No activity matches these filters."),
    ).toBeInTheDocument();
  });

  test("resets to the first page when a filter changes", async () => {
    mockApiRoutes({
      activity: activityResponse(allEntries, { total: 60 }),
    });
    const user = userEvent.setup();
    renderWithQuery(<ActivityPage />);
    await screen.findByText("Status changed");

    mockApiRoutes({ activity: activityResponse(allEntries, { total: 60, page: 2 }) });
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(activityParamsOfCall(1).page).toBe(2));

    mockApiRoutes({ activity: activityResponse(allEntries, { total: 12 }) });
    await user.click(screen.getByRole("combobox", { name: "Entity" }));
    await user.click(await screen.findByRole("option", { name: "Ticket" }));

    await waitFor(() => expect(activityCallCount()).toBe(3));
    expect(activityParamsOfCall(2)).toMatchObject({ page: FIRST_PAGE });
  });
});

describe("ActivityPage pagination", () => {
  const allEntries = [ticketEntry, knowledgeEntry];

  function manyPages(overrides: Partial<ActivityFeedResponse> = {}) {
    return activityResponse(allEntries, { total: 231, ...overrides });
  }

  async function renderLoaded() {
    mockApiRoutes({ activity: manyPages() });
    const user = userEvent.setup();
    renderWithQuery(<ActivityPage />);
    await screen.findByText("Status changed");
    return user;
  }

  test("reports the visible range and page count", async () => {
    await renderLoaded();

    expect(screen.getByText("1–25 of 231")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 10")).toBeInTheDocument();
  });

  test("advances to the next page", async () => {
    const user = await renderLoaded();

    mockApiRoutes({ activity: manyPages({ page: 2 }) });
    await user.click(screen.getByRole("button", { name: "Next page" }));

    await waitFor(() => expect(activityParamsOfCall(1).page).toBe(2));
    expect(await screen.findByText("26–50 of 231")).toBeInTheDocument();
  });

  test("changing the page size returns to the first page", async () => {
    const user = await renderLoaded();

    mockApiRoutes({ activity: manyPages({ page: 2 }) });
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(activityParamsOfCall(1).page).toBe(2));

    mockApiRoutes({ activity: manyPages({ pageSize: 50 }) });
    await user.click(screen.getByRole("combobox", { name: "Per page" }));
    await user.click(await screen.findByRole("option", { name: "50" }));

    await waitFor(() => expect(activityCallCount()).toBe(3));
    expect(activityParamsOfCall(2)).toMatchObject({ pageSize: 50, page: FIRST_PAGE });
  });

  test("hides the pagination bar when nothing matches", async () => {
    mockApiRoutes({ activity: activityResponse([], { total: 0 }) });
    renderWithQuery(<ActivityPage />);

    await screen.findByText("Nothing recorded yet.");
    expect(
      screen.queryByRole("navigation", { name: "Pagination" }),
    ).not.toBeInTheDocument();
  });
});
