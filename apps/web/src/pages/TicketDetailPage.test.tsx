import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  MESSAGE_DIRECTION,
  TICKET_CATEGORY,
  TICKET_STATUS,
  USER_ROLE,
  type TicketAssignee,
  type TicketDetail,
  type TicketWithAssignee,
  type ThreadMessage,
} from "@ticket/shared";
import { renderWithQuery } from "@/test/render";
import { TicketDetailPage } from "./TicketDetailPage";

// --- Mocks ----------------------------------------------------------------

const mockGet = vi.fn();
const mockPatch = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
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

const ASSIGNEES_URL = "/api/tickets/assignees";

const AGENTS: TicketAssignee[] = [
  { id: "agent-1", name: "Dana Delegate", email: "dana@example.com" },
  { id: "agent-2", name: "Sam Support", email: "sam@example.com" },
];

interface ApiFixture {
  ticket?: TicketDetail;
  detailError?: unknown;
  assignees?: TicketAssignee[];
  assigneesError?: unknown;
}

/**
 * Route the two GETs the page makes.
 *
 * They resolve independently, so a test can fail the roster without failing the
 * ticket — and a single blanket `mockResolvedValue` would answer the roster
 * request with a ticket, which is a state the real API can't produce.
 */
function mockApi({
  ticket,
  detailError,
  assignees = [],
  assigneesError,
}: ApiFixture = {}) {
  mockGet.mockImplementation((url: string) => {
    if (url === ASSIGNEES_URL) {
      return assigneesError
        ? Promise.reject(assigneesError)
        : Promise.resolve({ data: { assignees } });
    }
    return detailError
      ? Promise.reject(detailError)
      : Promise.resolve({ data: { ticket: ticket ?? makeTicketDetail() } });
  });
}

/** Axios shape, so `isNotFoundError` and `extractErrorMessage` see a real one. */
function makeAxiosError(status: number, message?: string) {
  return Object.assign(new Error("Request failed"), {
    isAxiosError: true,
    response: { status, data: message ? { error: message } : {} },
  });
}

/**
 * What the assignment endpoint replies with: the ticket, minus the thread it
 * doesn't touch.
 */
function assignResponse(assignedTo: TicketAssignee | null) {
  const { messages, ...ticket } = makeTicketDetail();
  return {
    data: {
      ticket: {
        ...ticket,
        assignedToId: assignedTo?.id ?? null,
        assignedTo,
      } satisfies TicketWithAssignee,
    },
  };
}

/** The picker is a Radix combobox, not a native select — click, then pick. */
async function chooseAssignee(
  user: ReturnType<typeof userEvent.setup>,
  optionName: string,
): Promise<void> {
  await user.click(assigneeControl());
  await user.click(await screen.findByRole("option", { name: optionName }));
}

function assigneeControl(): HTMLElement {
  return screen.getByRole("combobox", { name: "Assigned to" });
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
  mockPatch.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// --- Tests ----------------------------------------------------------------

describe("TicketDetailPage", () => {
  test("requests the ticket by the id in the URL, with an abort signal", async () => {
    mockApi();
    renderDetail("/tickets/12");

    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    const [url, config] = mockGet.mock.calls[0];
    expect(url).toBe("/api/tickets/12");
    expect(config.signal).toBeInstanceOf(AbortSignal);
  });

  test("shows a skeleton while loading, then the ticket", async () => {
    mockApi();
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
    mockApi({
      ticket: makeTicketDetail({ status: TICKET_STATUS.Resolved, id: 42 }),
    });
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
    mockApi({ ticket: makeTicketDetail({ category: null }) });
    renderDetail();

    await screen.findByRole("heading", { name: "Cannot log in", level: 1 });
    expect(
      screen.queryByText(TICKET_CATEGORY.Technical),
    ).not.toBeInTheDocument();
  });

  test("shows the assignee when there is one", async () => {
    mockApi({
      ticket: makeTicketDetail({
        assignedToId: "user-1",
        // Deliberately not the signed-in user's name: the NavBar renders that,
        // so a match would prove nothing about the assignee field.
        assignedTo: {
          id: "user-1",
          name: "Dana Delegate",
          email: "dana@example.com",
        },
      }),
    });
    renderDetail();

    await screen.findByRole("heading", { name: "Cannot log in", level: 1 });
    expect(screen.getByText("Dana Delegate")).toBeInTheDocument();
    expect(screen.getByText("dana@example.com")).toBeInTheDocument();
    expect(screen.queryByText("Unassigned")).not.toBeInTheDocument();
  });

  test("shows Unassigned when the ticket has no assignee", async () => {
    mockApi();
    renderDetail();

    expect(await screen.findByText("Unassigned")).toBeInTheDocument();
  });
});

describe("TicketDetailPage assignment", () => {
  /** The picker is disabled until the roster lands — wait, then interact. */
  async function readyToAssign() {
    await screen.findByRole("heading", { name: "Cannot log in", level: 1 });
    await waitFor(() => expect(assigneeControl()).toBeEnabled());
    return userEvent.setup();
  }

  test("asks the API who the ticket can be assigned to", async () => {
    mockApi({ assignees: AGENTS });
    renderDetail();

    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith(
        ASSIGNEES_URL,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
  });

  test("offers Unassigned and every agent", async () => {
    mockApi({ assignees: AGENTS });
    renderDetail();
    const user = await readyToAssign();

    await user.click(assigneeControl());

    expect(
      await screen.findByRole("option", { name: "Unassigned" }),
    ).toBeInTheDocument();
    for (const agent of AGENTS) {
      expect(
        screen.getByRole("option", { name: agent.name }),
      ).toBeInTheDocument();
    }
  });

  test("assigns the ticket to the chosen agent", async () => {
    mockApi({ assignees: AGENTS });
    mockPatch.mockResolvedValue(assignResponse(AGENTS[1]));
    renderDetail();
    const user = await readyToAssign();
    const detailFetches = () =>
      mockGet.mock.calls.filter(([url]) => url === "/api/tickets/12").length;
    const before = detailFetches();

    await chooseAssignee(user, "Sam Support");

    expect(mockPatch).toHaveBeenCalledWith("/api/tickets/12/assignee", {
      assignedToId: "agent-2",
    });
    expect(await screen.findByText("sam@example.com")).toBeInTheDocument();
    expect(assigneeControl()).toHaveTextContent("Sam Support");
    // The response updated the cached ticket directly: refetching would pull
    // the whole thread back down to learn one field.
    expect(detailFetches()).toBe(before);
  });

  test("unassigns the ticket by sending null", async () => {
    mockApi({
      ticket: makeTicketDetail({
        assignedToId: AGENTS[0].id,
        assignedTo: AGENTS[0],
      }),
      assignees: AGENTS,
    });
    mockPatch.mockResolvedValue(assignResponse(null));
    renderDetail();
    const user = await readyToAssign();

    await chooseAssignee(user, "Unassigned");

    expect(mockPatch).toHaveBeenCalledWith("/api/tickets/12/assignee", {
      assignedToId: null,
    });
    await waitFor(() =>
      expect(assigneeControl()).toHaveTextContent("Unassigned"),
    );
    expect(screen.queryByText("dana@example.com")).not.toBeInTheDocument();
  });

  test("keeps the current assignee and explains a rejected change", async () => {
    mockApi({
      ticket: makeTicketDetail({
        assignedToId: AGENTS[0].id,
        assignedTo: AGENTS[0],
      }),
      assignees: AGENTS,
    });
    mockPatch.mockRejectedValue(makeAxiosError(400, "Assignee not found"));
    renderDetail();
    const user = await readyToAssign();

    await chooseAssignee(user, "Sam Support");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Assignee not found",
    );
    // The field still says who the ticket is actually assigned to — showing the
    // rejected choice would claim a change the server refused.
    expect(assigneeControl()).toHaveTextContent("Dana Delegate");
  });

  test("still names an assignee who has left the roster", async () => {
    const gone: TicketAssignee = {
      id: "gone-1",
      name: "Gone Agent",
      email: "gone@example.com",
    };
    mockApi({
      ticket: makeTicketDetail({ assignedToId: gone.id, assignedTo: gone }),
      assignees: AGENTS,
    });
    renderDetail();
    const user = await readyToAssign();

    expect(assigneeControl()).toHaveTextContent("Gone Agent");

    await user.click(assigneeControl());
    expect(
      await screen.findByRole("option", { name: "Gone Agent" }),
    ).toBeInTheDocument();
  });

  test("explains a roster that will not load, and locks the control", async () => {
    mockApi({ assigneesError: makeAxiosError(500) });
    renderDetail();

    expect(
      await screen.findByText("Couldn't load the list of users."),
    ).toBeInTheDocument();
    expect(assigneeControl()).toBeDisabled();
  });
});

describe("TicketDetailPage thread", () => {
  test("renders messages in the order the API sent them", async () => {
    mockApi({
      ticket: makeTicketDetail({
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
    });
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
    mockApi({
      ticket: makeTicketDetail({
        messages: [
          makeMessage({ id: 1 }),
          makeMessage({ id: 2, direction: MESSAGE_DIRECTION.outbound }),
        ],
      }),
    });
    renderDetail();

    expect(await screen.findByText("From customer")).toBeInTheDocument();
    expect(screen.getByText("From support")).toBeInTheDocument();
  });

  test("preserves line breaks in the message body", async () => {
    mockApi({
      ticket: makeTicketDetail({
        messages: [makeMessage({ id: 1, textBody: "Line one\nLine two" })],
      }),
    });
    renderDetail();

    const body = await screen.findByText(/Line one/);
    expect(body).toHaveClass("whitespace-pre-wrap");
    expect(body.textContent).toBe("Line one\nLine two");
  });

  test("renders an HTML-looking body as literal text, never as markup", async () => {
    const hostile = '<img src="x" onerror="alert(1)">Hi there';
    mockApi({
      ticket: makeTicketDetail({
        messages: [makeMessage({ id: 1, textBody: hostile })],
      }),
    });
    const { container } = renderDetail();

    expect(await screen.findByText(hostile)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  test("explains a message with no plain-text part", async () => {
    mockApi({
      ticket: makeTicketDetail({
        messages: [makeMessage({ id: 1, textBody: null })],
      }),
    });
    renderDetail();

    expect(
      await screen.findByText("This message has no plain-text content."),
    ).toBeInTheDocument();
  });

  test("shows the empty state when the ticket has no messages", async () => {
    mockApi();
    renderDetail();

    expect(
      await screen.findByText("No messages on this ticket yet."),
    ).toBeInTheDocument();
    expect(screen.getByText("Messages (0)")).toBeInTheDocument();
  });
});

describe("TicketDetailPage errors", () => {
  test("shows a not-found destination, not an alert, on 404", async () => {
    mockApi({ detailError: makeAxiosError(404, "Ticket not found") });
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
    mockApi({ detailError: makeAxiosError(400, "Invalid ticket id") });
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
    mockApi();
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
    mockApi();
    renderDetail("/tickets/12");

    await screen.findByRole("heading", { name: "Cannot log in", level: 1 });
    expect(screen.getByRole("link", { name: /Back to tickets/ })).toHaveAttribute(
      "href",
      "/tickets",
    );
  });
});
