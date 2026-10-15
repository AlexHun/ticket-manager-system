import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ROUTE } from "@/lib/routes";
import { AppErrorBoundary } from "./AppErrorBoundary";

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

function Broken(): never {
  throw new Error("render failed");
}

beforeEach(() => {
  // React logs the caught render error; it is the expected path here.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AppErrorBoundary", () => {
  test("says what failed, then what to do about it", () => {
    render(
      <AppErrorBoundary>
        <Broken />
      </AppErrorBoundary>,
    );

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
    // jsdom cannot navigate, so a stand-in location records where the
    // button sent the page.
    const location = { href: "/tickets/42" };
    vi.stubGlobal("location", location);
    render(
      <AppErrorBoundary>
        <Broken />
      </AppErrorBoundary>,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Back to dashboard" }),
    );

    expect(ROUTE.dashboard.path).toBe("/moved-dashboard");
    expect(location.href).toBe(ROUTE.dashboard.path);
  });
});
