import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ARCHITECTURE_EDGES,
  ARCHITECTURE_NODE,
  ARCHITECTURE_NODES,
  RAILWAY_FRAME,
  SHARED_PACKAGES_NOTE,
} from "@/lib/how-it-works/architecture";
import { HOW_IT_WORKS_LABEL } from "@/lib/how-it-works/dom";
import { ArchitectureView } from "./ArchitectureView";

const ARCHITECTURE_LIST_LABEL = HOW_IT_WORKS_LABEL.architectureList;
const DETAILS_LABEL = HOW_IT_WORKS_LABEL.details;

const titleOf = (id: string) =>
  ARCHITECTURE_NODES.find((node) => node.id === id)!.title;

describe("ArchitectureView's hidden list", () => {
  function items() {
    render(<ArchitectureView />);
    const list = screen.getByRole("list", { name: ARCHITECTURE_LIST_LABEL });
    return within(list)
      .getAllByRole("listitem")
      .filter((item) => item.parentElement === list);
  }

  it("is an ordered list carrying every box in the data's order, then the frame and the note", () => {
    const rows = items();
    const list = rows[0].parentElement!;
    expect(list.tagName).toBe("OL");
    expect(rows).toHaveLength(ARCHITECTURE_NODES.length + 2);

    ARCHITECTURE_NODES.forEach((node, index) => {
      expect(rows[index]).toHaveTextContent(node.title);
      expect(rows[index]).toHaveTextContent(node.explanation);
    });
    expect(rows.at(-2)).toHaveTextContent(RAILWAY_FRAME.title);
    expect(rows.at(-2)).toHaveTextContent(RAILWAY_FRAME.explanation);
    expect(rows.at(-1)).toHaveTextContent(SHARED_PACKAGES_NOTE.title);
    expect(rows.at(-1)).toHaveTextContent(SHARED_PACKAGES_NOTE.text);
  });

  it("names every connection under the box it starts from", () => {
    const rows = items();
    for (const edge of ARCHITECTURE_EDGES) {
      const index = ARCHITECTURE_NODES.findIndex((n) => n.id === edge.from);
      expect(rows[index]).toHaveTextContent(
        `${edge.label} to ${titleOf(edge.to)}`,
      );
    }
  });

  it("is visually hidden", () => {
    render(<ArchitectureView />);
    expect(
      screen.getByRole("list", { name: ARCHITECTURE_LIST_LABEL }),
    ).toHaveClass("sr-only");
  });
});

describe("ArchitectureView's panel", () => {
  it("shows the explanation of the box that was selected", () => {
    render(<ArchitectureView />);
    const panel = screen.getByRole("region", { name: DETAILS_LABEL });
    const api = ARCHITECTURE_NODES.find(
      (node) => node.id === ARCHITECTURE_NODE.api,
    )!;
    expect(panel).not.toHaveTextContent(api.explanation);

    // A click alone, not `userEvent`: its mousedown reaches d3-zoom, which
    // reads `event.view`, and jsdom leaves that null.
    fireEvent.click(screen.getByRole("button", { name: api.title }));

    expect(panel).toHaveTextContent(api.title);
    expect(panel).toHaveTextContent(api.explanation);
    expect(screen.getByRole("button", { name: api.title })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
