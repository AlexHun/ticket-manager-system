import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ADMIN_SCREEN, USER_ROLE } from "@ticket/shared";
import { renderRoutes } from "@/test/render";
import { ROUTE } from "@/lib/routes";
import { AdminScreenRoute, adminScreen } from "./AdminScreenRoute";

const session = vi.hoisted(() => ({ user: {} as Record<string, unknown> }));

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: { user: session.user }, isPending: false }),
}));

const ADMIN = { id: "admin-1", role: USER_ROLE.admin, isAnonymous: false };
const AGENT = { id: "agent-1", role: USER_ROLE.agent, isAnonymous: false };
// What the anonymous plugin mints (ADR-0022): the agent role, never admin.
const DEMO = { id: "demo-1", role: USER_ROLE.agent, isAnonymous: true };

/**
 * The gate as `App.tsx` mounts it: Users, which `DEMO_SEES_ADMIN_SCREEN` keeps
 * from a demo, the knowledge base, which it opens, and one route that names no
 * screen at all. The dashboard is here so a redirect has somewhere visible to
 * land.
 */
function renderAt(path: string) {
  return renderRoutes(
    [
      { path: ROUTE.dashboard.path, element: <p>dashboard</p> },
      {
        Component: AdminScreenRoute,
        children: [
          {
            path: ROUTE.users.path,
            handle: adminScreen(ADMIN_SCREEN.users),
            element: <p>users page</p>,
          },
          {
            path: ROUTE.knowledge.path,
            handle: adminScreen(ADMIN_SCREEN.knowledge),
            element: <p>knowledge page</p>,
          },
          { path: ROUTE.outbox.path, element: <p>unnamed page</p> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
}

beforeEach(() => {
  session.user = ADMIN;
});

describe("AdminScreenRoute", () => {
  test("an admin passes on a screen a demo is kept from", () => {
    renderAt(ROUTE.users.path);
    expect(screen.getByText("users page")).toBeInTheDocument();
  });

  test("an admin passes on a screen a demo sees", () => {
    renderAt(ROUTE.knowledge.path);
    expect(screen.getByText("knowledge page")).toBeInTheDocument();
  });

  // R3: a typed URL to Users or Outbox is not found, not a redirect that
  // would hint the page exists.
  test("a demo session gets the not-found page on a screen it is kept from", () => {
    session.user = DEMO;
    renderAt(ROUTE.users.path);

    expect(
      screen.getByRole("heading", { name: "No such page" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("users page")).not.toBeInTheDocument();
  });

  test("a demo session passes on a screen it sees", () => {
    session.user = DEMO;
    renderAt(ROUTE.knowledge.path);
    expect(screen.getByText("knowledge page")).toBeInTheDocument();
  });

  // Nothing defaults to open (#368): a route that names no screen is shut to
  // a demo, as an admin route added to the API is.
  test("a demo session is kept from a route that names no screen", () => {
    session.user = DEMO;
    renderAt(ROUTE.outbox.path);

    expect(
      screen.getByRole("heading", { name: "No such page" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("unnamed page")).not.toBeInTheDocument();
  });

  test("an agent is still sent to the dashboard from any screen", () => {
    session.user = AGENT;
    renderAt(ROUTE.knowledge.path);
    expect(screen.getByText("dashboard")).toBeInTheDocument();
  });
});
