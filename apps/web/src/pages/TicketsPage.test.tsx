import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  CATEGORY_NONE,
  SORT_ORDER,
  TICKET_CATEGORY,
  TICKET_SORT_FIELD,
  TICKET_STATUS,
  USER_ROLE,
  type Ticket,
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

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ theme: "dark", toggleTheme: vi.fn() }),
}));

// --- Fixtures -------------------------------------------------------------

function makeTicket(overrides: Partial<Ticket> & Pick<Ticket, "id">): Ticket {
  return {
    subject: "Cannot log in",
    status: TICKET_STATUS.Open,
    category: null,
    customerEmail: "customer@example.com",
    customerName: "Casey Customer",
    assignedToId: null,
    lastMessageAt: "2025-05-01T12:00:00.000Z",
    createdAt: "2025-05-01T12:00:00.000Z",
    updatedAt: "2025-05-01T12:00:00.000Z",
    ...overrides,
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

function renderTicketsPage() {
  return renderWithQuery(<TicketsPage />, { initialEntries: ["/tickets"] });
}

function rowSubjects(): string[] {
  const [, ...bodyRows] = screen.getAllByRole("row");
  return bodyRows.map((row) => within(row).getAllByRole("cell")[0].textContent ?? "");
}

type TicketsRequestOptions = {
  params: {
    sort: string;
    order: string;
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
  await user.click(screen.getByLabelText(filterLabel));
  await user.click(await screen.findByRole("option", { name: optionName }));
}

function filterValue(filterLabel: string): string {
  return screen.getByLabelText(filterLabel).textContent ?? "";
}

// --- Tests ----------------------------------------------------------------

beforeEach(() => {
  mockGet.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("TicketsPage", () => {
  test("shows the page heading", () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    renderTicketsPage();

    expect(
      screen.getByRole("heading", { name: "Tickets", level: 1 }),
    ).toBeInTheDocument();
  });

  test("renders the skeleton table while the request is pending", () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    renderTicketsPage();

    const skeleton = screen.getByLabelText("Loading tickets");
    expect(skeleton).toBeInTheDocument();
    expect(skeleton).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("Newest ticket")).not.toBeInTheDocument();
  });

  test("calls GET /api/tickets with a cancellation signal", async () => {
    mockGet.mockResolvedValue({ data: { tickets: [newestTicket] } });
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
    mockGet.mockResolvedValue({ data: { tickets: [newestTicket] } });
    renderTicketsPage();

    await screen.findByText("Newest ticket");

    expect(sortParamsOfCall(0)).toEqual({
      sort: TICKET_SORT_FIELD.createdAt,
      order: SORT_ORDER.desc,
    });
  });

  test("renders a row per ticket once the query resolves", async () => {
    mockGet.mockResolvedValue({
      data: { tickets: [newestTicket, middleTicket, oldestTicket] },
    });
    renderTicketsPage();

    expect(await screen.findByText("Newest ticket")).toBeInTheDocument();
    expect(screen.getByText("Middle ticket")).toBeInTheDocument();
    expect(screen.getByText("Oldest ticket")).toBeInTheDocument();

    expect(screen.queryByLabelText("Loading tickets")).not.toBeInTheDocument();
  });

  test("preserves the server's newest-first order", async () => {
    mockGet.mockResolvedValue({
      data: { tickets: [newestTicket, middleTicket, oldestTicket] },
    });
    renderTicketsPage();

    await screen.findByText("Newest ticket");

    expect(rowSubjects()).toEqual([
      "Newest ticket",
      "Middle ticket",
      "Oldest ticket",
    ]);
  });

  test("renders the customer name and email in the same row", async () => {
    mockGet.mockResolvedValue({ data: { tickets: [oldestTicket] } });
    renderTicketsPage();

    const row = (await screen.findByText("Oldest ticket")).closest("tr");
    if (!row) throw new Error("row not found");

    expect(within(row).getByText("Robin Refund")).toBeInTheDocument();
    expect(within(row).getByText("robin@example.com")).toBeInTheDocument();
  });

  test("renders a distinct badge variant per status", async () => {
    mockGet.mockResolvedValue({
      data: { tickets: [newestTicket, middleTicket, oldestTicket] },
    });
    renderTicketsPage();

    // Scoped to the table so the status filter can never shadow these.
    await screen.findByText("Newest ticket");
    const table = within(screen.getByRole("table"));
    const open = table.getByText(TICKET_STATUS.Open);
    const resolved = table.getByText(TICKET_STATUS.Resolved);
    const closed = table.getByText(TICKET_STATUS.Closed);

    expect(open).toHaveAttribute("data-variant", "default");
    expect(resolved).toHaveAttribute("data-variant", "secondary");
    expect(closed).toHaveAttribute("data-variant", "outline");
  });

  test("renders a dash when the ticket has no category", async () => {
    mockGet.mockResolvedValue({ data: { tickets: [newestTicket] } });
    renderTicketsPage();

    const row = (await screen.findByText("Newest ticket")).closest("tr");
    if (!row) throw new Error("row not found");

    expect(within(row).getByText("—")).toBeInTheDocument();
  });

  test("renders the category when the ticket has one", async () => {
    mockGet.mockResolvedValue({ data: { tickets: [middleTicket] } });
    renderTicketsPage();

    const row = (await screen.findByText("Middle ticket")).closest("tr");
    if (!row) throw new Error("row not found");

    expect(
      within(row).getByText(TICKET_CATEGORY.Technical),
    ).toBeInTheDocument();
  });

  test("renders the createdAt as a localised date", async () => {
    mockGet.mockResolvedValue({ data: { tickets: [newestTicket] } });
    renderTicketsPage();

    const row = (await screen.findByText("Newest ticket")).closest("tr");
    if (!row) throw new Error("row not found");

    const expected = new Date(newestTicket.createdAt).toLocaleDateString();
    expect(within(row).getByText(expected)).toBeInTheDocument();
  });

  test("renders the column headers", async () => {
    mockGet.mockResolvedValue({ data: { tickets: [newestTicket] } });
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
    mockGet.mockResolvedValue({ data: { tickets: [] } });
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
    mockGet.mockResolvedValue({ data: { tickets: [newestTicket] } });
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
    mockGet.mockResolvedValue({ data: { tickets: allTickets } });
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
    });
  });

  test("keeps the current rows on screen while the re-sorted set loads", async () => {
    mockGet.mockResolvedValueOnce({ data: { tickets: allTickets } });
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
    mockGet.mockResolvedValue({ data: { tickets: allTickets } });
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

    mockGet.mockResolvedValue({ data: { tickets: [] } });
    await chooseOption(user, "Status", TICKET_STATUS.Closed);

    expect(
      await screen.findByText("No tickets match these filters."),
    ).toBeInTheDocument();
    expect(screen.queryByText("No tickets found.")).not.toBeInTheDocument();
  });

  test("keeps the filter controls usable when nothing matches", async () => {
    const user = await renderLoaded();

    mockGet.mockResolvedValue({ data: { tickets: [] } });
    await chooseOption(user, "Status", TICKET_STATUS.Closed);
    await screen.findByText("No tickets match these filters.");

    // The bar must survive an empty result, or the filter can't be undone.
    expect(screen.getByLabelText("Status")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /clear filters/i }),
    ).toBeInTheDocument();
  });
});
