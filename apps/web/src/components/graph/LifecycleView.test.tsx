import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TICKET_STATUS } from "@ticket/shared";
import {
  LIFECYCLE_EDGES,
  LIFECYCLE_NOTES,
  LIFECYCLE_STEP,
  LIFECYCLE_STEPS,
  NO_TICKET_YET,
  edgesInto,
  lifecycleLane,
  lifecycleStep,
} from "@/lib/how-it-works/lifecycle";
import {
  GRAPH_EDGE_ATTRIBUTE,
  GRAPH_EMPHASIS_ATTRIBUTE,
  GRAPH_NODE_ATTRIBUTE,
  GRAPH_STATUS_STRIP_ATTRIBUTE,
  GRAPH_STATUS_TAG_ATTRIBUTE,
  HOW_IT_WORKS_LABEL,
} from "@/lib/how-it-works/dom";
import { LifecycleView } from "./LifecycleView";

describe("LifecycleView's drawing", () => {
  it("tags every step with the Status the data gives it", () => {
    const { container } = render(<LifecycleView />);
    for (const step of LIFECYCLE_STEPS) {
      const box = container.querySelector(
        `[${GRAPH_NODE_ATTRIBUTE}="${step.id}"]`,
      )!;
      const tag = box.querySelector(`[${GRAPH_STATUS_TAG_ATTRIBUTE}]`)!;
      expect(tag.getAttribute(GRAPH_STATUS_TAG_ATTRIBUTE), step.id).toBe(
        step.status ?? "",
      );
      expect(tag).toHaveTextContent(step.status ?? NO_TICKET_YET);
    }
  });

  it("draws all five Statuses in the strip", () => {
    const { container } = render(<LifecycleView />);
    const strip = container.querySelector(`[${GRAPH_STATUS_STRIP_ATTRIBUTE}]`)!;
    for (const status of Object.values(TICKET_STATUS)) {
      expect(strip).toHaveTextContent(status);
    }
  });
});

describe("LifecycleView's hidden list", () => {
  function items() {
    render(<LifecycleView />);
    const list = screen.getByRole("list", {
      name: HOW_IT_WORKS_LABEL.lifecycleList,
    });
    expect(list.tagName).toBe("OL");
    expect(list).toHaveClass("sr-only");
    return within(list)
      .getAllByRole("listitem")
      .filter((item) => item.parentElement === list);
  }

  it("carries every step in the data's order, with its lane, Status and explanation", () => {
    const rows = items();
    expect(rows).toHaveLength(LIFECYCLE_STEPS.length);
    LIFECYCLE_STEPS.forEach((step, index) => {
      expect(rows[index]).toHaveTextContent(step.title);
      expect(rows[index]).toHaveTextContent(lifecycleLane(step.lane).title);
      expect(rows[index]).toHaveTextContent(step.status ?? NO_TICKET_YET);
      expect(rows[index]).toHaveTextContent(step.explanation);
    });
  });

  it("names both arms of a fork under the step it forks from", () => {
    const rows = items();
    const claim = LIFECYCLE_STEPS.findIndex(
      (s) => s.id === LIFECYCLE_STEP.claim,
    );
    expect(rows[claim]).toHaveTextContent(
      `Then: ${lifecycleStep(LIFECYCLE_STEP.autoReplySent).title}, or ${lifecycleStep(LIFECYCLE_STEP.declineHandoff).title}`,
    );
  });

  it("puts each note under the step it qualifies", () => {
    const rows = items();
    for (const note of LIFECYCLE_NOTES) {
      const index = LIFECYCLE_STEPS.findIndex((s) => s.id === note.step);
      expect(rows[index]).toHaveTextContent(note.text);
    }
  });
});

describe("LifecycleView's stepping", () => {
  const next = () =>
    screen.getByRole("button", { name: HOW_IT_WORKS_LABEL.nextStep });
  const previous = () =>
    screen.getByRole("button", { name: HOW_IT_WORKS_LABEL.previousStep });
  const canvas = () =>
    screen.getByRole("group", { name: HOW_IT_WORKS_LABEL.lifecycleCanvas });
  const panel = () =>
    screen.getByRole("region", { name: HOW_IT_WORKS_LABEL.details });
  const emphasis = (container: HTMLElement, attribute: string, id: string) =>
    container
      .querySelector(`[${attribute}="${id}"]`)!
      .getAttribute(GRAPH_EMPHASIS_ATTRIBUTE);

  it("starts on no step: Previous is disabled, nothing is dimmed", () => {
    const { container } = render(<LifecycleView />);
    expect(previous()).toBeDisabled();
    expect(next()).toBeEnabled();
    expect(container.querySelector(`[${GRAPH_EMPHASIS_ATTRIBUTE}]`)).toBeNull();
  });

  it("Next N times lands on the data's Nth step, its title in the panel", () => {
    render(<LifecycleView />);
    for (let n = 1; n <= 3; n++) fireEvent.click(next());
    const third = LIFECYCLE_STEPS[2]!;
    expect(panel()).toHaveTextContent(third.title);
    expect(screen.getByRole("button", { name: third.title })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("highlights the step and the edges into it, and dims the rest", () => {
    const { container } = render(<LifecycleView />);
    // The fifth step, Auto-reply sent, has one edge in, from the Claim.
    for (let n = 1; n <= 5; n++) fireEvent.click(next());
    const current = LIFECYCLE_STEPS[4]!;
    for (const step of LIFECYCLE_STEPS) {
      expect(emphasis(container, GRAPH_NODE_ATTRIBUTE, step.id), step.id).toBe(
        step.id === current.id ? "current" : "dimmed",
      );
    }
    const into = edgesInto(current.id).map((edge) => edge.id);
    expect(into).toHaveLength(1);
    for (const edge of LIFECYCLE_EDGES) {
      expect(emphasis(container, GRAPH_EDGE_ATTRIBUTE, edge.id), edge.id).toBe(
        into.includes(edge.id) ? "current" : "dimmed",
      );
    }
  });

  it("disables Previous on the first step and Next on the last", () => {
    render(<LifecycleView />);
    fireEvent.click(next());
    expect(previous()).toBeDisabled();
    for (let n = 1; n < LIFECYCLE_STEPS.length; n++) {
      expect(next()).toBeEnabled();
      fireEvent.click(next());
    }
    expect(next()).toBeDisabled();
    expect(previous()).toBeEnabled();
    expect(panel()).toHaveTextContent(LIFECYCLE_STEPS.at(-1)!.title);
  });

  it("walks with the arrow keys while the canvas has focus", () => {
    render(<LifecycleView />);
    expect(canvas()).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(canvas(), { key: "ArrowRight" });
    fireEvent.keyDown(canvas(), { key: "ArrowRight" });
    expect(panel()).toHaveTextContent(LIFECYCLE_STEPS[1]!.title);
    fireEvent.keyDown(canvas(), { key: "ArrowLeft" });
    expect(panel()).toHaveTextContent(LIFECYCLE_STEPS[0]!.title);
    // Back from the first step goes nowhere.
    fireEvent.keyDown(canvas(), { key: "ArrowLeft" });
    expect(panel()).toHaveTextContent(LIFECYCLE_STEPS[0]!.title);
  });

  it("walks on from a step that was clicked", () => {
    render(<LifecycleView />);
    const claim = lifecycleStep(LIFECYCLE_STEP.claim);
    fireEvent.click(screen.getByRole("button", { name: claim.title }));
    fireEvent.click(next());
    const index = LIFECYCLE_STEPS.findIndex((s) => s.id === claim.id);
    expect(panel()).toHaveTextContent(LIFECYCLE_STEPS[index + 1]!.title);
  });

  it("marks the current step in the hidden list with aria-current", () => {
    render(<LifecycleView />);
    fireEvent.click(next());
    fireEvent.click(next());
    const list = screen.getByRole("list", {
      name: HOW_IT_WORKS_LABEL.lifecycleList,
    });
    const rows = within(list)
      .getAllByRole("listitem")
      .filter((item) => item.parentElement === list);
    rows.forEach((row, index) => {
      if (index === 1) expect(row).toHaveAttribute("aria-current", "step");
      else expect(row).not.toHaveAttribute("aria-current");
    });
  });
});

describe("LifecycleView's panel", () => {
  it("explains the step that was selected, with its Status and its note", () => {
    render(<LifecycleView />);
    const panel = screen.getByRole("region", {
      name: HOW_IT_WORKS_LABEL.details,
    });
    const claim = lifecycleStep(LIFECYCLE_STEP.claim);
    const note = LIFECYCLE_NOTES.find((n) => n.step === claim.id)!;
    expect(panel).not.toHaveTextContent(claim.explanation);

    // A click alone, not `userEvent`: its mousedown reaches d3-zoom, which
    // reads `event.view`, and jsdom leaves that null.
    fireEvent.click(screen.getByRole("button", { name: claim.title }));

    expect(panel).toHaveTextContent(claim.title);
    expect(panel).toHaveTextContent(TICKET_STATUS.Processing);
    expect(panel).toHaveTextContent(claim.explanation);
    expect(panel).toHaveTextContent(note.text);
    expect(screen.getByRole("button", { name: claim.title })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
