import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  TICKET_CATEGORY,
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
      { signal: AbortSignal },
    ];
    expect(url).toBe("/api/tickets");
    expect(options.signal).toBeInstanceOf(AbortSignal);
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

    const open = await screen.findByText(TICKET_STATUS.Open);
    const resolved = screen.getByText(TICKET_STATUS.Resolved);
    const closed = screen.getByText(TICKET_STATUS.Closed);

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
