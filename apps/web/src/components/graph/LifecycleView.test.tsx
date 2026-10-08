import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TICKET_STATUS, USER_ROLE, type UserRole } from "@ticket/shared";
import { renderRoutes } from "@/test/render";
import { NAV_ITEMS } from "@/components/layout/nav-items";
import { ROUTE } from "@/lib/routes";
import {
  LIFECYCLE_EDGES,
  LIFECYCLE_NOTES,
  LIFECYCLE_STEP,
  LIFECYCLE_STEPS,
  NO_TICKET_YET,
  edgesInto,
  lifecycleLane,
  lifecycleStep,
  type LifecycleStepId,
} from "@/lib/how-it-works/lifecycle";
import {
  GRAPH_EDGE_ATTRIBUTE,
  GRAPH_EMPHASIS_ATTRIBUTE,
  GRAPH_NODE_ATTRIBUTE,
  GRAPH_SCREEN_ATTRIBUTE,
  GRAPH_STATUS_STRIP_ATTRIBUTE,
  GRAPH_STATUS_TAG_ATTRIBUTE,
  HOW_IT_WORKS_LABEL,
} from "@/lib/how-it-works/dom";
import { LifecycleView } from "./LifecycleView";

const session = vi.hoisted(() => ({
  user: { role: undefined as UserRole | undefined, isAnonymous: false },
}));
vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: { user: session.user }, isPending: false }),
}));

beforeEach(() => {
  session.user = { role: USER_ROLE.agent, isAnonymous: false };
});

/** The panel's screen link is a router `<Link>`, so the view mounts as a route. */
const mount = () => renderRoutes([{ path: "/", element: <LifecycleView /> }]);

describe("LifecycleView's drawing", () => {
  it("tags every step with the Status the data gives it", () => {
    const { container } = mount();
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
    const { container } = mount();
    const strip = container.querySelector(`[${GRAPH_STATUS_STRIP_ATTRIBUTE}]`)!;
    for (const status of Object.values(TICKET_STATUS)) {
      expect(strip).toHaveTextContent(status);
    }
  });
});

describe("LifecycleView's hidden list", () => {
  function items() {
    mount();
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
      expect(rows[index]).toHaveTextContent(
        `${HOW_IT_WORKS_LABEL.inTheCode}: ${step.code.join(", ")}`,
      );
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
    const { container } = mount();
    expect(previous()).toBeDisabled();
    expect(next()).toBeEnabled();
    expect(container.querySelector(`[${GRAPH_EMPHASIS_ATTRIBUTE}]`)).toBeNull();
  });

  it("Next N times lands on the data's Nth step, its title in the panel", () => {
    mount();
    for (let n = 1; n <= 3; n++) fireEvent.click(next());
    const third = LIFECYCLE_STEPS[2]!;
    expect(panel()).toHaveTextContent(third.title);
    expect(screen.getByRole("button", { name: third.title })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("highlights the step and the edges into it, and dims the rest", () => {
    const { container } = mount();
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
    mount();
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
    mount();
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
    mount();
    const claim = lifecycleStep(LIFECYCLE_STEP.claim);
    fireEvent.click(screen.getByRole("button", { name: claim.title }));
    fireEvent.click(next());
    const index = LIFECYCLE_STEPS.findIndex((s) => s.id === claim.id);
    expect(panel()).toHaveTextContent(LIFECYCLE_STEPS[index + 1]!.title);
  });

  it("marks the current step in the hidden list with aria-current", () => {
    mount();
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
    mount();
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

  it("lists the step's repo paths under In the code", () => {
    mount();
    const step = lifecycleStep(LIFECYCLE_STEP.agentReplies);
    fireEvent.click(screen.getByRole("button", { name: step.title }));
    const panel = screen.getByRole("region", {
      name: HOW_IT_WORKS_LABEL.details,
    });
    expect(panel).toHaveTextContent(HOW_IT_WORKS_LABEL.inTheCode);
    for (const path of step.code) {
      expect(within(panel).getByText(path)).toBeInTheDocument();
    }
  });

  /** Mounts the view, selects a step, and returns its "On screen" line, if any. */
  function screenLineOf(id: LifecycleStepId) {
    const { container } = mount();
    fireEvent.click(
      screen.getByRole("button", { name: lifecycleStep(id).title }),
    );
    return container.querySelector<HTMLElement>(`[${GRAPH_SCREEN_ATTRIBUTE}]`);
  }
  const navLabel = (path: string) =>
    NAV_ITEMS.find((item) => item.to === path)!.label;

  it("links an admin from Classification to the Pipeline page", () => {
    session.user = { role: USER_ROLE.admin, isAnonymous: false };
    const line = screenLineOf(LIFECYCLE_STEP.classification)!;
    expect(line).toHaveAttribute(GRAPH_SCREEN_ATTRIBUTE, ROUTE.pipeline.path);
    expect(within(line).getByRole("link")).toHaveAttribute(
      "href",
      ROUTE.pipeline.path,
    );
  });

  it("names the Pipeline page to an agent without linking to it", () => {
    const line = screenLineOf(LIFECYCLE_STEP.classification)!;
    expect(line).toHaveTextContent(navLabel(ROUTE.pipeline.path));
    expect(within(line).queryByRole("link")).not.toBeInTheDocument();
  });

  it("links a demo session to the showcase Pipeline page", () => {
    session.user = { role: USER_ROLE.agent, isAnonymous: true };
    const line = screenLineOf(LIFECYCLE_STEP.classification)!;
    expect(within(line).getByRole("link")).toHaveAttribute(
      "href",
      ROUTE.pipeline.path,
    );
  });

  it("links every viewer to the tickets from an agent's step", () => {
    const line = screenLineOf(LIFECYCLE_STEP.agentCloses)!;
    expect(within(line).getByRole("link")).toHaveAttribute(
      "href",
      ROUTE.tickets.path,
    );
  });

  it("names no screen for a step that has none", () => {
    expect(screenLineOf(LIFECYCLE_STEP.emailSent)).toBeNull();
  });
});
