import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { USER_ROLE } from "@ticket/shared";
import { renderRoutes } from "@/test/render";
import { ROUTE } from "@/lib/routes";
import { AdminRoute, AdminViewRoute } from "./AdminRoute";

const session = vi.hoisted(() => ({ user: {} as Record<string, unknown> }));

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: { user: session.user }, isPending: false }),
}));

const ADMIN = { id: "admin-1", role: USER_ROLE.admin, isAnonymous: false };
const AGENT = { id: "agent-1", role: USER_ROLE.agent, isAnonymous: false };
// What the anonymous plugin mints (ADR-0022): the agent role, never admin.
const DEMO = { id: "demo-1", role: USER_ROLE.agent, isAnonymous: true };

/**
 * The two gates as `App.tsx` mounts them: Users behind the strict one, the
 * knowledge base behind the one a demo session passes. The dashboard is here so
 * a redirect has somewhere visible to land.
 */
function renderAt(path: string) {
  return renderRoutes(
    [
      { path: ROUTE.dashboard.path, element: <p>dashboard</p> },
      {
        Component: AdminRoute,
        children: [{ path: ROUTE.users.path, element: <p>users page</p> }],
      },
      {
        Component: AdminViewRoute,
        children: [
          { path: ROUTE.knowledge.path, element: <p>knowledge page</p> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
}

beforeEach(() => {
  session.user = ADMIN;
});

describe("AdminRoute and AdminViewRoute", () => {
  test("an admin passes the strict gate", () => {
    renderAt(ROUTE.users.path);
    expect(screen.getByText("users page")).toBeInTheDocument();
  });

  test("an admin passes the showcase gate", () => {
    renderAt(ROUTE.knowledge.path);
    expect(screen.getByText("knowledge page")).toBeInTheDocument();
  });

  // R3: a typed URL to Users or Outbox is not found, not a redirect that
  // would hint the page exists.
  test("a demo session gets the not-found page at the strict gate", () => {
    session.user = DEMO;
    renderAt(ROUTE.users.path);

    expect(
      screen.getByRole("heading", { name: "No such page" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("users page")).not.toBeInTheDocument();
  });

  test("a demo session passes the showcase gate", () => {
    session.user = DEMO;
    renderAt(ROUTE.knowledge.path);
    expect(screen.getByText("knowledge page")).toBeInTheDocument();
  });

  test("an agent is still sent to the dashboard from either gate", () => {
    session.user = AGENT;
    renderAt(ROUTE.knowledge.path);
    expect(screen.getByText("dashboard")).toBeInTheDocument();
  });
});
