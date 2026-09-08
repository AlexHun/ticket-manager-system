import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  EVAL_CORPUS,
  EVAL_RUN_STATUS,
  PIPELINE_OUTCOME,
  USER_ROLE,
  type EvalCaseResultRow,
  type EvalRunRow,
  type EvalRunsResponse,
} from "@ticket/shared";
import { apiStub } from "@/test/api-stub";
import { renderRoutes } from "@/test/render";
import { EvalsPage } from "./EvalsPage";

/**
 * The evals screen.
 *
 * Three things it is responsible for and nothing else can be: a result row that
 * reports a **rate** rather than a pass (a row that only said "failed" would be
 * the thing this page exists to replace, and a row that said "passed" over five
 * repeats that split 3/2 would be worse); a corpus said out loud on every run,
 * because frozen and live are two series that are never averaged; and a Run
 * button that is unavailable on a deployment with no key rather than one that
 * always fails.
 */

vi.mock("@/lib/api", () => import("@/test/api-stub"));

const runsGet = apiStub.get("/api/evals/runs");
const runsPost = apiStub.post("/api/evals/runs");

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({
    data: { user: { name: "Adele Admin", role: USER_ROLE.admin } },
    isPending: false,
  }),
  authClient: { signOut: vi.fn() },
}));

// --- Fixtures ---------------------------------------------------------------

function makeResult(
  overrides: Partial<EvalCaseResultRow> = {},
): EvalCaseResultRow {
  return {
    id: 1,
    caseId: "off-corpus",
    caseName: "Nothing in the corpus covers it",
    adversarial: false,
    expectedOutcome: PIPELINE_OUTCOME.declined,
    expectedDecline: "notCovered",
    repeats: 5,
    matches: 5,
    abandoned: 0,
    usd: 0.0012,
    cachedRepeats: 4,
    reached: [
      {
        outcome: PIPELINE_OUTCOME.declined,
        decline: "notCovered",
        count: 5,
        matched: true,
      },
    ],
    ...overrides,
  };
}

function makeRun(overrides: Partial<EvalRunRow> = {}): EvalRunRow {
  return {
    id: 7,
    corpus: EVAL_CORPUS.frozen,
    status: EVAL_RUN_STATUS.completed,
    startedAt: "2026-09-09T10:00:00.000Z",
    finishedAt: "2026-09-09T10:00:20.000Z",
    error: null,
    repeats: 5,
    attempts: 5,
    matches: 5,
    abandoned: 0,
    usd: 0.0012,
    cachedRepeats: 4,
    cacheable: 4,
    results: [makeResult()],
    ...overrides,
  };
}

function response(overrides: Partial<EvalRunsResponse> = {}): {
  data: EvalRunsResponse;
} {
  return {
    data: { evalConfigured: true, runs: [makeRun()], ...overrides },
  };
}

function render() {
  return renderRoutes([{ path: "/", element: <EvalsPage /> }]);
}

beforeEach(() => {
  apiStub.reset();
  runsGet.mockResolvedValue(response());
  runsPost.mockResolvedValue({ data: { runId: 8 } });
});

// --- Tests ------------------------------------------------------------------

describe("a finished run", () => {
  test("shows what was expected beside where the repeats actually landed", async () => {
    // Both, not just the verdict. "Expected declined, got declined for a
    // completely different reason" is the finding this page exists to surface,
    // and a row that reported only a boolean would hide it.
    render();

    await screen.findByText("Nothing in the corpus covers it");
    expect(
      screen.getAllByText("Declined — Not covered by the knowledge base"),
    ).toHaveLength(2);
    expect(screen.getByText("5×")).toBeInTheDocument();
  });

  test("reports a rate per case rather than a pass", async () => {
    render();

    expect(await screen.findByText("5/5")).toBeInTheDocument();
  });

  test("shows a split as a split, not as a failure", async () => {
    // The whole reason five repeats exist. A case that went two ways is the
    // interesting one, and both ways are on screen with their counts.
    runsGet.mockResolvedValue(
      response({
        runs: [
          makeRun({
            attempts: 5,
            matches: 3,
            results: [
              makeResult({
                matches: 3,
                reached: [
                  {
                    outcome: PIPELINE_OUTCOME.declined,
                    decline: "notCovered",
                    count: 3,
                    matched: true,
                  },
                  {
                    outcome: PIPELINE_OUTCOME.resolved,
                    decline: null,
                    count: 2,
                    matched: false,
                  },
                ],
              }),
            ],
          }),
        ],
      }),
    );

    render();

    expect(await screen.findByText("3/5")).toBeInTheDocument();
    expect(screen.getByText("3×")).toBeInTheDocument();
    expect(screen.getByText("2×")).toBeInTheDocument();
    expect(screen.getByText("Answered")).toBeInTheDocument();
    // 3 of 5 repeats. The percentage is the run's headline and it is not a
    // verdict — the run is `completed` and shows no failure anywhere.
    expect(screen.getByText("60%")).toBeInTheDocument();
  });

  test("says which corpus it answered", async () => {
    // Frozen and live runs are two series that are never averaged, so a run
    // that did not say which it was would be a number nobody could place.
    render();

    expect(await screen.findByText("Frozen corpus")).toBeInTheDocument();
  });

  test("shows what the run cost", async () => {
    // R10. A feature that spends money unattended and shows nothing is the
    // "quiet cost, discovered on an invoice" risk in the PRD.
    render();

    expect(await screen.findByText("$0.0012")).toBeInTheDocument();
  });

  test("shows how much of it came off the prompt cache", async () => {
    // A run of zero here is the prompt-caching regression nothing else in this
    // app would show — repeats of one case are the only place it is observable.
    render();

    await screen.findByText("Nothing in the corpus covers it");
    expect(screen.getByText("4 of 4 repeats")).toBeInTheDocument();
  });
});

describe("a run in flight", () => {
  test("says it is running rather than showing an empty result", async () => {
    // The one genuinely misleading state this screen could reach: a queued run
    // drawn as a finished one that measured nothing.
    runsGet.mockResolvedValue(
      response({
        runs: [
          makeRun({
            status: EVAL_RUN_STATUS.running,
            finishedAt: null,
            attempts: 0,
            matches: 0,
            results: [],
          }),
        ],
      }),
    );

    render();

    expect(await screen.findByText("Running")).toBeInTheDocument();
    expect(screen.getByText(/Answering the first case/)).toBeInTheDocument();
  });

  test("draws no percentage until the whole set has been answered", async () => {
    // A rate over the third of the set that has finished is not a smaller
    // version of the answer, it is a different number — and one that looks
    // exactly like the real one.
    runsGet.mockResolvedValue(
      response({
        runs: [
          makeRun({
            status: EVAL_RUN_STATUS.running,
            finishedAt: null,
            attempts: 0,
            matches: 0,
          }),
        ],
      }),
    );

    render();

    await screen.findByText(/Running — 1 case answered/);
    expect(screen.queryByText("Decline accuracy")).not.toBeInTheDocument();
  });
});

describe("starting a run", () => {
  test("posts once and refetches", async () => {
    const user = userEvent.setup();
    render();
    await screen.findByText("Nothing in the corpus covers it");

    await user.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => expect(runsPost).toHaveBeenCalledTimes(1));
    // The list is re-read rather than patched from the response: the reply is
    // an id, and the run has not happened yet.
    await waitFor(() => expect(runsGet).toHaveBeenCalledTimes(2));
  });

  test("asks for the frozen corpus unless told otherwise", async () => {
    // The default is the one whose numbers move only when the code does. A live
    // run is a thing to ask for on purpose, not to get by accident.
    const user = userEvent.setup();
    render();
    await screen.findByText("Nothing in the corpus covers it");

    await user.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => expect(runsPost).toHaveBeenCalledTimes(1));
    expect(runsPost.mock.calls[0]?.[1]).toEqual({
      corpus: EVAL_CORPUS.frozen,
    });
  });

  test("sends the corpus the admin picked", async () => {
    const user = userEvent.setup();
    render();
    await screen.findByText("Nothing in the corpus covers it");

    // Radix's Select is a floating layer, not a native `<select>` — click the
    // trigger, then the option (frontend.md).
    await user.click(screen.getByRole("combobox", { name: "Corpus" }));
    await user.click(screen.getByRole("option", { name: "Live articles" }));
    await user.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => expect(runsPost).toHaveBeenCalledTimes(1));
    expect(runsPost.mock.calls[0]?.[1]).toEqual({ corpus: EVAL_CORPUS.live });
  });

  test("is unavailable when the deployment has no key, and says why", async () => {
    runsGet.mockResolvedValue(response({ evalConfigured: false, runs: [] }));

    render();

    expect(
      await screen.findByText("No AI provider is configured"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
  });
});
