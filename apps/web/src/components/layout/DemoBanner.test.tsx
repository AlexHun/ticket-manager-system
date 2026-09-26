import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { USER_ROLE } from "@ticket/shared";
import { renderRoutes } from "@/test/render";
import { ROUTE } from "@/lib/routes";
import { DemoBanner } from "./DemoBanner";

const auth = vi.hoisted(() => ({
  user: {} as Record<string, unknown>,
  signOut: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: { signOut: auth.signOut },
  useSession: () => ({
    data: { user: auth.user },
    isPending: false,
    refetch: auth.refetch,
  }),
}));

const DEMO_VISITOR = {
  id: "demo-1",
  name: "Demo visitor",
  role: USER_ROLE.agent,
  isAnonymous: true,
};

function renderBanner() {
  return renderRoutes([
    { path: "/", element: <DemoBanner /> },
    { path: ROUTE.login.path, element: <h1>Login page</h1> },
  ]);
}

beforeEach(() => {
  auth.user = DEMO_VISITOR;
  auth.signOut.mockReset().mockResolvedValue({ data: { success: true } });
  auth.refetch.mockReset().mockResolvedValue(undefined);
});

describe("DemoBanner", () => {
  test("says this is a demo and that its data resets every night", () => {
    renderBanner();

    const banner = screen.getByRole("region", { name: "Demo session" });
    expect(banner).toHaveTextContent(/demo/i);
    expect(banner).toHaveTextContent(/resets every night/i);
  });

  // R13 is a demo's banner. A colleague — an agent or an admin — never sees it.
  test.each([
    { role: USER_ROLE.agent, isAnonymous: false },
    { role: USER_ROLE.admin, isAnonymous: false },
  ])("is absent for a $role who is not a demo", (user) => {
    auth.user = { id: "u-1", name: "Colleague", ...user };

    renderBanner();

    expect(
      screen.queryByRole("region", { name: "Demo session" }),
    ).not.toBeInTheDocument();
  });

  test("Exit demo signs out and lands on the login page", async () => {
    const { router } = renderBanner();

    await userEvent.click(screen.getByRole("button", { name: "Exit demo" }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(ROUTE.login.path),
    );
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    // Settled before the navigation, for the reason `useSignOut` gives.
    expect(auth.refetch).toHaveBeenCalledTimes(1);
  });
});
