import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { apiStub } from "@/test/api-stub";
import { createTestQueryClient } from "@/test/render";
import { RELEASE_PATH } from "@/lib/release-protocol";
import { releaseQueryOptions } from "@/lib/release-check";
import { ROUTE } from "@/lib/routes";
import { routes } from "@/App";
import { AppErrorBoundary, RethrowRouteError } from "./AppErrorBoundary";

vi.mock("@/lib/api", () => import("@/test/api-stub"));

// The dashboard's real path is "/", which a hard-coded literal would also
// hit. A path no literal in the component could match is what makes the
// navigation test fail if the button stops reading ROUTE.
vi.mock("@/lib/routes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/routes")>();
  return {
    ...actual,
    ROUTE: {
      ...actual.ROUTE,
      dashboard: { ...actual.ROUTE.dashboard, path: "/moved-dashboard" },
    },
  };
});

const RUNNING = "web@0.1.300+aaaaaaa";
const DEPLOYED = "web@0.1.301+bbbbbbb";

function Broken(): never {
  throw new Error("render failed");
}

/**
 * The boundary as `main.tsx` mounts it: inside the query client, since its
 * fallback asks the server which release it runs.
 */
function renderBoundary(children: ReactNode = <Broken />) {
  const client = createTestQueryClient();
  const result = render(
    <QueryClientProvider client={client}>
      <AppErrorBoundary>{children}</AppErrorBoundary>
    </QueryClientProvider>,
  );
  /**
   * Settles once the boundary holds the server's answer, and its effect has
   * run: a request counted is not yet a request answered, so waiting on the
   * stub's call count checks `reload` before the boundary could act.
   */
  const answered = (release: string) =>
    waitFor(() =>
      expect(client.getQueryData(releaseQueryOptions().queryKey)).toBe(release),
    );
  return { ...result, answered };
}

let releaseGet: ReturnType<typeof apiStub.get>;
let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // React logs the caught render error; it is the expected path here.
  vi.spyOn(console, "error").mockImplementation(() => {});
  apiStub.reset();
  releaseGet = apiStub.get(RELEASE_PATH);
  releaseGet.mockResolvedValue({ data: { release: RUNNING } });
  vi.stubEnv("VITE_SENTRY_RELEASE", RUNNING);
  sessionStorage.clear();
  // jsdom cannot navigate, so a stand-in location records what the page did.
  reload = vi.fn();
  vi.stubGlobal("location", { href: "/tickets/42", reload });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("AppErrorBoundary", () => {
  test("says what failed, then what to do about it", () => {
    renderBoundary();

    expect(screen.getByText("Couldn't show this page")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The details have been recorded. Try again, or go back to the dashboard.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Back to dashboard" }),
    ).toBeVisible();
  });

  test("goes back to the dashboard with a full page load", async () => {
    renderBoundary();

    await userEvent.click(
      screen.getByRole("button", { name: "Back to dashboard" }),
    );

    expect(ROUTE.dashboard.path).toBe("/moved-dashboard");
    expect(location.href).toBe(ROUTE.dashboard.path);
  });
});

describe("AppErrorBoundary after a deploy", () => {
  test("reloads by itself when the server runs another release", async () => {
    releaseGet.mockResolvedValue({ data: { release: DEPLOYED } });
    renderBoundary();

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  test("reloads once per release, so a crash that survives it stays on screen", async () => {
    releaseGet.mockResolvedValue({ data: { release: DEPLOYED } });
    const first = renderBoundary();
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    first.unmount();

    // The page after that reload, crashing again: same tab, same session.
    await renderBoundary().answered(DEPLOYED);
    expect(screen.getByText("Couldn't show this page")).toBeInTheDocument();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test("stays put while the server runs this tab's release", async () => {
    await renderBoundary().answered(RUNNING);

    expect(reload).not.toHaveBeenCalled();
  });
});

describe("RethrowRouteError", () => {
  test("hands a route's failed import to this boundary rather than the router's page", async () => {
    const router = createMemoryRouter([
      {
        ErrorBoundary: RethrowRouteError,
        children: [
          {
            path: "/",
            lazy: () =>
              Promise.reject(
                new TypeError("Failed to fetch dynamically imported module"),
              ),
          },
        ],
      },
    ]);
    renderBoundary(<RouterProvider router={router} />);

    expect(
      await screen.findByText("Couldn't show this page"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Unexpected Application Error!"),
    ).not.toBeInTheDocument();
  });

  test("is the root route's error boundary", () => {
    expect(routes[0].ErrorBoundary).toBe(RethrowRouteError);
  });
});
