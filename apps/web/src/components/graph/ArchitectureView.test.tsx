import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ARCHITECTURE_EDGES,
  ARCHITECTURE_NODE,
  ARCHITECTURE_NODES,
  RAILWAY_FRAME,
  SHARED_PACKAGES_NOTE,
  architectureNode,
} from "@/lib/how-it-works/architecture";
import { HOW_IT_WORKS_LABEL } from "@/lib/how-it-works/dom";
import {
  DRILLABLE_BOXES,
  SUBSYSTEM,
  linkPhrase,
  partLabel,
  subsystem,
  subsystemsOf,
} from "@/lib/how-it-works/subsystems";
import { ArchitectureView } from "./ArchitectureView";

const ARCHITECTURE_LIST_LABEL = HOW_IT_WORKS_LABEL.architectureList;
const DETAILS_LABEL = HOW_IT_WORKS_LABEL.details;
const SUBSYSTEM_CANVAS_LABEL = HOW_IT_WORKS_LABEL.subsystemCanvas;

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
        `${edge.label} to ${architectureNode(edge.to).title}`,
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
    const postgres = architectureNode(ARCHITECTURE_NODE.postgres);
    expect(panel).not.toHaveTextContent(postgres.explanation);

    // A click alone, not `userEvent`: its mousedown reaches d3-zoom, which
    // reads `event.view`, and jsdom leaves that null.
    fireEvent.click(screen.getByRole("button", { name: postgres.title }));

    expect(panel).toHaveTextContent(postgres.title);
    expect(panel).toHaveTextContent(postgres.explanation);
    expect(
      screen.getByRole("button", { name: postgres.title }),
    ).toHaveAttribute("aria-pressed", "true");
    // Postgres opens onto nothing.
    expect(
      screen.queryByRole("group", { name: SUBSYSTEM_CANVAS_LABEL }),
    ).not.toBeInTheDocument();
  });
});

describe("ArchitectureView's subsystems", () => {
  const api = architectureNode(ARCHITECTURE_NODE.api);

  function openApi() {
    render(<ArchitectureView />);
    fireEvent.click(screen.getByRole("button", { name: api.title }));
    return screen.getByRole("group", { name: SUBSYSTEM_CANVAS_LABEL });
  }

  it("selecting the API opens every one of its subsystems and the parts they talk to", () => {
    const drawing = openApi();
    for (const subsystem of subsystemsOf(ARCHITECTURE_NODE.api)) {
      expect(
        within(drawing).getByRole("button", { name: subsystem.title }),
      ).toBeInTheDocument();
      for (const link of subsystem.links) {
        expect(
          within(drawing).getByRole("button", { name: partLabel(link.part) }),
        ).toBeInTheDocument();
      }
    }
    // The runtime boxes are put away, not drawn underneath.
    expect(
      screen.queryByRole("group", {
        name: HOW_IT_WORKS_LABEL.architectureCanvas,
      }),
    ).not.toBeInTheDocument();
    const panel = screen.getByRole("region", { name: DETAILS_LABEL });
    expect(panel).toHaveTextContent(api.explanation);
    expect(
      screen.getByRole("button", { name: HOW_IT_WORKS_LABEL.backToRuntime }),
    ).toHaveFocus();
  });

  it("selecting a subsystem explains it and names what it talks to", () => {
    const drawing = openApi();
    const ingestion = subsystem(SUBSYSTEM.ingestion);
    fireEvent.click(
      within(drawing).getByRole("button", { name: ingestion.title }),
    );
    const panel = screen.getByRole("region", { name: DETAILS_LABEL });
    expect(panel).toHaveTextContent(ingestion.explanation);
    for (const link of ingestion.links) {
      expect(panel).toHaveTextContent(linkPhrase(link));
    }
  });

  it.each([
    [
      "Back",
      () =>
        fireEvent.click(
          screen.getByRole("button", {
            name: HOW_IT_WORKS_LABEL.backToRuntime,
          }),
        ),
    ],
    [
      "Escape",
      () => fireEvent.keyDown(document.activeElement!, { key: "Escape" }),
    ],
  ])(
    "%s returns to the runtime boxes with the same box selected and focused",
    (_, leave) => {
      openApi();
      leave();
      expect(
        screen.queryByRole("group", { name: SUBSYSTEM_CANVAS_LABEL }),
      ).not.toBeInTheDocument();
      const box = screen.getByRole("button", { name: api.title });
      expect(box).toHaveAttribute("aria-pressed", "true");
      expect(box).toHaveFocus();
    },
  );

  it("Enter on the job workers opens their subsystems", () => {
    render(<ArchitectureView />);
    const workers = screen.getByRole("button", {
      name: architectureNode(ARCHITECTURE_NODE.jobWorkers).title,
    });
    workers.focus();
    fireEvent.keyDown(workers, { key: "Enter" });
    const drawing = screen.getByRole("group", { name: SUBSYSTEM_CANVAS_LABEL });
    for (const subsystem of subsystemsOf(ARCHITECTURE_NODE.jobWorkers)) {
      expect(
        within(drawing).getByRole("button", { name: subsystem.title }),
      ).toBeInTheDocument();
    }
  });

  it("are in the hidden list under the box they belong to", () => {
    render(<ArchitectureView />);
    const list = screen.getByRole("list", { name: ARCHITECTURE_LIST_LABEL });
    const rows = within(list)
      .getAllByRole("listitem")
      .filter((item) => item.parentElement === list);
    for (const box of DRILLABLE_BOXES) {
      const row = rows[ARCHITECTURE_NODES.findIndex((n) => n.id === box)]!;
      for (const subsystem of subsystemsOf(box)) {
        expect(row).toHaveTextContent(
          `${subsystem.title}: ${subsystem.explanation}`,
        );
        for (const link of subsystem.links) {
          expect(row).toHaveTextContent(linkPhrase(link));
        }
      }
    }
  });
});
