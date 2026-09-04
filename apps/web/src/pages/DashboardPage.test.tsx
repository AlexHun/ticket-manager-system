import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  AGE_BUCKET,
  AUTO_REPLY_DECLINES,
  DASHBOARD_BUCKET,
  DASHBOARD_RANGE,
  DASHBOARD_SCOPE,
  DEFAULT_DASHBOARD_LAYOUT,
  DEFAULT_DASHBOARD_RANGE,
  LATENCY_BUCKET,
  TICKET_CATEGORY,
  TICKET_STATUS,
  USER_ROLE,
  type AssistantEffectivenessResponse,
  type AutoReplyDecline,
  type DashboardLayoutResponse,
  type TicketStatsResponse,
} from "@ticket/shared";
import { apiStub } from "@/test/api-stub";
import { renderRoutes } from "@/test/render";
import { DashboardPage } from "./DashboardPage";

// --- Mocks ----------------------------------------------------------------

vi.mock("@/lib/api", () => import("@/test/api-stub"));

// One handle per endpoint, which is what the page needs: the three GETs have
// to be controllable separately, or a test that fails one silently drags the
// others' fixtures into an incompatible shape. The `<Tutorial>` mounted on
// this page is answered by the stub's own default.
const statsGet = apiStub.get("/api/tickets/stats");
const effectivenessGet = apiStub.get("/api/tickets/effectiveness");
const layoutGet = apiStub.get("/api/dashboard-layout");
const layoutPut = apiStub.put("/api/dashboard-layout");
const layoutDelete = apiStub.delete("/api/dashboard-layout");

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

/**
 * On the real router, at the page's own path — as a navigation would match it.
 * Without `dashboardLoader`: that loader reaches the module-level query client
 * directly, which is #157's problem to solve, and this file is about the page.
 */
function renderDashboard() {
  return renderRoutes([{ path: "/", Component: DashboardPage }], {
    initialEntries: ["/"],
  });
}

function layoutResponse(
  over: Partial<DashboardLayoutResponse> = {},
): DashboardLayoutResponse {
  return { layout: DEFAULT_DASHBOARD_LAYOUT, isDefault: true, ...over };
}

beforeEach(() => {
  apiStub.reset();
  statsGet.mockResolvedValue({ data: stats() });
  effectivenessGet.mockResolvedValue({ data: effectiveness() });
  layoutGet.mockResolvedValue({ data: layoutResponse() });
  // Echoes the saved layout back, same contract as the real route (`PUT`
  // returns exactly what it just wrote) — a canned response here would
  // silently overwrite the optimistic reorder/resize once the mutation
  // "succeeds", masking the very behaviour these tests check.
  layoutPut.mockImplementation((_url, body) => {
    const { layout } = body as { layout: unknown };
    return Promise.resolve({ data: { layout, isDefault: false } });
  });
  layoutDelete.mockResolvedValue({ data: layoutResponse() });
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
    statsGet.mockResolvedValue({
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
      expect(statsGet).toHaveBeenCalledWith(
        "/api/tickets/stats",
        expect.objectContaining({
          params: expect.objectContaining({ range: DEFAULT_DASHBOARD_RANGE }),
        }),
      ),
    );
    await waitFor(() =>
      expect(effectivenessGet).toHaveBeenCalledWith(
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
      expect(statsGet).toHaveBeenCalledWith(
        "/api/tickets/stats",
        expect.objectContaining({
          params: expect.objectContaining({ range: DASHBOARD_RANGE.d7 }),
        }),
      ),
    );
    await waitFor(() =>
      expect(effectivenessGet).toHaveBeenCalledWith(
        "/api/tickets/effectiveness",
        expect.objectContaining({
          params: expect.objectContaining({ range: DASHBOARD_RANGE.d7 }),
        }),
      ),
    );
  });

  test("shows an error instead of panels when the request fails", async () => {
    statsGet.mockRejectedValue(new Error("boom"));
    renderDashboard();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("Tickets created")).not.toBeInTheDocument();
  });

  test("renders an empty slice without crashing", async () => {
    statsGet.mockResolvedValue({
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
    effectivenessGet.mockResolvedValue({
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

/**
 * Panel personalization (issue #102), as wiring only.
 *
 * What a command does to the placement array — the swap, the width step, and
 * every boundary that makes one a no-op — is decided by pure functions and
 * asserted directly in `@/lib/dashboard-panels.test.ts`, which renders
 * nothing. What is left for this file is that the page hands those functions
 * the layout it is showing and sends what they return to the server, and that
 * `panelCapabilities` is what reaches each button's `disabled`.
 *
 * Real pointer drag is still not exercised here — jsdom has no layout geometry
 * for `@dnd-kit` to compute drop targets from — so mouse reordering is covered
 * by the Playwright E2E suite instead; the button path below is the actual
 * keyboard-operable equivalent and ends in the same `save`.
 */
describe("DashboardPage customize mode", () => {
  test("hides the per-panel controls until customize mode is entered", async () => {
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByText("Tickets created");

    expect(
      screen.queryByRole("button", { name: "Move Ticket volume later" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Customize" }));

    expect(
      screen.getByRole("button", { name: "Move Ticket volume later" }),
    ).toBeInTheDocument();
  });

  /**
   * One panel at each boundary, one control each — enough to prove the flags
   * arrive per-panel and per-command rather than as a page-wide state. Which
   * positions and widths count as a boundary is the unit tests' business.
   */
  test("disables the commands the panel's capabilities refuse", async () => {
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByText("Tickets created");
    await user.click(screen.getByRole("button", { name: "Customize" }));

    // First panel in the default layout; Status mix starts narrow and Top
    // customers starts wide.
    expect(
      screen.getByRole("button", { name: "Move Ticket volume earlier" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Shrink Status mix" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Grow Top customers" }),
    ).toBeDisabled();

    expect(
      screen.getByRole("button", { name: "Move Ticket volume later" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Grow Status mix" }),
    ).toBeEnabled();
  });

  /** Spelled out rather than computed with `applyPanelCommand`: the claim is
   * that the page passed the layout it is showing to the right command and
   * saved the result, which an expectation built from that same function could
   * not fail to satisfy. */
  test("sends the layout a command produces to the server", async () => {
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByText("Tickets created");
    await user.click(screen.getByRole("button", { name: "Customize" }));

    await user.click(
      screen.getByRole("button", { name: "Move Ticket volume later" }),
    );

    await waitFor(() =>
      expect(layoutPut).toHaveBeenCalledWith("/api/dashboard-layout", {
        layout: [
          DEFAULT_DASHBOARD_LAYOUT[1],
          DEFAULT_DASHBOARD_LAYOUT[0],
          ...DEFAULT_DASHBOARD_LAYOUT.slice(2),
        ],
      }),
    );
  });

  test("offers reset only once the layout has been customized, and resets it", async () => {
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByText("Tickets created");
    await user.click(screen.getByRole("button", { name: "Customize" }));

    expect(
      screen.queryByRole("button", { name: "Reset to default" }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Move Ticket volume later" }),
    );
    expect(
      await screen.findByRole("button", { name: "Reset to default" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reset to default" }));

    await waitFor(() => expect(layoutDelete).toHaveBeenCalledWith(
      "/api/dashboard-layout",
    ));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Reset to default" }),
      ).not.toBeInTheDocument(),
    );
  });
});
