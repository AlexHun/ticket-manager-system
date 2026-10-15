import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ROUTE } from "@/lib/routes";
import { AppErrorBoundary } from "./AppErrorBoundary";

function Broken(): never {
  throw new Error("render failed");
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AppErrorBoundary", () => {
  test("says what failed, then what to do about it", () => {
    // React logs the caught render error; it is the expected path here.
    vi.spyOn(console, "error").mockImplementation(() => {});
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
    vi.spyOn(console, "error").mockImplementation(() => {});
    // jsdom cannot navigate, so a stand-in location records where the
    // button sent the page. A full load is the point: the boundary may be
    // catching a broken router, which a router navigation would reuse.
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

    expect(location.href).toBe(ROUTE.dashboard.path);
  });
});
