import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TICKET_STATUS } from "@ticket/shared";
import {
  LIFECYCLE_NOTES,
  LIFECYCLE_STEP,
  LIFECYCLE_STEPS,
  NO_TICKET_YET,
  lifecycleLane,
  lifecycleStep,
} from "@/lib/how-it-works/lifecycle";
import {
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
