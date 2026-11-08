import { screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { autoReplyCaseById, type AutoReplyCase } from "@ticket/core";
import {
  AUTO_REPLY_DECLINE,
  PIPELINE_OUTCOME,
  TICKET_STATUS,
  type CaseJudgement,
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

/** What the API judged, defaulting to a run that landed where it said. */
function judged(overrides: Partial<CaseJudgement> = {}): CaseJudgement {
  return { matched: true, escaped: false, caught: false, ...overrides };
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
    judgement: judged(),
    ...overrides,
  };
}

const declinedNotCovered = {
  outcome: PIPELINE_OUTCOME.declined,
  decline: AUTO_REPLY_DECLINE.notCovered,
  citedArticleIds: [],
};

const declinedByMoneyCheck = {
  outcome: PIPELINE_OUTCOME.declined,
  decline: AUTO_REPLY_DECLINE.unbackedCommitment,
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

/** Every sentence the judgement can draw, so its absence is checkable. */
function verdictLines(scenario: AutoReplyCase) {
  return [
    screen.queryByText(RUN_VERDICT.matched),
    screen.queryByText(RUN_VERDICT.escaped),
    screen.queryByText(RUN_VERDICT.caught),
    mismatchEndingWith(scenario.mismatchNote ?? RUN_VERDICT.drifted),
  ];
}

/**
 * The page draws the judgement the API sent and judges nothing itself (#746):
 * each run below carries a judgement its outcome alone would not produce, so a
 * page that worked the rule out again would draw the other line.
 */
describe("PipelineRunVerdict — draws the judgement the API sent (#723, #746)", () => {
  test("a matched run says it landed where the scenario said", () => {
    const scenario = caseNamed("off-corpus");
    // `off-corpus` expects a decline, so only the judgement makes this a match.
    renderVerdict(answered({ judgement: judged() }), scenario);

    expect(screen.getByText(RUN_VERDICT.matched)).toBeInTheDocument();
    expect(mismatchEndingWith(RUN_VERDICT.drifted)).toBeNull();
  });

  test("a run that missed reads the drift note when its scenario has none", () => {
    const scenario = caseNamed("off-corpus");
    renderVerdict(
      answered({
        ...declinedNotCovered,
        judgement: judged({ matched: false }),
      }),
      scenario,
    );

    expect(mismatchEndingWith(RUN_VERDICT.drifted)).toBeInTheDocument();
    expect(screen.queryByText(RUN_VERDICT.matched)).toBeNull();
  });

  test.each(["planted-commitment", "hostile-display-name"])(
    "an escape reads as one, never as a match (%s)",
    (id) => {
      renderVerdict(
        answered({ judgement: judged({ matched: false, escaped: true }) }),
        caseNamed(id),
      );

      expect(screen.getByText(RUN_VERDICT.escaped)).toBeInTheDocument();
      expect(screen.queryByText(RUN_VERDICT.matched)).toBeNull();
    },
  );

  test("a declined payload case the API found caught says so", () => {
    const scenario = caseNamed("planted-commitment");
    const { unmount } = renderVerdict(
      answered({
        ...declinedByMoneyCheck,
        judgement: judged({ caught: true }),
      }),
      scenario,
    );

    expect(screen.getByText(RUN_VERDICT.matched)).toBeInTheDocument();
    expect(screen.getByText(RUN_VERDICT.caught)).toBeInTheDocument();
    unmount();

    // The same decline, judged not caught: the line is the API's answer.
    renderVerdict(
      answered({ ...declinedByMoneyCheck, judgement: judged() }),
      scenario,
    );
    expect(screen.getByText(RUN_VERDICT.matched)).toBeInTheDocument();
    expect(screen.queryByText(RUN_VERDICT.caught)).toBeNull();
  });

  test("a run the API has not judged, in flight or with no scenario, has no verdict line", () => {
    const scenario = caseNamed("planted-commitment");
    // What `GET /runs/:id` sends for a run still in flight: no judgement yet.
    const run = answered({
      outcome: PIPELINE_OUTCOME.pending,
      judgement: null,
    });
    const { unmount } = renderVerdict(run, scenario);

    // The card itself rendered, so the empty lines below are an absence.
    expect(screen.getByText(run.subject)).toBeInTheDocument();
    expect(verdictLines(scenario)).toEqual([null, null, null, null]);
    unmount();

    renderVerdict(answered({ judgement: null }), null);
    expect(screen.getByText(run.subject)).toBeInTheDocument();
    expect(verdictLines(scenario)).toEqual([null, null, null, null]);
  });
});
