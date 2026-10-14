import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AppErrorBoundary } from "./AppErrorBoundary";

function Broken(): never {
  throw new Error("render failed");
}

afterEach(() => {
  vi.restoreAllMocks();
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
});
