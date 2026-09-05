import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  NEW_FEATURE_KEY,
  NEW_FEATURE_KEYS,
  TICKET_VIEWS,
  USER_ROLE,
  type NewFeatureKey,
  type NewFeatureStatusResponse,
  type TicketUnreadResponse,
  type TicketView,
  type TicketViewCountsResponse,
} from "@ticket/shared";
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

vi.mock("@/lib/api", () => import("@/test/api-stub"));

// Admin, not agent: the "new" badge tests below target the Activity nav item,
// which is admin-only — the unread-badge tests above don't care about role
// since Tickets has none, so widening this doesn't touch their assertions.
vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({
    data: { user: { id: "admin-1", name: "Ada Admin", role: USER_ROLE.admin } },
    isPending: false,
  }),
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

function newFeatureStatuses(overrides: Partial<Record<NewFeatureKey, boolean>> = {}) {
  const statuses = Object.fromEntries(
    NEW_FEATURE_KEYS.map((key) => [key, overrides[key] ?? false]),
  ) as Record<NewFeatureKey, boolean>;
  return { data: { statuses } satisfies NewFeatureStatusResponse };
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
  apiStub.reset();
  unreadGet.mockResolvedValue(unread([]));
  viewsGet.mockResolvedValue(zeroViewCounts());
  newFeaturesGet.mockResolvedValue(newFeatureStatuses());
  newFeatureSeenPost.mockResolvedValue({ data: { ok: true } });
});

describe("AppSidebar unread badge", () => {
  test("shows nothing on Tickets while there are no unread assignments", async () => {
    unreadGet.mockResolvedValueOnce(unread([]));
    renderSidebar();

    await waitFor(() => expect(unreadGet).toHaveBeenCalled());
    expect(screen.queryByText("0", { selector: '[data-slot="sidebar-menu-badge"]' })).not.toBeInTheDocument();
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

    expect(await screen.findByTestId("new-feature-badge")).toHaveTextContent("New");
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
