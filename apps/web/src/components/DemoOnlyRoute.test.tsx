import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { USER_ROLE } from "@ticket/shared";
import { renderRoutes } from "@/test/render";
import { ROUTE } from "@/lib/routes";
import { DemoOnlyRoute } from "./DemoOnlyRoute";

const auth = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
  isPending: false,
}));

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({
    data: auth.user ? { user: auth.user } : null,
    isPending: auth.isPending,
  }),
}));

const ADMIN = { id: "admin-1", role: USER_ROLE.admin, isAnonymous: false };
const AGENT = { id: "agent-1", role: USER_ROLE.agent, isAnonymous: false };
// What the anonymous plugin mints (ADR-0022): the agent role, never admin.
const DEMO = { id: "demo-1", role: USER_ROLE.agent, isAnonymous: true };

/** The gate as `App.tsx` mounts it, around the welcome. */
function renderWelcome() {
  return renderRoutes(
    [
      { path: ROUTE.login.path, element: <p>login page</p> },
      {
        Component: DemoOnlyRoute,
        children: [{ path: ROUTE.welcome.path, element: <p>welcome page</p> }],
      },
    ],
    { initialEntries: [ROUTE.welcome.path] },
  );
}

beforeEach(() => {
  auth.user = DEMO;
  auth.isPending = false;
});

describe("DemoOnlyRoute", () => {
  test("a demo session passes", () => {
    renderWelcome();
    expect(screen.getByText("welcome page")).toBeInTheDocument();
  });

  // R10: a colleague who types the address is told nothing is there, not
  // redirected somewhere that would say the page exists.
  test.each([
    ["an admin", ADMIN],
    ["an agent", AGENT],
  ])("%s gets the not-found page", (_who, user) => {
    auth.user = user;
    const { router } = renderWelcome();

    expect(
      screen.getByRole("heading", { name: "No such page" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("welcome page")).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe(ROUTE.welcome.path);
  });

  test("decides nothing while the session is pending", () => {
    auth.isPending = true;
    renderWelcome();

    expect(screen.queryByText("welcome page")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "No such page" }),
    ).not.toBeInTheDocument();
  });

  test("a signed-out visitor is sent to the login page", () => {
    auth.user = null;
    renderWelcome();
    expect(screen.getByText("login page")).toBeInTheDocument();
  });
});
