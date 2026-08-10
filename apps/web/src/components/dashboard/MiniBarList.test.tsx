import type { ReactElement } from "react";
import { render as rtlRender, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MiniBarList } from "./MiniBarList";

/**
 * These render without `renderWithQuery` on purpose: MiniBarList takes plain
 * props and touches neither the router nor the query client, and wrapping it in
 * providers it does not use would hide that.
 *
 * The single exception is TooltipProvider. Each row label is a `Hint` — the
 * 8rem column truncates it, and hovering reveals the whole name — and Radix
 * throws rather than degrades when no provider is above it.
 */
function render(ui: ReactElement) {
  return rtlRender(<TooltipProvider>{ui}</TooltipProvider>);
}

const rows = [
  { label: "Technical", value: 10 },
  { label: "General", value: 5 },
  { label: "Refund", value: 0 },
];

/** The proportional fill inside each row, as a percentage width string. */
function barWidths(): string[] {
  return screen
    .getAllByRole("listitem")
    .map(
      (li) =>
        (li.querySelector("span[style*='width']") as HTMLElement | null)?.style
          .width ?? "",
    );
}

describe("MiniBarList", () => {
  test("renders a row per datum with its label and value", () => {
    render(<MiniBarList title="By category" rows={rows} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(within(items[0]).getByText("Technical")).toBeInTheDocument();
    expect(within(items[0]).getByText("10")).toBeInTheDocument();
  });

  /**
   * Every row carrying its own number is what licenses this panel to ship with
   * no axis and no tooltip — it is the relief channel, not a nicety.
   */
  test("labels every value directly", () => {
    render(<MiniBarList title="By category" rows={rows} />);
    for (const row of rows) {
      expect(screen.getByText(String(row.value))).toBeInTheDocument();
    }
  });

  test("scales bars against the largest row, not the total", () => {
    render(<MiniBarList title="By category" rows={rows} />);
    // 10 is the max, so it is full width and 5 is half — a total-based scale
    // would have made these 67% and 33%.
    expect(barWidths()).toEqual(["100%", "50%", "0%"]);
  });

  test("shows the empty message when every row is zero", () => {
    render(
      <MiniBarList
        title="Workload"
        rows={[{ label: "Ann", value: 0 }]}
        emptyMessage="Nothing assigned."
      />,
    );
    expect(screen.getByText("Nothing assigned.")).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  test("shows the empty message when there are no rows at all", () => {
    render(<MiniBarList title="Workload" rows={[]} />);
    expect(screen.getByText("Nothing in this range.")).toBeInTheDocument();
  });

  /** A single non-zero row must not divide by zero or blow past 100%. */
  test("handles a lone row without dividing by zero", () => {
    render(<MiniBarList title="Solo" rows={[{ label: "Only", value: 3 }]} />);
    expect(barWidths()).toEqual(["100%"]);
  });

  test("renders the optional note beside a row", () => {
    render(
      <MiniBarList
        title="Workload"
        rows={[{ label: "Ann", value: 5, note: "2 open" }]}
      />,
    );
    expect(screen.getByText("2 open")).toBeInTheDocument();
  });

  test("uses a per-row fill when given one", () => {
    render(
      <MiniBarList
        title="Age"
        rows={[{ label: "> 7d", value: 1, fill: "var(--viz-ord-4)" }]}
      />,
    );
    const bar = screen
      .getByRole("listitem")
      .querySelector("span[style*='width']") as HTMLElement;
    expect(bar.style.backgroundColor).toBe("var(--viz-ord-4)");
  });

  test("renders the title and optional subtitle", () => {
    render(
      <MiniBarList title="By category" subtitle="Including unfiled" rows={rows} />,
    );
    expect(screen.getByText("By category")).toBeInTheDocument();
    expect(screen.getByText("Including unfiled")).toBeInTheDocument();
  });
});
