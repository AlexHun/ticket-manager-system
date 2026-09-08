import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { ChartCard } from "./ChartCard";

/**
 * Issue #123: the table twin is the chart's accessibility-relief path, so it
 * has to be reachable by keyboard like the five desk tables (`TableFrame`,
 * issue #111) — not a bare `overflow-auto` div.
 */
describe("ChartCard", () => {
  test("shows the table twin in a keyboard-operable named region", async () => {
    const user = userEvent.setup();
    render(
      <ChartCard title="Tickets created" table={<p>table body</p>}>
        <p>chart body</p>
      </ChartCard>,
    );

    await user.click(screen.getByRole("button", { name: "Show data table" }));

    const region = screen.getByRole("region", { name: "Tickets created" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(screen.getByText("table body")).toBeInTheDocument();
  });

  test("names the region from the card's own title, so two panels don't collide", async () => {
    const user = userEvent.setup();
    render(
      <ChartCard title="Time to first reply" table={<p>table body</p>}>
        <p>chart body</p>
      </ChartCard>,
    );

    await user.click(screen.getByRole("button", { name: "Show data table" }));

    expect(
      screen.getByRole("region", { name: "Time to first reply" }),
    ).toBeInTheDocument();
  });
});
