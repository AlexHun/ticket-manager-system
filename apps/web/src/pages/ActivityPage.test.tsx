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
import { apiStub } from "@/test/api-stub";
import { renderRoutes } from "@/test/render";
import { ActivityPage } from "./ActivityPage";

// --- Mocks ----------------------------------------------------------------

vi.mock("@/lib/api", () => import("@/test/api-stub"));

// The feed, and the actor roster the Actor dropdown fetches lazily on open.
// They have to be controllable separately, and their calls have to stay out of
// each other's indices — which the stub gives for free, one `vi.fn` per path.
// The `<Tutorial>` this page mounts is answered by the stub's own default.
const activityGet = apiStub.get("/api/activity");
const usersGet = apiStub.get("/api/users");

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

/** What the two endpoints this page reads answer with. */
function mockApiRoutes({
  activity,
  users = [],
}: {
  activity: ReturnType<typeof activityResponse> | Promise<never>;
  users?: User[];
}) {
  activityGet.mockReturnValue(activity);
  usersGet.mockResolvedValue({ data: { users } });
}

/** `page`/`pageSize` are always sent, so `params` is never actually absent. */
function activityParamsOfCall(index: number): Record<string, unknown> {
  const [, options] = activityGet.mock.calls[index] as [
    string,
    { params: Record<string, unknown> },
  ];
  return options.params;
}

function renderActivityPage() {
  return renderRoutes([{ path: "/activity", Component: ActivityPage }], {
    initialEntries: ["/activity"],
  });
}

// --- Tests ------------------------------------------------------------------

beforeEach(() => {
  apiStub.reset();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("ActivityPage", () => {
  test("renders the skeleton while the request is pending", () => {
    mockApiRoutes({ activity: new Promise(() => {}) });
    renderActivityPage();

    const skeleton = screen.getByLabelText("Loading activity");
    expect(skeleton).toBeInTheDocument();
    expect(skeleton).toHaveAttribute("aria-busy", "true");
  });

  // #111: the mechanism is covered in table-frame.test.tsx; this holds the name
  // this page gives it, which is the half that can drift per call site.
  test("puts the feed in a keyboard-reachable region named Activity", async () => {
    mockApiRoutes({ activity: activityResponse([ticketEntry]) });
    renderActivityPage();

    await screen.findByText("Status changed");
    const frame = screen.getByRole("region", { name: "Activity" });
    expect(frame).toHaveAttribute("tabindex", "0");
    expect(frame).toContainElement(screen.getByRole("table"));
  });

  test("calls GET /api/activity with a cancellation signal on mount", async () => {
    mockApiRoutes({ activity: activityResponse([ticketEntry]) });
    renderActivityPage();

    await screen.findByText("Status changed");

    const [url, options] = activityGet.mock.calls[0] as [
      string,
      { signal: AbortSignal },
    ];
    expect(url).toBe("/api/activity");
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  test("requests the first page at the default size on mount", async () => {
    mockApiRoutes({ activity: activityResponse([ticketEntry]) });
    renderActivityPage();

    await screen.findByText("Status changed");

    expect(activityParamsOfCall(0)).toEqual({
      page: FIRST_PAGE,
      pageSize: DEFAULT_PAGE_SIZE,
    });
  });

  test("renders the column headers", async () => {
    mockApiRoutes({ activity: activityResponse([ticketEntry]) });
    renderActivityPage();

    await screen.findByText("Status changed");

    for (const header of ["When", "Actor", "Entity", "Action", "Change"]) {
      expect(screen.getByRole("columnheader", { name: header })).toBeInTheDocument();
    }
  });

  test("renders the actor name, action label and change", async () => {
    mockApiRoutes({ activity: activityResponse([ticketEntry]) });
    renderActivityPage();

    await screen.findByText("Status changed");
    expect(screen.getByText("Priya Raman")).toBeInTheDocument();
    expect(screen.getByText("Open → Resolved")).toBeInTheDocument();
  });

  test("renders a dash when an entry has no from/to value", async () => {
    mockApiRoutes({ activity: activityResponse([knowledgeEntry]) });
    renderActivityPage();

    const row = (await screen.findByText("Edited")).closest("tr");
    if (!row) throw new Error("row not found");
    expect(within(row).getByText("—")).toBeInTheDocument();
  });

  test("links a ticket entry to its detail page", async () => {
    mockApiRoutes({ activity: activityResponse([ticketEntry]) });
    renderActivityPage();

    expect(await screen.findByRole("link", { name: "Ticket #42" })).toHaveAttribute(
      "href",
      "/tickets/42",
    );
  });

  test("links a knowledge entry to the knowledge base", async () => {
    mockApiRoutes({ activity: activityResponse([knowledgeEntry]) });
    renderActivityPage();

    expect(
      await screen.findByRole("link", { name: "Knowledge KB-004" }),
    ).toHaveAttribute("href", "/knowledge");
  });

  test("renders an automation entry with no link", async () => {
    mockApiRoutes({ activity: activityResponse([automationEntry]) });
    renderActivityPage();

    await screen.findByText("Handoff changed");
    expect(screen.getByText("Automation")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Automation/ })).not.toBeInTheDocument();
  });

  test("renders an empty-state message when nothing is returned", async () => {
    mockApiRoutes({ activity: activityResponse([]) });
    renderActivityPage();

    expect(await screen.findByText("Nothing recorded yet.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  test("renders an alert when the request fails", async () => {
    mockApiRoutes({ activity: Promise.reject(new Error("boom")) });
    renderActivityPage();

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
    renderActivityPage();
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

    await waitFor(() => expect(activityGet).toHaveBeenCalledTimes(2));
    expect(activityParamsOfCall(1)).toMatchObject({
      entityType: ACTIVITY_ENTITY_TYPE.knowledge,
    });
  });

  test("fetches the roster and filters by actor once the dropdown opens", async () => {
    const user = await renderLoaded();

    await user.click(screen.getByRole("combobox", { name: "Actor" }));
    await waitFor(() => expect(usersGet).toHaveBeenCalled());

    await user.click(await screen.findByRole("option", { name: "Priya Raman" }));

    await waitFor(() => expect(activityGet).toHaveBeenCalledTimes(2));
    expect(activityParamsOfCall(1)).toMatchObject({ actorId: "user-1" });
  });

  test("labels the automated assistant distinctly in the actor list", async () => {
    mockApiRoutes({
      activity: activityResponse(allEntries),
      users: [makeUser({ id: "assistant-1", name: "AI Assistant", automated: true })],
    });
    const user = userEvent.setup();
    renderActivityPage();
    await screen.findByText("Status changed");

    await user.click(screen.getByRole("combobox", { name: "Actor" }));
    expect(
      await screen.findByRole("option", { name: "AI Assistant (assistant)" }),
    ).toBeInTheDocument();
  });

  /** Opens the single date-range popover — pinned by `vi.setSystemTime` in
   *  each test below so "today" (the Calendar's default month, and the
   *  presets' anchor) always lands where the test means it to. */
  async function openDateRangePopover(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Date range" }));
    return screen.findByRole("dialog");
  }

  /** Scopes a day-number query to the first of the two displayed months —
   *  with both shown at once, a day number like "1" or "24" appears twice. */
  function withinFirstMonth(popover: HTMLElement) {
    return within(within(popover).getAllByRole("grid")[0]);
  }

  test("sends no request for a from-only, in-progress pick", async () => {
    vi.setSystemTime(new Date(2026, 7, 15));
    const user = await renderLoaded();

    const popover = await openDateRangePopover(user);
    await user.click(withinFirstMonth(popover).getByText("1"));

    // Regression for #97: a from-only click used to flow straight into
    // `ActivityPage`'s filters and refetch on the incomplete range.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(activityGet).toHaveBeenCalledTimes(1);
  });

  test("sends the date range with an exclusive upper bound", async () => {
    vi.setSystemTime(new Date(2026, 7, 15));
    const user = await renderLoaded();

    const popover = await openDateRangePopover(user);
    await user.click(withinFirstMonth(popover).getByText("1"));
    expect(activityGet).toHaveBeenCalledTimes(1);

    await user.click(withinFirstMonth(popover).getByText("24"));
    await waitFor(() => expect(activityGet).toHaveBeenCalledTimes(2));

    expect(activityParamsOfCall(1)).toMatchObject({
      from: "2026-08-01",
      // The field reads as the whole day of the 24th; the wire's `to` is
      // exclusive, so the day after is what is actually sent.
      to: "2026-08-25",
    });
  });

  test("normalizes an out-of-order pick instead of producing an invalid range", async () => {
    vi.setSystemTime(new Date(2026, 7, 15));
    const user = await renderLoaded();

    const popover = await openDateRangePopover(user);
    await user.click(withinFirstMonth(popover).getByText("24"));
    expect(activityGet).toHaveBeenCalledTimes(1);

    await user.click(withinFirstMonth(popover).getByText("1"));
    await waitFor(() => expect(activityGet).toHaveBeenCalledTimes(2));

    expect(activityParamsOfCall(1)).toMatchObject({
      from: "2026-08-01",
      to: "2026-08-25",
    });
  });

  test("starting a new pick after an existing range doesn't close after one click", async () => {
    vi.setSystemTime(new Date(2026, 7, 15));
    const user = await renderLoaded();

    const popover = await openDateRangePopover(user);
    await user.click(withinFirstMonth(popover).getByText("1"));
    await user.click(withinFirstMonth(popover).getByText("24"));
    await waitFor(() => expect(activityGet).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // Regression for #95: reopening with a full range already selected used
    // to let react-day-picker's default range logic extend that old range
    // from a single click, completing and closing the popover before a real
    // second click could land.
    const reopened = await openDateRangePopover(user);
    await user.click(withinFirstMonth(reopened).getByText("10"));
    expect(activityGet).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(withinFirstMonth(reopened).getByText("20"));
    await waitFor(() => expect(activityGet).toHaveBeenCalledTimes(3));
    expect(activityParamsOfCall(2)).toMatchObject({
      from: "2026-08-10",
      to: "2026-08-21",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("abandoning an in-progress pick by closing the popover doesn't commit it", async () => {
    vi.setSystemTime(new Date(2026, 7, 15));
    const user = await renderLoaded();

    const popover = await openDateRangePopover(user);
    await user.click(withinFirstMonth(popover).getByText("1"));
    expect(activityGet).toHaveBeenCalledTimes(1);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(activityGet).toHaveBeenCalledTimes(1);

    // The trigger still reads "Any date" — the abandoned from-only pick was
    // never committed to `ActivityPage`'s filters.
    expect(screen.getByRole("button", { name: "Date range" })).toHaveTextContent(
      "Any date",
    );
  });

  /** The rendered day button for a given day number in the first month —
   *  `getByText` finds the label span, `closest("button")` the element the
   *  range and preview modifiers (`data-range-*`) actually land on. */
  function dayButton(popover: HTMLElement, day: string): HTMLElement {
    const button = withinFirstMonth(popover).getByText(day).closest("button");
    if (!button) throw new Error(`no button for day ${day}`);
    return button;
  }

  test("previews the range between the anchor and a hovered later date", async () => {
    vi.setSystemTime(new Date(2026, 7, 15));
    const user = await renderLoaded();

    const popover = await openDateRangePopover(user);
    await user.click(withinFirstMonth(popover).getByText("1"));
    expect(activityGet).toHaveBeenCalledTimes(1);

    await user.hover(dayButton(popover, "10"));

    // The anchor itself is a plain from-only pick, not a `range_start` —
    // react-day-picker only marks that once a range has both ends.
    expect(dayButton(popover, "1")).toHaveAttribute("data-selected-single", "true");
    expect(dayButton(popover, "5")).toHaveAttribute("data-range-preview-middle", "true");
    expect(dayButton(popover, "10")).toHaveAttribute("data-range-preview-end", "true");
    // Cosmetic only — the hovered day never reaches `ActivityPage`'s filters.
    expect(activityGet).toHaveBeenCalledTimes(1);
  });

  test("previews the range for a hover that lands before the anchor", async () => {
    vi.setSystemTime(new Date(2026, 7, 15));
    const user = await renderLoaded();

    const popover = await openDateRangePopover(user);
    await user.click(withinFirstMonth(popover).getByText("24"));

    await user.hover(dayButton(popover, "10"));

    expect(dayButton(popover, "10")).toHaveAttribute("data-range-preview-end", "true");
    expect(dayButton(popover, "15")).toHaveAttribute("data-range-preview-middle", "true");
    expect(dayButton(popover, "24")).toHaveAttribute("data-selected-single", "true");
  });

  test("drops the preview once the pointer leaves the calendar", async () => {
    vi.setSystemTime(new Date(2026, 7, 15));
    const user = await renderLoaded();

    const popover = await openDateRangePopover(user);
    await user.click(withinFirstMonth(popover).getByText("1"));
    await user.hover(dayButton(popover, "10"));
    expect(dayButton(popover, "5")).toHaveAttribute("data-range-preview-middle", "true");

    await user.unhover(dayButton(popover, "10"));

    // No `modifiers` prop at all once there's no pointer-driven preview, so
    // the attribute is absent rather than `"false"`.
    expect(dayButton(popover, "5")).not.toHaveAttribute("data-range-preview-middle");
    expect(dayButton(popover, "1")).toHaveAttribute("data-selected-single", "true");
  });

  test("applies a preset range and closes the popover", async () => {
    vi.setSystemTime(new Date(2026, 7, 15, 12));
    const user = await renderLoaded();

    const popover = await openDateRangePopover(user);
    await user.click(within(popover).getByRole("button", { name: "Today" }));

    await waitFor(() => expect(activityGet).toHaveBeenCalledTimes(2));
    expect(activityParamsOfCall(1)).toMatchObject({
      from: "2026-08-15",
      to: "2026-08-16",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("clears the date range via the All time preset", async () => {
    vi.setSystemTime(new Date(2026, 7, 15));
    const user = await renderLoaded();

    // Commit a real range first — clearing an in-progress, never-committed
    // pick back to empty is a no-op for `ActivityPage`'s filters and
    // wouldn't exercise the clear at all.
    const popover = await openDateRangePopover(user);
    await user.click(within(popover).getByRole("button", { name: "Today" }));
    await waitFor(() => expect(activityGet).toHaveBeenCalledTimes(2));

    const reopened = await openDateRangePopover(user);
    // A single click leaves the range incomplete (`min={1}` withholds `to`
    // until a second click, and an incomplete pick stays local rather than
    // firing a request), so the popover is still open here — no need to
    // reopen it before reaching for the preset.
    await user.click(withinFirstMonth(reopened).getByText("1"));
    expect(activityGet).toHaveBeenCalledTimes(2);

    await user.click(within(reopened).getByRole("button", { name: "All time" }));

    await waitFor(() => expect(activityGet).toHaveBeenCalledTimes(3));
    expect(activityParamsOfCall(2)).not.toHaveProperty("from");
    expect(activityParamsOfCall(2)).not.toHaveProperty("to");
  });

  test("clears every filter at once", async () => {
    const user = await renderLoaded();

    await user.click(screen.getByRole("combobox", { name: "Entity" }));
    await user.click(await screen.findByRole("option", { name: "Knowledge" }));
    await waitFor(() => expect(activityGet).toHaveBeenCalledTimes(2));

    await user.click(screen.getByRole("button", { name: /clear filters/i }));

    await waitFor(() => expect(activityGet).toHaveBeenCalledTimes(3));
    expect(activityParamsOfCall(2)).not.toHaveProperty("entityType");
  });

  test("explains an empty result differently when filters are active", async () => {
    const user = await renderLoaded();

    mockApiRoutes({ activity: activityResponse([]) });
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
    renderActivityPage();
    await screen.findByText("Status changed");

    mockApiRoutes({ activity: activityResponse(allEntries, { total: 60, page: 2 }) });
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(activityParamsOfCall(1).page).toBe(2));

    mockApiRoutes({ activity: activityResponse(allEntries, { total: 12 }) });
    await user.click(screen.getByRole("combobox", { name: "Entity" }));
    await user.click(await screen.findByRole("option", { name: "Ticket" }));

    await waitFor(() => expect(activityGet).toHaveBeenCalledTimes(3));
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
    renderActivityPage();
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

    await waitFor(() => expect(activityGet).toHaveBeenCalledTimes(3));
    expect(activityParamsOfCall(2)).toMatchObject({ pageSize: 50, page: FIRST_PAGE });
  });

  test("hides the pagination bar when nothing matches", async () => {
    mockApiRoutes({ activity: activityResponse([], { total: 0 }) });
    renderActivityPage();

    await screen.findByText("Nothing recorded yet.");
    expect(
      screen.queryByRole("navigation", { name: "Pagination" }),
    ).not.toBeInTheDocument();
  });
});
