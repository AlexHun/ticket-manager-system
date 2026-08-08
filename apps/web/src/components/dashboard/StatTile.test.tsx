import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { StatTile } from "./StatTile";
import { KPI_STATUS } from "./StatusPill";

/**
 * `src/test/setup.ts` answers `matches: true` to `prefers-reduced-motion`, so
 * `useCountUp` settles immediately and these assert final values rather than
 * animation frames. That is deliberate — a test that waited for a count-up
 * would be timing-dependent for no coverage gain.
 */

/**
 * The value is deliberately rendered twice — an `aria-hidden` copy that may hold
 * mid-animation frames, and an `sr-only` copy that is always the truth. So these
 * are read by role rather than by text, or every assertion matches both.
 */
function visibleValue(container: HTMLElement): string {
  return container.querySelector('[aria-hidden="true"]')?.textContent ?? "";
}

function announcedValue(container: HTMLElement): string {
  return container.querySelector(".sr-only")?.textContent ?? "";
}

describe("StatTile", () => {
  test("renders the label and value", () => {
    const { container } = render(<StatTile label="Open" value={24} />);
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(visibleValue(container)).toBe("24");
  });

  test("prefers a preformatted display over the numeric value", () => {
    const { container } = render(
      <StatTile label="Median first reply" value={6} display="6.0h" />,
    );
    expect(visibleValue(container)).toBe("6.0h");
    expect(announcedValue(container)).toBe("6.0h");
  });

  test("renders no status pill when the number is unremarkable", () => {
    render(<StatTile label="Created" value={51} />);
    expect(screen.queryByText("Backlog high")).not.toBeInTheDocument();
  });

  test("renders the pill's word, not just its colour", () => {
    render(
      <StatTile
        label="Open"
        value={24}
        status={KPI_STATUS.critical}
        statusLabel="Backlog high"
      />,
    );
    expect(screen.getByText("Backlog high")).toBeInTheDocument();
  });

  /**
   * The contract that matters: state must never be carried by colour alone, so
   * the pill's word has to reach the accessible name too.
   */
  test("exposes the state to assistive tech alongside the true value", () => {
    const { container } = render(
      <StatTile
        label="Open"
        value={24}
        status={KPI_STATUS.critical}
        statusLabel="Backlog high"
      />,
    );
    expect(announcedValue(container)).toBe("24, Backlog high");
  });

  test("exposes the true value with no state suffix when there is no pill", () => {
    const { container } = render(<StatTile label="Created" value={51} />);
    expect(announcedValue(container)).toBe("51");
  });

  test("tints the number for states that mean act on this", () => {
    const { container } = render(
      <StatTile
        label="Open"
        value={24}
        status={KPI_STATUS.critical}
        statusLabel="Backlog high"
      />,
    );
    expect(container.querySelector(".text-status-critical")).toBeInTheDocument();
  });

  /**
   * `good` deliberately does not tint the value — a dashboard where the healthy
   * case is also coloured has no quiet state left to contrast against.
   */
  test("leaves the number untinted for the good state", () => {
    const { container } = render(
      <StatTile
        label="Settled"
        display="90%"
        status={KPI_STATUS.good}
        statusLabel="On track"
      />,
    );
    expect(screen.getByText("On track")).toBeInTheDocument();
    expect(container.querySelector(".text-status-good")?.tagName).toBe("SPAN");
    expect(
      container.querySelector("p.text-status-good"),
    ).not.toBeInTheDocument();
  });

  test("renders a delta badge with its direction", () => {
    render(<StatTile label="Created" value={51} delta={4} />);
    expect(screen.getByText(/versus the previous period/)).toBeInTheDocument();
  });

  test("renders the sub line", () => {
    render(<StatTile label="Open" value={24} sub="13 unassigned" />);
    expect(screen.getByText("13 unassigned")).toBeInTheDocument();
  });
});
