import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  BRAND_NAME,
  EVAL_HEALTH,
  NEW_FEATURE_KEY,
  NEW_FEATURE_KEYS,
  TICKET_EVENT,
  TICKET_VIEWS,
  USER_ROLE,
  type EvalHealth,
  type EvalStatusResponse,
  type NewFeatureKey,
  type NewFeatureStatusResponse,
  type TicketUnreadResponse,
  type TicketView,
  type TicketViewCountsResponse,
} from "@ticket/shared";
import { applyEvent } from "@/lib/realtime-events";
import { apiStub } from "@/test/api-stub";
import { renderRoutes } from "@/test/render";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";

// --- Mocks ------------------------------------------------------------------

const unreadGet = apiStub.get("/api/tickets/unread");
const viewsGet = apiStub.get("/api/tickets/views");
// `useNewFeatureStatus` mounts alongside this and needs an answer too, even
// in tests that don't care about it — an unresolved query here would leave
// it pending forever and could log an act() warning.
const newFeaturesGet = apiStub.get("/api/new-features/status");
const newFeatureSeenPost = apiStub.post("/api/new-features/:featureKey/seen");
const evalStatusGet = apiStub.get("/api/evals/status");

vi.mock("@/lib/api", () => import("@/test/api-stub"));

// Admin by default, not agent: the "new" badge tests below target the Activity
// nav item, which is admin-only — the unread-badge tests above don't care about
// role since Tickets has none, so widening this doesn't touch their assertions.
// The navigation tests swap the user per case.
const ADMIN_USER = {
  id: "admin-1",
  name: "Ada Admin",
  role: USER_ROLE.admin,
  isAnonymous: false,
};
const session = vi.hoisted(() => ({ user: {} as Record<string, unknown> }));

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: { user: session.user }, isPending: false }),
}));

function unread(tickets: TicketUnreadResponse["tickets"]) {
  return { data: { tickets } satisfies TicketUnreadResponse };
}

function zeroViewCounts() {
  const counts = Object.fromEntries(
    TICKET_VIEWS.map((view) => [view, 0]),
  ) as Record<TicketView, number>;
  return { data: { counts } satisfies TicketViewCountsResponse };
}

function newFeatureStatuses(
  overrides: Partial<Record<NewFeatureKey, boolean>> = {},
) {
  const statuses = Object.fromEntries(
    NEW_FEATURE_KEYS.map((key) => [key, overrides[key] ?? false]),
  ) as Record<NewFeatureKey, boolean>;
  return { data: { statuses } satisfies NewFeatureStatusResponse };
}

function evalStatus(health: EvalHealth | null) {
  return { data: { health } satisfies EvalStatusResponse };
}

function renderSidebar() {
  return renderRoutes([
    {
      path: "/",
      element: (
        <SidebarProvider>
          <AppSidebar />
        </SidebarProvider>
      ),
    },
  ]);
}

// Every endpoint the sidebar reaches gets a resting answer, and each test then
// overrides the one it is about. The stub refuses an unregistered request
// rather than resolving `undefined`, so a query left unanswered here would now
// fail loudly in a test that has no opinion about it — which is the point, but
// only once the quiet ones are declared.
beforeEach(() => {
  session.user = ADMIN_USER;
  apiStub.reset();
  unreadGet.mockResolvedValue(unread([]));
  viewsGet.mockResolvedValue(zeroViewCounts());
  newFeaturesGet.mockResolvedValue(newFeatureStatuses());
  newFeatureSeenPost.mockResolvedValue({ data: { ok: true } });
  evalStatusGet.mockResolvedValue(evalStatus(null));
});

describe("AppSidebar brand", () => {
  // R4/R5: the lockup's letters are drawn, not read, so the link carries the
  // name itself — in both states, since collapsed it shows only an "F".
  test("the brand link is named after the product and leads to the dashboard", () => {
    renderSidebar();

    const brand = screen.getByRole("link", { name: BRAND_NAME });
    expect(brand).toHaveAttribute("href", "/");
  });

  test("keeps its name with the sidebar collapsed", () => {
    renderRoutes([
      {
        path: "/",
        element: (
          <SidebarProvider defaultOpen={false}>
            <AppSidebar />
          </SidebarProvider>
        ),
      },
    ]);

    expect(screen.getByRole("link", { name: BRAND_NAME })).toBeInTheDocument();
  });
});

describe("AppSidebar navigation", () => {
  const SHOWCASE = [
    "Knowledge base",
    "Pipeline",
    "Evals",
    "Activity",
    "Tutorials",
  ];
  const PRIVATE = ["Team", "Outbox"];

  function navLinks(): string[] {
    return screen.getAllByRole("link").map((link) => link.textContent ?? "");
  }

  test("an admin sees every admin screen", () => {
    renderSidebar();

    for (const label of [...SHOWCASE, ...PRIVATE]) {
      expect(navLinks()).toContain(label);
    }
  });

  // R3: the showcase screens come from `isAnonymous`, and the role is agent.
  test("a demo session sees the showcase screens and not Team or Outbox", () => {
    session.user = {
      id: "demo-1",
      name: "Demo visitor",
      role: USER_ROLE.agent,
      isAnonymous: true,
    };
    renderSidebar();

    for (const label of SHOWCASE) expect(navLinks()).toContain(label);
    for (const label of PRIVATE) expect(navLinks()).not.toContain(label);
  });

  test("an agent sees none of them", () => {
    session.user = {
      id: "agent-1",
      name: "Aaron Agent",
      role: USER_ROLE.agent,
      isAnonymous: false,
    };
    renderSidebar();

    for (const label of [...SHOWCASE, ...PRIVATE]) {
      expect(navLinks()).not.toContain(label);
    }
  });
});

describe("AppSidebar unread badge", () => {
  test("shows nothing on Tickets while there are no unread assignments", async () => {
    unreadGet.mockResolvedValueOnce(unread([]));
    renderSidebar();

    await waitFor(() => expect(unreadGet).toHaveBeenCalled());
    expect(
      screen.queryByText("0", { selector: '[data-slot="sidebar-menu-badge"]' }),
    ).not.toBeInTheDocument();
  });

  test("badges Tickets with the unread count", async () => {
    unreadGet.mockResolvedValueOnce(
      unread([
        { id: 1, subject: "Cannot log in" },
        { id: 2, subject: "Refund request" },
      ]),
    );
    renderSidebar();

    expect(await screen.findByText("2")).toBeInTheDocument();
  });
});

// The Activity nav item is the demo/first flagged key — see nav-items.ts.
describe("AppSidebar new-feature badge", () => {
  test("badges Activity 'New' while its badge is unseen", async () => {
    newFeaturesGet.mockResolvedValueOnce(
      newFeatureStatuses({ [NEW_FEATURE_KEY.activityPage]: true }),
    );
    renderSidebar();

    expect(await screen.findByTestId("new-feature-badge")).toHaveTextContent(
      "New",
    );
  });

  test("shows no badge once the badge has been seen", async () => {
    newFeaturesGet.mockResolvedValueOnce(
      newFeatureStatuses({ [NEW_FEATURE_KEY.activityPage]: false }),
    );
    renderSidebar();

    await waitFor(() => expect(newFeaturesGet).toHaveBeenCalled());
    expect(screen.queryByTestId("new-feature-badge")).not.toBeInTheDocument();
  });

  test("marks the feature seen when the user follows the link", async () => {
    newFeaturesGet.mockResolvedValueOnce(
      newFeatureStatuses({ [NEW_FEATURE_KEY.activityPage]: true }),
    );
    const user = userEvent.setup();
    renderSidebar();

    const link = await screen.findByRole("link", { name: "Activity" });
    await user.click(link);

    await waitFor(() =>
      expect(newFeatureSeenPost).toHaveBeenCalledWith(
        `/api/new-features/${NEW_FEATURE_KEY.activityPage}/seen`,
      ),
    );
  });

  test("does not post seen for a link with no badge showing", async () => {
    newFeaturesGet.mockResolvedValueOnce(
      newFeatureStatuses({ [NEW_FEATURE_KEY.activityPage]: false }),
    );
    const user = userEvent.setup();
    renderSidebar();

    await waitFor(() => expect(newFeaturesGet).toHaveBeenCalled());
    const link = await screen.findByRole("link", { name: "Activity" });
    await user.click(link);

    expect(newFeatureSeenPost).not.toHaveBeenCalled();
  });
});

describe("AppSidebar eval mark (#608)", () => {
  const FAILING = /below a threshold/i;
  const DEFECT = /planted payload/i;

  function marks() {
    return screen.queryAllByRole("img", { name: /eval run/i });
  }

  test("marks Evals failing while the latest frozen run is below a threshold", async () => {
    evalStatusGet.mockResolvedValue(evalStatus(EVAL_HEALTH.failing));
    renderSidebar();

    const mark = await screen.findByRole("img", { name: FAILING });
    expect(mark).toHaveTextContent("Failing");
    expect(mark.closest("li")).toHaveTextContent("Evals");
    expect(mark).not.toHaveClass("bg-status-critical-soft");
  });

  test("marks an escape with the critical mark instead", async () => {
    evalStatusGet.mockResolvedValue(evalStatus(EVAL_HEALTH.escaped));
    renderSidebar();

    const mark = await screen.findByRole("img", { name: DEFECT });
    expect(mark).toHaveTextContent("Defect");
    expect(mark).toHaveClass("bg-status-critical-soft");
    expect(screen.queryByRole("img", { name: FAILING })).toBeNull();
  });

  test.each([EVAL_HEALTH.passing, null])(
    "draws no mark when the status is %s",
    async (health) => {
      evalStatusGet.mockResolvedValue(evalStatus(health));
      renderSidebar();

      await waitFor(() => expect(evalStatusGet).toHaveBeenCalled());
      await screen.findByRole("link", { name: "Evals" });
      expect(marks()).toEqual([]);
    },
  );

  test("updates when a run finishes, without a reload", async () => {
    evalStatusGet.mockResolvedValueOnce(evalStatus(EVAL_HEALTH.passing));
    evalStatusGet.mockResolvedValueOnce(evalStatus(EVAL_HEALTH.failing));
    const { queryClient } = renderSidebar();
    await waitFor(() => expect(evalStatusGet).toHaveBeenCalledTimes(1));
    expect(marks()).toEqual([]);

    applyEvent(queryClient, {
      kind: TICKET_EVENT.eval_run_changed,
      runId: 7,
      at: new Date().toISOString(),
    });

    expect(await screen.findByRole("img", { name: FAILING })).toBeVisible();
  });

  test("an agent never asks, and never sees the mark", async () => {
    session.user = {
      id: "agent-1",
      name: "Aaron Agent",
      role: USER_ROLE.agent,
      isAnonymous: false,
    };
    evalStatusGet.mockResolvedValue(evalStatus(EVAL_HEALTH.escaped));
    renderSidebar();

    await waitFor(() => expect(viewsGet).toHaveBeenCalled());
    expect(evalStatusGet).not.toHaveBeenCalled();
    expect(marks()).toEqual([]);
  });
});
