import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  AGE_BUCKET,
  AUTO_REPLY_DECLINES,
  DASHBOARD_BUCKET,
  DASHBOARD_RANGE,
  DASHBOARD_SCOPE,
  DEFAULT_DASHBOARD_RANGE,
  LATENCY_BUCKET,
  TICKET_CATEGORY,
  TICKET_STATUS,
  USER_ROLE,
  type AssistantEffectivenessResponse,
  type AutoReplyDecline,
  type TicketStatsResponse,
} from "@ticket/shared";
import { renderWithQuery } from "@/test/render";
import { DashboardPage } from "./DashboardPage";

// --- Mocks ----------------------------------------------------------------

// Two independent fakes, dispatched on the URL: the two endpoints have to be
// controllable separately (a test that fails one must not silently drag the
// other's fixture into an incompatible shape) but a single-argument
// `mockResolvedValue` can't distinguish them.
const mockStatsGet = vi.fn();
const mockEffectivenessGet = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    get: (url: string, ...rest: unknown[]) =>
      url === "/api/tickets/effectiveness"
        ? mockEffectivenessGet(url, ...rest)
        : mockStatsGet(url, ...rest),
  },
}));

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({
    data: { user: { name: "Admin User", role: USER_ROLE.admin } },
    isPending: false,
  }),
  authClient: { signOut: vi.fn() },
}));

// --- Helpers --------------------------------------------------------------

function stats(over: Partial<TicketStatsResponse> = {}): TicketStatsResponse {
  return {
    range: DEFAULT_DASHBOARD_RANGE,
    scope: DASHBOARD_SCOPE.all,
    bucket: DASHBOARD_BUCKET.day,
    from: "2026-07-08T00:00:00.000Z",
    to: "2026-08-07T00:00:00.000Z",
    summary: {
      total: 51,
      previousTotal: 47,
      byStatus: {
        [TICKET_STATUS.New]: 0,

        [TICKET_STATUS.Processing]: 0,

        [TICKET_STATUS.Open]: 24,
        [TICKET_STATUS.Resolved]: 26,
        [TICKET_STATUS.Closed]: 1,
      },
      openUnassigned: 13,
      settledShare: 0.53,
    },
    volume: [
      {
        bucketStart: "2026-07-08",
        [TICKET_STATUS.New]: 0,

        [TICKET_STATUS.Processing]: 0,

        [TICKET_STATUS.Open]: 2,
        [TICKET_STATUS.Resolved]: 1,
        [TICKET_STATUS.Closed]: 0,
      },
    ],
    categories: [
      { category: TICKET_CATEGORY.Technical, count: 17 },
      { category: null, count: 5 },
    ],
    firstResponse: {
      responded: 50,
      awaiting: 1,
      medianHours: 6,
      p90Hours: 24,
      buckets: {
        [LATENCY_BUCKET.under1h]: 12,
        [LATENCY_BUCKET.h1to4]: 31,
        [LATENCY_BUCKET.h4to24]: 7,
        [LATENCY_BUCKET.over24h]: 0,
      },
    },
    backlogAge: {
      open: 24,
      medianAgeHours: 200,
      buckets: {
        [AGE_BUCKET.under1d]: 0,
        [AGE_BUCKET.d1to3]: 0,
        [AGE_BUCKET.d3to7]: 1,
        [AGE_BUCKET.over7d]: 23,
      },
    },
    workload: [
      {
        id: "u_1",
        name: "Admin",
        total: 18,
        [TICKET_STATUS.New]: 0,

        [TICKET_STATUS.Processing]: 0,

        [TICKET_STATUS.Open]: 6,
        [TICKET_STATUS.Resolved]: 12,
        [TICKET_STATUS.Closed]: 0,
      },
    ],
    unassigned: {
      total: 16,
      [TICKET_STATUS.New]: 0,

      [TICKET_STATUS.Processing]: 0,

      [TICKET_STATUS.Open]: 13,
      [TICKET_STATUS.Resolved]: 3,
      [TICKET_STATUS.Closed]: 0,
    },
    topCustomers: [
      {
        email: "amelia@example.com",
        name: "Amelia Hart",
        total: 2,
        open: 0,
        lastMessageAt: "2026-08-01T00:00:00.000Z",
      },
    ],
    needsAttention: [
      {
        id: 7,
        subject: "IP allowlist blocking our office",
        customerName: "Daniel Whitfield",
        assignedTo: null,
        lastMessageAt: "2026-05-13T00:00:00.000Z",
        createdAt: "2026-05-12T00:00:00.000Z",
        waitingOnUs: true,
      },
    ],
    ...over,
  };
}

function effectiveness(
  over: Partial<AssistantEffectivenessResponse> = {},
): AssistantEffectivenessResponse {
  return {
    range: DEFAULT_DASHBOARD_RANGE,
    from: "2026-07-08T00:00:00.000Z",
    to: "2026-08-07T00:00:00.000Z",
    classified: 40,
    autoReply: { resolved: 20, rate: 0.5 },
    decline: {
      count: 12,
      rate: 0.3,
      reasons: Object.fromEntries(
        AUTO_REPLY_DECLINES.map((d) => [d, 0]),
      ) as Record<AutoReplyDecline, number>,
    },
    categoryOverride: { count: 4, rate: 0.1 },
    avgEditDistance: null,
    ...over,
  };
}

function renderDashboard() {
  return renderWithQuery(<DashboardPage />, { initialEntries: ["/"] });
}

beforeEach(() => {
  mockStatsGet.mockReset();
  mockEffectivenessGet.mockReset();
  mockStatsGet.mockResolvedValue({ data: stats() });
  mockEffectivenessGet.mockResolvedValue({ data: effectiveness() });
});

// --- Tests ----------------------------------------------------------------

describe("DashboardPage", () => {
  test("renders every panel once the slice loads", async () => {
    renderDashboard();
    expect(await screen.findByText("Tickets created")).toBeInTheDocument();
    for (const title of [
      "Status mix",
      "Needs attention",
      "Time to first reply",
      "By category",
      "Workload",
      "Open backlog age",
      "Top customers",
      "Assistant effectiveness",
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  /**
   * Asserted through the sub-line and the pill rather than the label "Open" or
   * the figure 24 — the status meter beside the KPI row names the same status
   * and shows the same count, so both are genuinely ambiguous on this page.
   */
  test("surfaces the KPI row", async () => {
    renderDashboard();
    expect(await screen.findByText("13 unassigned")).toBeInTheDocument();
    expect(screen.getByText("Median first reply")).toBeInTheDocument();
    expect(
      screen.getByText("27 of 51 resolved or closed"),
    ).toBeInTheDocument();
  });

  /**
   * The fixture is deliberately unhealthy — 13 unassigned and a ticket that was
   * never answered — so both attention states have to appear.
   */
  test("flags unhealthy KPIs with a word, not only a colour", async () => {
    renderDashboard();
    expect(await screen.findByText("Backlog high")).toBeInTheDocument();
    expect(screen.getByText("Unanswered")).toBeInTheDocument();
  });

  test("congratulates a healthy slice instead", async () => {
    mockStatsGet.mockResolvedValue({
      data: stats({
        summary: {
          total: 100,
          previousTotal: 90,
          byStatus: {
            [TICKET_STATUS.New]: 0,

            [TICKET_STATUS.Processing]: 0,

            [TICKET_STATUS.Open]: 5,
            [TICKET_STATUS.Resolved]: 90,
            [TICKET_STATUS.Closed]: 5,
          },
          openUnassigned: 0,
          settledShare: 0.95,
        },
        firstResponse: {
          responded: 100,
          awaiting: 0,
          medianHours: 0.5,
          p90Hours: 1,
          buckets: {
            [LATENCY_BUCKET.under1h]: 100,
            [LATENCY_BUCKET.h1to4]: 0,
            [LATENCY_BUCKET.h4to24]: 0,
            [LATENCY_BUCKET.over24h]: 0,
          },
        },
      }),
    });
    renderDashboard();
    expect(await screen.findByText("On track")).toBeInTheDocument();
    expect(screen.getByText("Fast")).toBeInTheDocument();
    expect(screen.queryByText("Backlog high")).not.toBeInTheDocument();
  });

  test("renders the mini bar panels as rows rather than charts", async () => {
    renderDashboard();
    // "Uncategorised" is the pinned null-category row and appears nowhere else.
    expect(await screen.findByText("Uncategorised")).toBeInTheDocument();

    // "Unassigned" is scoped: the needs-attention table also prints it, in the
    // assignee column, for a ticket that has no owner.
    const workload = screen
      .getByText("Workload")
      .closest('[data-slot="card"]') as HTMLElement;
    expect(within(workload).getByText("Unassigned")).toBeInTheDocument();
    expect(within(workload).getByText("Admin")).toBeInTheDocument();
  });

  test("sends the range from the URL and refetches when it changes", async () => {
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByText("Tickets created");

    // A bare "/" carries no range param, so the resting request is the default
    // rather than whatever the fixture happens to echo back.
    await waitFor(() =>
      expect(mockStatsGet).toHaveBeenCalledWith(
        "/api/tickets/stats",
        expect.objectContaining({
          params: expect.objectContaining({ range: DEFAULT_DASHBOARD_RANGE }),
        }),
      ),
    );
    await waitFor(() =>
      expect(mockEffectivenessGet).toHaveBeenCalledWith(
        "/api/tickets/effectiveness",
        expect.objectContaining({
          params: expect.objectContaining({ range: DEFAULT_DASHBOARD_RANGE }),
        }),
      ),
    );

    // Queried by label, not role: these are Radix ToggleGroupItems, whose role
    // is "radio" rather than "button", and whose accessible name is the
    // aria-label ("Last 7d") rather than the visible "7d".
    await user.click(screen.getByLabelText("Last 7d"));

    await waitFor(() =>
      expect(mockStatsGet).toHaveBeenCalledWith(
        "/api/tickets/stats",
        expect.objectContaining({
          params: expect.objectContaining({ range: DASHBOARD_RANGE.d7 }),
        }),
      ),
    );
    await waitFor(() =>
      expect(mockEffectivenessGet).toHaveBeenCalledWith(
        "/api/tickets/effectiveness",
        expect.objectContaining({
          params: expect.objectContaining({ range: DASHBOARD_RANGE.d7 }),
        }),
      ),
    );
  });

  test("shows an error instead of panels when the request fails", async () => {
    mockStatsGet.mockRejectedValue(new Error("boom"));
    renderDashboard();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("Tickets created")).not.toBeInTheDocument();
  });

  test("renders an empty slice without crashing", async () => {
    mockStatsGet.mockResolvedValue({
      data: stats({
        summary: {
          total: 0,
          previousTotal: 0,
          byStatus: {
            [TICKET_STATUS.New]: 0,

            [TICKET_STATUS.Processing]: 0,

            [TICKET_STATUS.Open]: 0,
            [TICKET_STATUS.Resolved]: 0,
            [TICKET_STATUS.Closed]: 0,
          },
          openUnassigned: 0,
          settledShare: 0,
        },
        volume: [],
        categories: [],
        workload: [],
        unassigned: {
          total: 0,
          [TICKET_STATUS.New]: 0,

          [TICKET_STATUS.Processing]: 0,

          [TICKET_STATUS.Open]: 0,
          [TICKET_STATUS.Resolved]: 0,
          [TICKET_STATUS.Closed]: 0,
        },
        topCustomers: [],
        needsAttention: [],
      }),
    });
    mockEffectivenessGet.mockResolvedValue({
      data: effectiveness({
        classified: 0,
        autoReply: { resolved: 0, rate: null },
        decline: {
          count: 0,
          rate: null,
          reasons: Object.fromEntries(
            AUTO_REPLY_DECLINES.map((d) => [d, 0]),
          ) as Record<AutoReplyDecline, number>,
        },
        categoryOverride: { count: 0, rate: null },
      }),
    });
    renderDashboard();
    expect(await screen.findByText("Needs attention")).toBeInTheDocument();
    expect(screen.getByText("Nothing waiting. Inbox zero.")).toBeInTheDocument();
    expect(
      screen.getByText("No tickets were classified in this range."),
    ).toBeInTheDocument();
  });
});
