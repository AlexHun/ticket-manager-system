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
 * Two things it is responsible for and nothing else can be: a result row that
 * says what was expected *and* what was reached (a row that only said "failed"
 * would be the thing this page exists to replace), and a Run button that is
 * unavailable on a deployment with no key rather than one that always fails.
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
    actualOutcome: PIPELINE_OUTCOME.declined,
    actualDecline: "notCovered",
    matched: true,
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
  test("shows what was expected beside what was reached", async () => {
    // Both, not just the verdict. "Expected declined, got declined for a
    // completely different reason" is the finding this page exists to surface,
    // and a row that reported only a boolean would hide it.
    render();

    await screen.findByText("Nothing in the corpus covers it");
    expect(
      screen.getAllByText("Declined — Not covered by the knowledge base"),
    ).toHaveLength(2);
    expect(screen.getByText("As expected")).toBeInTheDocument();
  });

  test("says which corpus it answered", async () => {
    // Frozen and live runs are two series that are never averaged, so a run
    // that did not say which it was would be a number nobody could place.
    render();

    expect(await screen.findByText("frozen corpus")).toBeInTheDocument();
  });

  test("reports a mismatch as a result, not as an error", async () => {
    runsGet.mockResolvedValue(
      response({
        runs: [
          makeRun({
            results: [
              makeResult({
                actualOutcome: PIPELINE_OUTCOME.resolved,
                actualDecline: null,
                matched: false,
              }),
            ],
          }),
        ],
      }),
    );

    render();

    expect(await screen.findByText("Not as expected")).toBeInTheDocument();
    expect(screen.getByText("Answered")).toBeInTheDocument();
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
            results: [],
          }),
        ],
      }),
    );

    render();

    expect(await screen.findByText("Running")).toBeInTheDocument();
    expect(
      screen.getByText(/Answering the case\. This takes a few seconds\./),
    ).toBeInTheDocument();
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

  test("is unavailable when the deployment has no key, and says why", async () => {
    runsGet.mockResolvedValue(response({ evalConfigured: false, runs: [] }));

    render();

    expect(
      await screen.findByText("No AI provider is configured"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
  });
});
