import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  CATEGORY_NONE,
  DEFAULT_PAGE_SIZE,
  FIRST_PAGE,
  SORT_ORDER,
  TICKET_CATEGORY,
  TICKET_SORT_FIELD,
  TICKET_STATUS,
  USER_ROLE,
  type Ticket,
  type TicketsListResponse,
  type TicketWithAssignee,
} from "@ticket/shared";
import { renderWithQuery } from "@/test/render";
import { TicketsPage } from "./TicketsPage";

// --- Mocks ----------------------------------------------------------------

const mockGet = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
  },
}));

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({
    data: { user: { name: "Aaron Agent", role: USER_ROLE.agent } },
    isPending: false,
  }),
  authClient: { signOut: vi.fn() },
}));

// --- Fixtures -------------------------------------------------------------

function makeTicket(
  overrides: Partial<TicketWithAssignee> & Pick<Ticket, "id">,
): TicketWithAssignee {
  return {
    subject: "Cannot log in",
    status: TICKET_STATUS.Open,
    category: null,
    customerEmail: "customer@example.com",
    customerName: "Casey Customer",
    assignedToId: null,
    // The list resolves assignees server-side, so the fixture carries the
    // resolved shape. Unassigned is the default because most seeded tickets are.
    assignedTo: null,
    lastMessageAt: "2025-05-01T12:00:00.000Z",
    createdAt: "2025-05-01T12:00:00.000Z",
    updatedAt: "2025-05-01T12:00:00.000Z",
    ...overrides,
  };
}

/** Mirrors the paginated API envelope so tests exercise the real shape. */
function ticketsResponse(
  tickets: TicketWithAssignee[],
  overrides: Partial<TicketsListResponse> = {},
): { data: TicketsListResponse } {
  return {
    data: {
      tickets,
      total: tickets.length,
      page: FIRST_PAGE,
      pageSize: DEFAULT_PAGE_SIZE,
      ...overrides,
    },
  };
}

/** Deliberately out of order — the page must render whatever order the API sends. */
const newestTicket = makeTicket({
  id: 3,
  subject: "Newest ticket",
  createdAt: "2025-05-03T12:00:00.000Z",
});
const middleTicket = makeTicket({
  id: 2,
  subject: "Middle ticket",
  status: TICKET_STATUS.Resolved,
  category: TICKET_CATEGORY.Technical,
  createdAt: "2025-05-02T12:00:00.000Z",
});
const oldestTicket = makeTicket({
  id: 1,
  subject: "Oldest ticket",
  status: TICKET_STATUS.Closed,
  category: TICKET_CATEGORY.Refund,
  customerName: "Robin Refund",
  customerEmail: "robin@example.com",
  createdAt: "2025-05-01T12:00:00.000Z",
});

function renderTicketsPage(entry = "/tickets") {
  return renderWithQuery(<TicketsPage />, { initialEntries: [entry] });
}

/** Exposes the router's current query string so a test can assert on it. */
function LocationProbe() {
  const { search } = useLocation();
  return <output data-testid="location-search">{search}</output>;
}

function renderTicketsPageWithLocation(entry = "/tickets") {
  return renderWithQuery(
    <>
      <TicketsPage />
      <LocationProbe />
    </>,
    { initialEntries: [entry] },
  );
}

function locationSearch(): string {
  return screen.getByTestId("location-search").textContent ?? "";
}

/** The current URL's params, order-insensitively. */
function urlParams(): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(locationSearch()));
}

function rowSubjects(): string[] {
  const [, ...bodyRows] = screen.getAllByRole("row");
  return bodyRows.map((row) => within(row).getAllByRole("cell")[0].textContent ?? "");
}

type TicketsRequestOptions = {
  params: {
    sort: string;
    order: string;
    page: number;
    pageSize: number;
    status?: string;
    category?: string;
    q?: string;
  };
  signal: AbortSignal;
};

/** Query params sent on the nth (0-indexed) GET /api/tickets call. */
function sortParamsOfCall(index: number) {
  const [, options] = mockGet.mock.calls[index] as [
    string,
    TicketsRequestOptions,
  ];
  return options.params;
}

function sortIndicator(columnName: string): string | null {
  return screen
    .getByRole("columnheader", { name: columnName })
    .getAttribute("aria-sort");
}

type User = ReturnType<typeof userEvent.setup>;

/**
 * The filters use the shadcn (Radix) Select, which is a combobox trigger plus a
 * portalled listbox — not a native <select>, so `selectOptions` doesn't apply.
 */
async function chooseOption(
  user: User,
  filterLabel: string,
  optionName: string,
): Promise<void> {
  await user.click(filterControl(filterLabel));
  await user.click(await screen.findByRole("option", { name: optionName }));
}

/**
 * By role, not by label: the column headers carry the same names as the
 * filters ("Status", "Category"), so getByLabelText matches both.
 */
function filterControl(filterLabel: string): HTMLElement {
  return screen.getByRole("combobox", { name: filterLabel });
}

function filterValue(filterLabel: string): string {
  return filterControl(filterLabel).textContent ?? "";
}

// --- Tests ----------------------------------------------------------------

beforeEach(() => {
  mockGet.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("TicketsPage subject link", () => {
  test("links each subject to that ticket's detail page", async () => {
    mockGet.mockResolvedValue(
      ticketsResponse([newestTicket, middleTicket, oldestTicket]),
    );
    renderTicketsPage();

    expect(
      await screen.findByRole("link", { name: "Newest ticket" }),
    ).toHaveAttribute("href", "/tickets/3");
    expect(screen.getByRole("link", { name: "Oldest ticket" })).toHaveAttribute(
      "href",
      "/tickets/1",
    );
  });

  test("keeps the subject truncating inside the fixed-width cell", async () => {
    mockGet.mockResolvedValue(ticketsResponse([newestTicket]));
    renderTicketsPage();

    const link = await screen.findByRole("link", { name: "Newest ticket" });
    // `block` is load-bearing — an inline <a> would never show the ellipsis.
    expect(link).toHaveClass("block", "truncate");
    // ...and what the ellipsis hides is recoverable on hover. That used to be a
    // native `title`; it is a shadcn Tooltip now, so the full subject lives in a
    // portalled `tooltip` role rather than an attribute.
    await userEvent.hover(link);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Newest ticket",
    );
  });

  test("does not turn the other cells into links", async () => {
    mockGet.mockResolvedValue(ticketsResponse([oldestTicket]));
    renderTicketsPage();

    await screen.findByRole("link", { name: "Oldest ticket" });
    expect(
      screen.queryByRole("link", { name: "Robin Refund" }),
    ).not.toBeInTheDocument();
  });
});

describe("TicketsPage", () => {
  // No heading test here any more: the <h1> moved to the shell's top bar, which
  // this page no longer renders. tickets.spec.ts covers it end to end.

  test("renders the skeleton table while the request is pending", () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    renderTicketsPage();

    const skeleton = screen.getByLabelText("Loading tickets");
    expect(skeleton).toBeInTheDocument();
    expect(skeleton).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("Newest ticket")).not.toBeInTheDocument();
  });

  test("calls GET /api/tickets with a cancellation signal", async () => {
    mockGet.mockResolvedValue(ticketsResponse([newestTicket]));
    renderTicketsPage();

    await screen.findByText("Newest ticket");

    expect(mockGet).toHaveBeenCalledTimes(1);
    const [url, options] = mockGet.mock.calls[0] as [
      string,
      TicketsRequestOptions,
    ];
    expect(url).toBe("/api/tickets");
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  test("requests the default newest-first sort on mount", async () => {
    mockGet.mockResolvedValue(ticketsResponse([newestTicket]));
    renderTicketsPage();

    await screen.findByText("Newest ticket");

    expect(sortParamsOfCall(0)).toEqual({
      sort: TICKET_SORT_FIELD.createdAt,
      order: SORT_ORDER.desc,
      page: FIRST_PAGE,
      pageSize: DEFAULT_PAGE_SIZE,
    });
  });

  test("renders a row per ticket once the query resolves", async () => {
    mockGet.mockResolvedValue(ticketsResponse([newestTicket, middleTicket, oldestTicket]));
    renderTicketsPage();

    expect(await screen.findByText("Newest ticket")).toBeInTheDocument();
    expect(screen.getByText("Middle ticket")).toBeInTheDocument();
    expect(screen.getByText("Oldest ticket")).toBeInTheDocument();

    expect(screen.queryByLabelText("Loading tickets")).not.toBeInTheDocument();
  });

  test("preserves the server's newest-first order", async () => {
    mockGet.mockResolvedValue(ticketsResponse([newestTicket, middleTicket, oldestTicket]));
    renderTicketsPage();

    await screen.findByText("Newest ticket");

    expect(rowSubjects()).toEqual([
      "Newest ticket",
      "Middle ticket",
      "Oldest ticket",
    ]);
  });

  test("renders the customer name and email in the same row", async () => {
    mockGet.mockResolvedValue(ticketsResponse([oldestTicket]));
    renderTicketsPage();

    const row = (await screen.findByText("Oldest ticket")).closest("tr");
    if (!row) throw new Error("row not found");

    expect(within(row).getByText("Robin Refund")).toBeInTheDocument();
    expect(within(row).getByText("robin@example.com")).toBeInTheDocument();
  });

  test("renders a distinct badge variant per status", async () => {
    mockGet.mockResolvedValue(ticketsResponse([newestTicket, middleTicket, oldestTicket]));
    renderTicketsPage();

    // Scoped to the table so the status filter can never shadow these.
    await screen.findByText("Newest ticket");
    const table = within(screen.getByRole("table"));
    const open = table.getByText(TICKET_STATUS.Open);
    const resolved = table.getByText(TICKET_STATUS.Resolved);
    const closed = table.getByText(TICKET_STATUS.Closed);

    // Open is the solid accent; Resolved a soft tint; Closed neutral.
    expect(open).toHaveAttribute("data-variant", "default");
    expect(resolved.className).toContain("bg-emerald-500/12");
    expect(closed.className).toContain("bg-muted");

    // Whatever the styling, the three must not collapse into one look.
    const looks = [open, resolved, closed].map((el) => el.className);
    expect(new Set(looks).size).toBe(3);
  });

  test("renders a dash when the ticket has no category", async () => {
    mockGet.mockResolvedValue(ticketsResponse([newestTicket]));
    renderTicketsPage();

    const row = (await screen.findByText("Newest ticket")).closest("tr");
    if (!row) throw new Error("row not found");

    expect(within(row).getByText("—")).toBeInTheDocument();
  });

  test("renders the category when the ticket has one", async () => {
    mockGet.mockResolvedValue(ticketsResponse([middleTicket]));
    renderTicketsPage();

    const row = (await screen.findByText("Middle ticket")).closest("tr");
    if (!row) throw new Error("row not found");

    expect(
      within(row).getByText(TICKET_CATEGORY.Technical),
    ).toBeInTheDocument();
  });

  test("renders the createdAt as a localised date", async () => {
    mockGet.mockResolvedValue(ticketsResponse([newestTicket]));
    renderTicketsPage();

    const row = (await screen.findByText("Newest ticket")).closest("tr");
    if (!row) throw new Error("row not found");

    const expected = new Date(newestTicket.createdAt).toLocaleDateString();
    expect(within(row).getByText(expected)).toBeInTheDocument();
  });

  test("renders the column headers", async () => {
    mockGet.mockResolvedValue(ticketsResponse([newestTicket]));
    renderTicketsPage();

    await screen.findByText("Newest ticket");

    for (const header of [
      "Subject",
      "Customer",
      "Status",
      "Category",
      "Created",
    ]) {
      expect(
        screen.getByRole("columnheader", { name: header }),
      ).toBeInTheDocument();
    }
  });

  test("renders an empty-state message when no tickets are returned", async () => {
    mockGet.mockResolvedValue(ticketsResponse([]));
    renderTicketsPage();

    expect(await screen.findByText("No tickets found.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  test("renders an alert when the request fails", async () => {
    mockGet.mockRejectedValue(new Error("boom"));
    renderTicketsPage();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("boom");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  test("surfaces the API error message from an axios error", async () => {
    mockGet.mockRejectedValue(
      Object.assign(new Error("Request failed"), {
        isAxiosError: true,
        response: { status: 401, data: { error: "Unauthenticated" } },
      }),
    );
    renderTicketsPage();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Unauthenticated");
  });

  test("does not flash the skeleton after data arrives", async () => {
    mockGet.mockResolvedValue(ticketsResponse([newestTicket]));
    renderTicketsPage();

    await waitFor(() => {
      expect(screen.queryByLabelText("Loading tickets")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Newest ticket")).toBeInTheDocument();
  });
});

describe("TicketsPage sorting", () => {
  const allTickets = [newestTicket, middleTicket, oldestTicket];

  async function renderLoaded() {
    mockGet.mockResolvedValue(ticketsResponse(allTickets));
    const user = userEvent.setup();
    renderTicketsPage();
    await screen.findByText("Newest ticket");
    return user;
  }

  test("clicking a new column requests it ascending", async () => {
    const user = await renderLoaded();

    await user.click(screen.getByRole("button", { name: "Status" }));

    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
    expect(sortParamsOfCall(1)).toEqual({
      sort: TICKET_SORT_FIELD.status,
      order: SORT_ORDER.asc,
      page: FIRST_PAGE,
      pageSize: DEFAULT_PAGE_SIZE,
    });
  });

  test("clicking the active column flips its direction", async () => {
    const user = await renderLoaded();

    // Created starts descending, so the first click flips it to ascending.
    await user.click(screen.getByRole("button", { name: "Created" }));

    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
    expect(sortParamsOfCall(1)).toEqual({
      sort: TICKET_SORT_FIELD.createdAt,
      order: SORT_ORDER.asc,
      page: FIRST_PAGE,
      pageSize: DEFAULT_PAGE_SIZE,
    });
  });

  test("a third click keeps a sort rather than clearing it", async () => {
    const user = await renderLoaded();
    const subject = screen.getByRole("button", { name: "Subject" });

    await user.click(subject);
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
    await user.click(subject);
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(3));
    await user.click(subject);
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(4));

    // asc -> desc -> back to asc, never an unsorted request
    expect(sortParamsOfCall(1).order).toBe(SORT_ORDER.asc);
    expect(sortParamsOfCall(2).order).toBe(SORT_ORDER.desc);
    expect(sortParamsOfCall(3)).toEqual({
      sort: TICKET_SORT_FIELD.subject,
      order: SORT_ORDER.asc,
      page: FIRST_PAGE,
      pageSize: DEFAULT_PAGE_SIZE,
    });
  });

  test("marks the sorted column with aria-sort and leaves the rest neutral", async () => {
    const user = await renderLoaded();

    expect(sortIndicator("Created")).toBe("descending");
    expect(sortIndicator("Subject")).toBe("none");
    expect(sortIndicator("Status")).toBe("none");

    await user.click(screen.getByRole("button", { name: "Subject" }));

    await waitFor(() => expect(sortIndicator("Subject")).toBe("ascending"));
    expect(sortIndicator("Created")).toBe("none");
  });

  test("renders the server's order without re-sorting it client-side", async () => {
    const user = await renderLoaded();

    // The mock ignores the params and always answers in this order, which is
    // NOT alphabetical by subject (that would be Middle, Newest, Oldest).
    await user.click(screen.getByRole("button", { name: "Subject" }));
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));

    expect(sortParamsOfCall(1).sort).toBe(TICKET_SORT_FIELD.subject);
    expect(rowSubjects()).toEqual([
      "Newest ticket",
      "Middle ticket",
      "Oldest ticket",
    ]);
  });

  test("keeps sort and filters together in one request", async () => {
    const user = await renderLoaded();

    await chooseOption(user, "Status", TICKET_STATUS.Open);
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));

    await user.click(screen.getByRole("button", { name: "Subject" }));
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(3));

    expect(sortParamsOfCall(2)).toEqual({
      sort: TICKET_SORT_FIELD.subject,
      order: SORT_ORDER.asc,
      status: TICKET_STATUS.Open,
      page: FIRST_PAGE,
      pageSize: DEFAULT_PAGE_SIZE,
    });
  });

  test("keeps the current rows on screen while the re-sorted set loads", async () => {
    mockGet.mockResolvedValueOnce(ticketsResponse(allTickets));
    const user = userEvent.setup();
    renderTicketsPage();
    await screen.findByText("Newest ticket");

    // Second request never settles — the table must not fall back to a skeleton.
    mockGet.mockReturnValueOnce(new Promise(() => {}));
    await user.click(screen.getByRole("button", { name: "Subject" }));

    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
    expect(screen.queryByLabelText("Loading tickets")).not.toBeInTheDocument();
    expect(screen.getByText("Newest ticket")).toBeInTheDocument();
  });
});

describe("TicketsPage filtering", () => {
  const allTickets = [newestTicket, middleTicket, oldestTicket];

  async function renderLoaded() {
    mockGet.mockResolvedValue(ticketsResponse(allTickets));
    const user = userEvent.setup();
    renderTicketsPage();
    await screen.findByText("Newest ticket");
    return user;
  }

  test("sends no filter params until a filter is set", async () => {
    await renderLoaded();

    expect(sortParamsOfCall(0)).not.toHaveProperty("status");
    expect(sortParamsOfCall(0)).not.toHaveProperty("category");
    expect(sortParamsOfCall(0)).not.toHaveProperty("q");
  });

  test("filters by status", async () => {
    const user = await renderLoaded();

    await chooseOption(user, "Status", TICKET_STATUS.Resolved);

    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
    expect(sortParamsOfCall(1).status).toBe(TICKET_STATUS.Resolved);
  });

  test("filters by category", async () => {
    const user = await renderLoaded();

    await chooseOption(user, "Category", TICKET_CATEGORY.Refund);

    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
    expect(sortParamsOfCall(1).category).toBe(TICKET_CATEGORY.Refund);
  });

  test("filters to uncategorised tickets via the sentinel", async () => {
    const user = await renderLoaded();

    await chooseOption(user, "Category", "Uncategorised");

    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
    expect(sortParamsOfCall(1).category).toBe(CATEGORY_NONE);
  });

  test("debounces the search into a single request", async () => {
    const user = await renderLoaded();

    await user.type(screen.getByLabelText("Search"), "refund");

    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
    expect(sortParamsOfCall(1).q).toBe("refund");
    // Six keystrokes, one request — the input is not firing per character.
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  test("ignores a whitespace-only search", async () => {
    const user = await renderLoaded();

    await user.type(screen.getByLabelText("Search"), "   ");

    await waitFor(() => expect(sortParamsOfCall(0)).not.toHaveProperty("q"));
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  test("clears every filter at once", async () => {
    const user = await renderLoaded();

    await chooseOption(user, "Status", TICKET_STATUS.Open);
    await chooseOption(user, "Category", TICKET_CATEGORY.Technical);
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(3));

    await user.click(screen.getByRole("button", { name: /clear filters/i }));

    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(4));
    const params = sortParamsOfCall(3);
    expect(params).not.toHaveProperty("status");
    expect(params).not.toHaveProperty("category");
    expect(filterValue("Status")).toBe("Any status");
    expect(filterValue("Category")).toBe("Any category");
  });

  test("shows the clear button only while a filter is active", async () => {
    const user = await renderLoaded();

    expect(
      screen.queryByRole("button", { name: /clear filters/i }),
    ).not.toBeInTheDocument();

    await chooseOption(user, "Status", TICKET_STATUS.Open);

    expect(
      screen.getByRole("button", { name: /clear filters/i }),
    ).toBeInTheDocument();
  });

  test("explains an empty result differently when filters are active", async () => {
    const user = await renderLoaded();

    mockGet.mockResolvedValue(ticketsResponse([]));
    await chooseOption(user, "Status", TICKET_STATUS.Closed);

    expect(
      await screen.findByText("No tickets match these filters."),
    ).toBeInTheDocument();
    expect(screen.queryByText("No tickets found.")).not.toBeInTheDocument();
  });

  test("keeps the filter controls usable when nothing matches", async () => {
    const user = await renderLoaded();

    mockGet.mockResolvedValue(ticketsResponse([]));
    await chooseOption(user, "Status", TICKET_STATUS.Closed);
    await screen.findByText("No tickets match these filters.");

    // The bar must survive an empty result, or the filter can't be undone.
    expect(filterControl("Status")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /clear filters/i }),
    ).toBeInTheDocument();
  });
});

describe("TicketsPage pagination", () => {
  const allTickets = [newestTicket, middleTicket, oldestTicket];

  /** 3 rows on screen, but 231 matching overall — i.e. many pages. */
  function manyPages(overrides: Partial<TicketsListResponse> = {}) {
    return ticketsResponse(allTickets, { total: 231, ...overrides });
  }

  async function renderLoaded() {
    mockGet.mockResolvedValue(manyPages());
    const user = userEvent.setup();
    renderTicketsPage();
    await screen.findByText("Newest ticket");
    return user;
  }

  test("requests the first page at the default size on mount", async () => {
    await renderLoaded();

    expect(sortParamsOfCall(0).page).toBe(FIRST_PAGE);
    expect(sortParamsOfCall(0).pageSize).toBe(DEFAULT_PAGE_SIZE);
  });

  test("reports the visible range and page count", async () => {
    await renderLoaded();

    expect(screen.getByText("1–25 of 231")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 10")).toBeInTheDocument();
  });

  test("advances to the next page", async () => {
    const user = await renderLoaded();

    mockGet.mockResolvedValue(manyPages({ page: 2 }));
    await user.click(screen.getByRole("button", { name: "Next page" }));

    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
    expect(sortParamsOfCall(1).page).toBe(2);
    expect(await screen.findByText("26–50 of 231")).toBeInTheDocument();
  });

  test("disables Previous on the first page and Next on the last", async () => {
    const user = await renderLoaded();

    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next page" })).toBeEnabled();

    mockGet.mockResolvedValue(manyPages({ page: 10 }));
    await user.click(screen.getByRole("button", { name: "Next page" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled(),
    );
    expect(screen.getByRole("button", { name: "Previous page" })).toBeEnabled();
  });

  test("clamps the range label on a partial last page", async () => {
    mockGet.mockResolvedValue(ticketsResponse(allTickets, { total: 53, page: 3 }));
    renderTicketsPage();

    // 53 items, 25 per page: the third page holds only 3.
    expect(await screen.findByText("51–53 of 53")).toBeInTheDocument();
    expect(screen.getByText("Page 3 of 3")).toBeInTheDocument();
  });

  test("changing the page size returns to the first page", async () => {
    const user = await renderLoaded();

    mockGet.mockResolvedValue(manyPages({ page: 2 }));
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(sortParamsOfCall(1).page).toBe(2));

    mockGet.mockResolvedValue(manyPages({ pageSize: 50 }));
    await chooseOption(user, "Per page", "50");

    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(3));
    expect(sortParamsOfCall(2).pageSize).toBe(50);
    expect(sortParamsOfCall(2).page).toBe(FIRST_PAGE);
  });

  test("re-sorting returns to the first page", async () => {
    const user = await renderLoaded();

    mockGet.mockResolvedValue(manyPages({ page: 2 }));
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(sortParamsOfCall(1).page).toBe(2));

    mockGet.mockResolvedValue(manyPages());
    await user.click(screen.getByRole("button", { name: "Subject" }));

    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(3));
    // Page 2 of the old ordering is meaningless in the new one.
    expect(sortParamsOfCall(2).page).toBe(FIRST_PAGE);
    expect(sortParamsOfCall(2).sort).toBe(TICKET_SORT_FIELD.subject);
  });

  test("filtering returns to the first page", async () => {
    const user = await renderLoaded();

    mockGet.mockResolvedValue(manyPages({ page: 2 }));
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(sortParamsOfCall(1).page).toBe(2));

    mockGet.mockResolvedValue(manyPages({ total: 12 }));
    await chooseOption(user, "Status", TICKET_STATUS.Open);

    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(3));
    expect(sortParamsOfCall(2).page).toBe(FIRST_PAGE);
    expect(sortParamsOfCall(2).status).toBe(TICKET_STATUS.Open);
  });

  test("hides the pagination bar when nothing matches", async () => {
    mockGet.mockResolvedValue(ticketsResponse([], { total: 0 }));
    renderTicketsPage();

    await screen.findByText("No tickets found.");
    expect(
      screen.queryByRole("navigation", { name: "Pagination" }),
    ).not.toBeInTheDocument();
  });

  test("keeps the current page on screen while the next one loads", async () => {
    const user = await renderLoaded();

    mockGet.mockReturnValueOnce(new Promise(() => {}));
    await user.click(screen.getByRole("button", { name: "Next page" }));

    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
    expect(screen.queryByLabelText("Loading tickets")).not.toBeInTheDocument();
    expect(screen.getByText("Newest ticket")).toBeInTheDocument();
  });
});

describe("TicketsTable column widths", () => {
  // Derived, not a literal: the table pins every column id to a sortable field
  // and keys COLUMN_META by that same union, so the two counts are the same
  // number by construction. Hard-coding it just means editing this line each
  // time a column lands, which proves nothing.
  const COLUMN_COUNT = Object.keys(TICKET_SORT_FIELD).length;

  function colCount(): number {
    return document.querySelectorAll("colgroup col").length;
  }

  test("declares a width for every column", async () => {
    mockGet.mockResolvedValue(ticketsResponse([newestTicket]));
    renderTicketsPage();

    await screen.findByText("Newest ticket");
    expect(colCount()).toBe(COLUMN_COUNT);
  });

  test("the skeleton declares the same columns as the table", () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    renderTicketsPage();

    // Both read one shared map, so a new column can't reach only one of them.
    expect(screen.getByLabelText("Loading tickets")).toBeInTheDocument();
    expect(colCount()).toBe(COLUMN_COUNT);
  });

  test("gives every column a resize handle", async () => {
    mockGet.mockResolvedValue(ticketsResponse([newestTicket]));
    renderTicketsPage();

    await screen.findByText("Newest ticket");
    expect(screen.getAllByRole("separator")).toHaveLength(COLUMN_COUNT);
    expect(
      screen.getByRole("separator", { name: "Resize Subject column" }),
    ).toBeInTheDocument();
  });
});

describe("TicketsPage URL state", () => {
  test("reads sort, filters and pagination from the URL on mount", async () => {
    mockGet.mockResolvedValue(
      ticketsResponse([middleTicket], { page: 2, pageSize: 10, total: 30 }),
    );
    renderTicketsPage(
      "/tickets?status=Open&category=Technical&q=login&sort=subject&order=asc&page=2&pageSize=10",
    );

    await screen.findByText("Middle ticket");

    expect(sortParamsOfCall(0)).toEqual({
      sort: TICKET_SORT_FIELD.subject,
      order: SORT_ORDER.asc,
      status: TICKET_STATUS.Open,
      category: TICKET_CATEGORY.Technical,
      q: "login",
      page: 2,
      pageSize: 10,
    });
    // One request, not a default-params round trip followed by a corrected one.
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  test("shows the URL's filters in the controls", async () => {
    mockGet.mockResolvedValue(ticketsResponse([middleTicket]));
    renderTicketsPage("/tickets?status=Resolved&category=Technical&q=login");

    await screen.findByText("Middle ticket");

    expect(filterValue("Status")).toBe(TICKET_STATUS.Resolved);
    expect(filterValue("Category")).toBe(TICKET_CATEGORY.Technical);
    expect(screen.getByLabelText("Search")).toHaveValue("login");
    expect(sortIndicator("Subject")).toBe("none");
  });

  test("reflects a URL sort in the column header", async () => {
    mockGet.mockResolvedValue(ticketsResponse([newestTicket]));
    renderTicketsPage("/tickets?sort=subject&order=asc");

    await screen.findByText("Newest ticket");
    expect(sortIndicator("Subject")).toBe("ascending");
  });

  test("falls back per-field on garbage params, keeping the valid ones", async () => {
    mockGet.mockResolvedValue(ticketsResponse([newestTicket]));
    renderTicketsPage("/tickets?sort=bogus&page=abc&status=Nope&pageSize=10");

    await screen.findByText("Newest ticket");

    // A stale or hand-edited link must not throw away the params beside the
    // bad ones — pageSize survives while the three invalid values default.
    expect(sortParamsOfCall(0)).toEqual({
      sort: TICKET_SORT_FIELD.createdAt,
      order: SORT_ORDER.desc,
      page: FIRST_PAGE,
      pageSize: 10,
    });
  });

  test("leaves the URL untouched on mount when nothing was chosen", async () => {
    mockGet.mockResolvedValue(ticketsResponse([newestTicket]));
    renderTicketsPageWithLocation();

    await screen.findByText("Newest ticket");
    // Defaults are never written, so the resting URL stays shareable-clean.
    expect(locationSearch()).toBe("");
  });

  test("writes a sort change to the URL", async () => {
    mockGet.mockResolvedValue(ticketsResponse([newestTicket]));
    renderTicketsPageWithLocation();
    const user = userEvent.setup();

    await screen.findByText("Newest ticket");
    await user.click(screen.getByRole("button", { name: "Subject" }));

    await waitFor(() =>
      expect(urlParams()).toMatchObject({
        sort: TICKET_SORT_FIELD.subject,
        order: SORT_ORDER.asc,
      }),
    );
  });

  test("writes a filter change to the URL", async () => {
    mockGet.mockResolvedValue(ticketsResponse([newestTicket]));
    renderTicketsPageWithLocation();
    const user = userEvent.setup();

    await screen.findByText("Newest ticket");
    await chooseOption(user, "Status", TICKET_STATUS.Resolved);

    await waitFor(() =>
      expect(urlParams().status).toBe(TICKET_STATUS.Resolved),
    );
  });

  test("writes the settled search to the URL", async () => {
    mockGet.mockResolvedValue(ticketsResponse([newestTicket]));
    renderTicketsPageWithLocation();
    const user = userEvent.setup();

    await screen.findByText("Newest ticket");
    await user.type(screen.getByLabelText("Search"), "refund");

    await waitFor(() => expect(urlParams().q).toBe("refund"));
  });

  test("drops the page when a filter changes", async () => {
    mockGet.mockResolvedValue(
      ticketsResponse([newestTicket], { page: 2, total: 60 }),
    );
    renderTicketsPageWithLocation("/tickets?page=2");
    const user = userEvent.setup();

    await screen.findByText("Newest ticket");
    expect(urlParams().page).toBe("2");

    await chooseOption(user, "Status", TICKET_STATUS.Open);

    // Page 2 of the old result set means nothing in the new one.
    await waitFor(() => expect(urlParams()).not.toHaveProperty("page"));
    expect(urlParams().status).toBe(TICKET_STATUS.Open);
  });

  test("keeps the page when only the page changes", async () => {
    mockGet.mockResolvedValue(
      ticketsResponse([newestTicket], { page: 1, total: 60 }),
    );
    renderTicketsPageWithLocation();
    const user = userEvent.setup();

    await screen.findByText("Newest ticket");
    await user.click(screen.getByRole("button", { name: "Next page" }));

    await waitFor(() => expect(urlParams().page).toBe("2"));
  });
});
