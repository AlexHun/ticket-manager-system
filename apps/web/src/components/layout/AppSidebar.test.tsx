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
import { renderWithQuery } from "@/test/render";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";

// --- Mocks ------------------------------------------------------------------

const mockUnreadGet = vi.fn();
const mockViewsGet = vi.fn();
// `useNewFeatureStatus` mounts alongside this and needs an answer too, even
// in tests that don't care about it — an unresolved query here would leave
// it pending forever and could log an act() warning.
const mockNewFeaturesGet = vi.fn();
const mockNewFeaturesPost = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    get: (url: string, ...rest: unknown[]) => {
      if (url === "/api/tickets/unread") return mockUnreadGet(url, ...rest);
      if (url === "/api/new-features/status") return mockNewFeaturesGet(url, ...rest);
      return mockViewsGet(url, ...rest);
    },
    post: (url: string, ...rest: unknown[]) => mockNewFeaturesPost(url, ...rest),
  },
}));

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
  return renderWithQuery(
    <SidebarProvider>
      <AppSidebar />
    </SidebarProvider>,
  );
}

beforeEach(() => {
  mockUnreadGet.mockReset();
  mockViewsGet.mockReset();
  mockNewFeaturesGet.mockReset();
  mockNewFeaturesPost.mockReset();
  mockViewsGet.mockResolvedValue(zeroViewCounts());
  mockNewFeaturesGet.mockResolvedValue(newFeatureStatuses());
  mockNewFeaturesPost.mockResolvedValue({ data: { ok: true } });
});

describe("AppSidebar unread badge", () => {
  test("shows nothing on Tickets while there are no unread assignments", async () => {
    mockUnreadGet.mockResolvedValueOnce(unread([]));
    renderSidebar();

    await waitFor(() => expect(mockUnreadGet).toHaveBeenCalled());
    expect(screen.queryByText("0", { selector: '[data-slot="sidebar-menu-badge"]' })).not.toBeInTheDocument();
  });

  test("badges Tickets with the unread count", async () => {
    mockUnreadGet.mockResolvedValueOnce(
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
    mockNewFeaturesGet.mockResolvedValueOnce(
      newFeatureStatuses({ [NEW_FEATURE_KEY.activityPage]: true }),
    );
    renderSidebar();

    expect(await screen.findByTestId("new-feature-badge")).toHaveTextContent("New");
  });

  test("shows no badge once the badge has been seen", async () => {
    mockNewFeaturesGet.mockResolvedValueOnce(
      newFeatureStatuses({ [NEW_FEATURE_KEY.activityPage]: false }),
    );
    renderSidebar();

    await waitFor(() => expect(mockNewFeaturesGet).toHaveBeenCalled());
    expect(screen.queryByTestId("new-feature-badge")).not.toBeInTheDocument();
  });

  test("marks the feature seen when the user follows the link", async () => {
    mockNewFeaturesGet.mockResolvedValueOnce(
      newFeatureStatuses({ [NEW_FEATURE_KEY.activityPage]: true }),
    );
    const user = userEvent.setup();
    renderSidebar();

    const link = await screen.findByRole("link", { name: "Activity" });
    await user.click(link);

    await waitFor(() =>
      expect(mockNewFeaturesPost).toHaveBeenCalledWith(
        `/api/new-features/${NEW_FEATURE_KEY.activityPage}/seen`,
      ),
    );
  });

  test("does not post seen for a link with no badge showing", async () => {
    mockNewFeaturesGet.mockResolvedValueOnce(
      newFeatureStatuses({ [NEW_FEATURE_KEY.activityPage]: false }),
    );
    const user = userEvent.setup();
    renderSidebar();

    await waitFor(() => expect(mockNewFeaturesGet).toHaveBeenCalled());
    const link = await screen.findByRole("link", { name: "Activity" });
    await user.click(link);

    expect(mockNewFeaturesPost).not.toHaveBeenCalled();
  });
});
