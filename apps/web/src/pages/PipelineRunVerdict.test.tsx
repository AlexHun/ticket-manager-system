import { screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { autoReplyCaseById, type AutoReplyCase } from "@ticket/core";
import {
  AUTO_REPLY_DECLINE,
  PIPELINE_OUTCOME,
  TICKET_STATUS,
  type PipelineRun,
} from "@ticket/shared";
import { RUN_VERDICT } from "@/lib/pipeline-labels";
import { renderRoutes } from "@/test/render";
import { PipelineRunVerdict } from "./PipelineRunVerdict";

function caseNamed(id: string): AutoReplyCase {
  const evalCase = autoReplyCaseById(id);
  if (evalCase === null) throw new Error(`No case named ${id}`);
  return evalCase;
}

/** A ticket the assistant answered, as `GET /runs/:id` reports it. */
function answered(overrides: Partial<PipelineRun> = {}): PipelineRun {
  return {
    ticketId: 7,
    subject: "Password reset link keeps expiring",
    customerName: "Sofia Eriksson",
    status: TICKET_STATUS.Resolved,
    category: null,
    createdAt: "2026-11-02T09:00:00.000Z",
    outcome: PIPELINE_OUTCOME.resolved,
    decline: null,
    declinedAt: null,
    citedArticleIds: ["KB-004"],
    stages: [],
    escaped: false,
    ...overrides,
  };
}

const declinedNotCovered = {
  outcome: PIPELINE_OUTCOME.declined,
  decline: AUTO_REPLY_DECLINE.notCovered,
  citedArticleIds: [],
};

function renderVerdict(run: PipelineRun, scenario: AutoReplyCase | null) {
  return renderRoutes([
    {
      path: "/",
      element: (
        <PipelineRunVerdict
          run={run}
          scenario={scenario}
          stalled={false}
          pipelineLive
        />
      ),
    },
  ]);
}

/**
 * The verdict line on a mismatch, found by the note it ends on. The line
 * opens with the expected and reached keys, so it is matched by its end
 * rather than by a substring that could sit anywhere in the card.
 */
function mismatchEndingWith(note: string) {
  return screen.queryByText(
    (_, element) =>
      element?.tagName === "P" && (element.textContent ?? "").endsWith(note),
  );
}

/** Every sentence the verdict line can be, so its absence is checkable. */
function verdictLines(scenario: AutoReplyCase) {
  return [
    screen.queryByText(RUN_VERDICT.matched),
    screen.queryByText(RUN_VERDICT.escaped),
    mismatchEndingWith(scenario.mismatchNote ?? RUN_VERDICT.drifted),
  ];
}

describe("PipelineRunVerdict — judged by the rule /evals counts by (#723)", () => {
  test("a payload case answered without its payload matches", () => {
    const scenario = caseNamed("planted-commitment");
    renderVerdict(answered(), scenario);

    expect(screen.getByText(RUN_VERDICT.matched)).toBeInTheDocument();
    expect(mismatchEndingWith(scenario.mismatchNote!)).toBeNull();
  });

  test.each(["planted-commitment", "hostile-display-name"])(
    "a payload case whose reply carried a marker is an escape, never a match (%s)",
    (id) => {
      renderVerdict(answered({ escaped: true }), caseNamed(id));

      expect(screen.getByText(RUN_VERDICT.escaped)).toBeInTheDocument();
      expect(screen.queryByText(RUN_VERDICT.matched)).toBeNull();
    },
  );

  test("a payload case declined for another reason reads its own note", () => {
    const scenario = caseNamed("planted-commitment");
    renderVerdict(answered(declinedNotCovered), scenario);

    expect(mismatchEndingWith(scenario.mismatchNote!)).toBeInTheDocument();
    expect(screen.queryByText(RUN_VERDICT.matched)).toBeNull();
  });

  test("an ordinary case is judged as before", () => {
    const scenario = caseNamed("off-corpus");
    const { unmount } = renderVerdict(answered(), scenario);

    expect(mismatchEndingWith(RUN_VERDICT.drifted)).toBeInTheDocument();
    expect(screen.queryByText(RUN_VERDICT.matched)).toBeNull();
    unmount();

    renderVerdict(answered(declinedNotCovered), scenario);
    expect(screen.getByText(RUN_VERDICT.matched)).toBeInTheDocument();
  });

  test("a run still in flight, or with no scenario, has no verdict line", () => {
    const scenario = caseNamed("planted-commitment");
    const run = answered({ outcome: PIPELINE_OUTCOME.pending });
    const { unmount } = renderVerdict(run, scenario);

    // The card itself rendered, so the empty lines below are an absence.
    expect(screen.getByText(run.subject)).toBeInTheDocument();
    expect(verdictLines(scenario)).toEqual([null, null, null]);
    unmount();

    renderVerdict(answered(), null);
    expect(screen.getByText(run.subject)).toBeInTheDocument();
    expect(verdictLines(scenario)).toEqual([null, null, null]);
  });
});
