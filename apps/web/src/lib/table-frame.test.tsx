import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderRoutes } from "@/test/render";
import { TableFrame } from "@/lib/table-frame";

/**
 * The convention issue #111 settled: a scroll container a keyboard can reach,
 * and never an anonymous tab stop. Asserted here rather than once per table so
 * a sixth call site inherits the guarantee by using the component.
 */
describe("TableFrame", () => {
  it("is a named region", () => {
    renderRoutes([
      {
        path: "/",
        element: (
          <TableFrame label="Users">
            <p>body</p>
          </TableFrame>
        ),
      },
    ]);

    expect(screen.getByRole("region", { name: "Users" })).toBeInTheDocument();
  });

  it("takes keyboard focus, so the scroller can be operated without a mouse", async () => {
    const user = userEvent.setup();
    renderRoutes([
      {
        path: "/",
        element: (
          <TableFrame label="Users">
            <p>body</p>
          </TableFrame>
        ),
      },
    ]);

    const frame = screen.getByRole("region", { name: "Users" });
    expect(frame).toHaveAttribute("tabindex", "0");

    await user.tab();
    expect(frame).toHaveFocus();
  });

  it("merges the call site's layout classes onto the frame's own", () => {
    renderRoutes([
      {
        path: "/",
        element: (
          <TableFrame label="Activity" className="min-h-0 flex-1">
            <p>body</p>
          </TableFrame>
        ),
      },
    ]);

    const frame = screen.getByRole("region", { name: "Activity" });
    expect(frame).toHaveClass("overflow-auto", "min-h-0", "flex-1");
  });

  it("passes the remaining props through, which is how the skeletons stay busy", () => {
    renderRoutes([
      {
        path: "/",
        element: (
          <TableFrame label="Loading users" aria-busy="true" data-tutorial-anchor="feed">
            <p>body</p>
          </TableFrame>
        ),
      },
    ]);

    const frame = screen.getByRole("region", { name: "Loading users" });
    expect(frame).toHaveAttribute("aria-busy", "true");
    expect(frame).toHaveAttribute("data-tutorial-anchor", "feed");
  });
});
