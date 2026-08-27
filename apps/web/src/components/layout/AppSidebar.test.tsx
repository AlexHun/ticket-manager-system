import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  TICKET_VIEWS,
  USER_ROLE,
  type TicketUnreadResponse,
  type TicketView,
  type TicketViewCountsResponse,
} from "@ticket/shared";
import { renderWithQuery } from "@/test/render";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";

// --- Mocks ------------------------------------------------------------------

const mockUnreadGet = vi.fn();
// `SidebarViews` mounts alongside this and fetches its own counts — a fake
// that never resolves would leave that query pending forever and could log
// an act() warning, so it gets an answer even though no test here reads it.
const mockViewsGet = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    get: (url: string, ...rest: unknown[]) =>
      url === "/api/tickets/unread"
        ? mockUnreadGet(url, ...rest)
        : mockViewsGet(url, ...rest),
  },
}));

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({
    data: { user: { id: "agent-1", name: "Aaron Agent", role: USER_ROLE.agent } },
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
  mockViewsGet.mockResolvedValue(zeroViewCounts());
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
