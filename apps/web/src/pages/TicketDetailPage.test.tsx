import { screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  MESSAGE_DIRECTION,
  TICKET_CATEGORY,
  TICKET_STATUS,
  USER_ROLE,
  type TicketDetail,
  type TicketDetailResponse,
  type ThreadMessage,
} from "@ticket/shared";
import { renderWithQuery } from "@/test/render";
import { TicketDetailPage } from "./TicketDetailPage";

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

function makeMessage(
  overrides: Partial<ThreadMessage> & Pick<ThreadMessage, "id">,
): ThreadMessage {
  return {
    ticketId: 12,
    messageId: `<msg-${overrides.id}@example.com>`,
    inReplyTo: null,
    senderEmail: "customer@example.com",
    senderName: "Casey Customer",
    textBody: "Hello, I need help.",
    direction: MESSAGE_DIRECTION.inbound,
    createdAt: "2025-05-01T12:00:00.000Z",
    ...overrides,
  };
}

function makeTicketDetail(overrides: Partial<TicketDetail> = {}): TicketDetail {
  return {
    id: 12,
    subject: "Cannot log in",
    status: TICKET_STATUS.Open,
    category: TICKET_CATEGORY.Technical,
    customerEmail: "customer@example.com",
    customerName: "Casey Customer",
    assignedToId: null,
    assignedTo: null,
    lastMessageAt: "2025-05-03T12:00:00.000Z",
    createdAt: "2025-05-01T12:00:00.000Z",
    updatedAt: "2025-05-03T12:00:00.000Z",
    messages: [],
    ...overrides,
  };
}

function detailResponse(
  ticket: TicketDetail,
): { data: TicketDetailResponse } {
  return { data: { ticket } };
}

/** Axios shape, so `isNotFoundError` and `extractErrorMessage` see a real one. */
function makeAxiosError(status: number, message?: string) {
  return Object.assign(new Error("Request failed"), {
    isAxiosError: true,
    response: { status, data: message ? { error: message } : {} },
  });
}

/**
 * The page reads `:id` from the route, so it has to be mounted under a matching
 * path rather than rendered bare. The sibling /tickets route gives the back
 * link somewhere real to point at.
 */
function renderDetail(
  entry: string | { pathname: string; state?: unknown } = "/tickets/12",
) {
  return renderWithQuery(
    <Routes>
      <Route path="/tickets/:id" element={<TicketDetailPage />} />
      <Route path="/tickets" element={<div>tickets list</div>} />
    </Routes>,
    { initialEntries: [entry] },
  );
}

beforeEach(() => {
  mockGet.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// --- Tests ----------------------------------------------------------------

describe("TicketDetailPage", () => {
  test("requests the ticket by the id in the URL, with an abort signal", async () => {
    mockGet.mockResolvedValue(detailResponse(makeTicketDetail()));
    renderDetail("/tickets/12");

    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    const [url, config] = mockGet.mock.calls[0];
    expect(url).toBe("/api/tickets/12");
    expect(config.signal).toBeInstanceOf(AbortSignal);
  });

  test("shows a skeleton while loading, then the ticket", async () => {
    mockGet.mockResolvedValue(detailResponse(makeTicketDetail()));
    renderDetail();

    expect(screen.getByLabelText("Loading ticket")).toHaveAttribute(
      "aria-busy",
      "true",
    );

    expect(
      await screen.findByRole("heading", { name: "Cannot log in", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Loading ticket")).not.toBeInTheDocument();
  });

  test("renders the ticket fields, id and badges", async () => {
    mockGet.mockResolvedValue(
      detailResponse(
        makeTicketDetail({ status: TICKET_STATUS.Resolved, id: 42 }),
      ),
    );
    renderDetail("/tickets/42");

    expect(
      await screen.findByRole("heading", { name: "Cannot log in", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText("#42")).toBeInTheDocument();
    expect(screen.getByText(TICKET_STATUS.Resolved)).toBeInTheDocument();
    expect(screen.getByText(TICKET_CATEGORY.Technical)).toBeInTheDocument();
    expect(screen.getByText("Casey Customer")).toBeInTheDocument();
    expect(screen.getByText("customer@example.com")).toBeInTheDocument();
  });

  test("omits the category badge when the ticket has none", async () => {
    mockGet.mockResolvedValue(
      detailResponse(makeTicketDetail({ category: null })),
    );
    renderDetail();

    await screen.findByRole("heading", { name: "Cannot log in", level: 1 });
    expect(
      screen.queryByText(TICKET_CATEGORY.Technical),
    ).not.toBeInTheDocument();
  });

  test("shows the assignee when there is one", async () => {
    mockGet.mockResolvedValue(
      detailResponse(
        makeTicketDetail({
          assignedToId: "user-1",
          // Deliberately not the signed-in user's name: the NavBar renders that,
          // so a match would prove nothing about the assignee field.
          assignedTo: {
            id: "user-1",
            name: "Dana Delegate",
            email: "dana@example.com",
          },
        }),
      ),
    );
    renderDetail();

    await screen.findByRole("heading", { name: "Cannot log in", level: 1 });
    expect(screen.getByText("Dana Delegate")).toBeInTheDocument();
    expect(screen.getByText("dana@example.com")).toBeInTheDocument();
    expect(screen.queryByText("Unassigned")).not.toBeInTheDocument();
  });

  test("shows Unassigned when the ticket has no assignee", async () => {
    mockGet.mockResolvedValue(detailResponse(makeTicketDetail()));
    renderDetail();

    expect(await screen.findByText("Unassigned")).toBeInTheDocument();
  });
});

describe("TicketDetailPage thread", () => {
  test("renders messages in the order the API sent them", async () => {
    mockGet.mockResolvedValue(
      detailResponse(
        makeTicketDetail({
          messages: [
            makeMessage({ id: 9, textBody: "First message" }),
            makeMessage({
              id: 2,
              textBody: "Second message",
              senderName: "Support Team",
              direction: MESSAGE_DIRECTION.outbound,
            }),
            makeMessage({ id: 5, textBody: "Third message" }),
          ],
        }),
      ),
    );
    const { container } = renderDetail();

    await screen.findByText("First message");
    // Ids are deliberately unsorted: a page that re-sorted client-side would
    // reorder these, and the server's order is the one that's correct.
    const bodies = Array.from(container.querySelectorAll("ol > li")).map((li) =>
      li.textContent?.includes("First message")
        ? "First"
        : li.textContent?.includes("Second message")
          ? "Second"
          : "Third",
    );
    expect(bodies).toEqual(["First", "Second", "Third"]);
    expect(screen.getByText("Messages (3)")).toBeInTheDocument();
  });

  test("labels each message by direction", async () => {
    mockGet.mockResolvedValue(
      detailResponse(
        makeTicketDetail({
          messages: [
            makeMessage({ id: 1 }),
            makeMessage({ id: 2, direction: MESSAGE_DIRECTION.outbound }),
          ],
        }),
      ),
    );
    renderDetail();

    expect(await screen.findByText("From customer")).toBeInTheDocument();
    expect(screen.getByText("From support")).toBeInTheDocument();
  });

  test("preserves line breaks in the message body", async () => {
    mockGet.mockResolvedValue(
      detailResponse(
        makeTicketDetail({
          messages: [makeMessage({ id: 1, textBody: "Line one\nLine two" })],
        }),
      ),
    );
    renderDetail();

    const body = await screen.findByText(/Line one/);
    expect(body).toHaveClass("whitespace-pre-wrap");
    expect(body.textContent).toBe("Line one\nLine two");
  });

  test("renders an HTML-looking body as literal text, never as markup", async () => {
    const hostile = '<img src="x" onerror="alert(1)">Hi there';
    mockGet.mockResolvedValue(
      detailResponse(
        makeTicketDetail({
          messages: [makeMessage({ id: 1, textBody: hostile })],
        }),
      ),
    );
    const { container } = renderDetail();

    expect(await screen.findByText(hostile)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  test("explains a message with no plain-text part", async () => {
    mockGet.mockResolvedValue(
      detailResponse(
        makeTicketDetail({
          messages: [makeMessage({ id: 1, textBody: null })],
        }),
      ),
    );
    renderDetail();

    expect(
      await screen.findByText("This message has no plain-text content."),
    ).toBeInTheDocument();
  });

  test("shows the empty state when the ticket has no messages", async () => {
    mockGet.mockResolvedValue(detailResponse(makeTicketDetail()));
    renderDetail();

    expect(
      await screen.findByText("No messages on this ticket yet."),
    ).toBeInTheDocument();
    expect(screen.getByText("Messages (0)")).toBeInTheDocument();
  });
});

describe("TicketDetailPage errors", () => {
  test("shows a not-found destination, not an alert, on 404", async () => {
    mockGet.mockRejectedValue(makeAxiosError(404, "Ticket not found"));
    renderDetail("/tickets/999");

    expect(
      await screen.findByRole("heading", { name: "Ticket not found", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to tickets/ })).toHaveAttribute(
      "href",
      "/tickets",
    );
  });

  test("surfaces the API message in an alert for other failures", async () => {
    mockGet.mockRejectedValue(makeAxiosError(400, "Invalid ticket id"));
    renderDetail("/tickets/abc");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid ticket id",
    );
    expect(
      screen.queryByRole("heading", { name: "Ticket not found" }),
    ).not.toBeInTheDocument();
  });
});

describe("TicketDetailPage back link", () => {
  test("returns to the list view it was opened from", async () => {
    mockGet.mockResolvedValue(detailResponse(makeTicketDetail()));
    renderDetail({
      pathname: "/tickets/12",
      state: { listSearch: "?status=Open&page=2" },
    });

    await screen.findByRole("heading", { name: "Cannot log in", level: 1 });
    expect(screen.getByRole("link", { name: /Back to tickets/ })).toHaveAttribute(
      "href",
      "/tickets?status=Open&page=2",
    );
  });

  test("falls back to a bare /tickets when opened by a direct link", async () => {
    mockGet.mockResolvedValue(detailResponse(makeTicketDetail()));
    renderDetail("/tickets/12");

    await screen.findByRole("heading", { name: "Cannot log in", level: 1 });
    expect(screen.getByRole("link", { name: /Back to tickets/ })).toHaveAttribute(
      "href",
      "/tickets",
    );
  });
});
