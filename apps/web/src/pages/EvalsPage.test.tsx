import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  EVAL_CORPUS,
  EVAL_METRIC,
  EVAL_RUN_STATUS,
  EVAL_THRESHOLD,
  PIPELINE_OUTCOME,
  TICKET_CATEGORY,
  USER_ROLE,
  type EvalCaseResultRow,
  type EvalMetric,
  type EvalMetricRow,
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
    caught: 0,
    escaped: 0,
    expectedCategory: TICKET_CATEGORY.General,
    classified: 5,
    classifyMatches: 5,
    filed: [{ category: TICKET_CATEGORY.General, count: 5, matched: true }],
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

/**
 * A metric that cleared its threshold, so a test about something else does not
 * accidentally render a failing card.
 */
function makeMetric(
  metric: EvalMetric,
  overrides: Partial<EvalMetricRow> = {},
): EvalMetricRow {
  return {
    metric,
    value: 1,
    numerator: 5,
    denominator: 5,
    threshold: EVAL_THRESHOLD[metric],
    meets: true,
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
    caught: 0,
    escaped: 0,
    checks: [],
    classified: 5,
    classifyMatches: 5,
    categories: [
      {
        expected: TICKET_CATEGORY.General,
        actual: TICKET_CATEGORY.General,
        count: 5,
        matched: true,
      },
    ],
    metrics: [
      makeMetric(EVAL_METRIC.catchRate, {
        value: null,
        numerator: 0,
        denominator: 0,
      }),
      makeMetric(EVAL_METRIC.declineAccuracy),
      makeMetric(EVAL_METRIC.classifierAccuracy),
    ],
    failing: false,
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

    const row = (
      await screen.findByText("Nothing in the corpus covers it")
    ).closest("tr")!;
    // Both of the row's rate cells since slice 4 — how often it landed where it
    // said, and how often the classifier filed it where it said. Neither is a
    // tick, which is the claim this test is making.
    expect(within(row).getAllByText("5/5")).toHaveLength(2);
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
            metrics: [
              makeMetric(EVAL_METRIC.catchRate, {
                value: null,
                numerator: 0,
                denominator: 0,
              }),
              makeMetric(EVAL_METRIC.declineAccuracy, {
                value: 0.6,
                numerator: 3,
                denominator: 5,
                // Below its threshold, which is the point: the run is still
                // `completed` and the split is still drawn as a split.
                meets: false,
              }),
            ],
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

describe("the safety numbers", () => {
  /** A run whose payloads were caught three times in four. */
  function catchRun(overrides: Partial<EvalRunRow> = {}): EvalRunRow {
    return makeRun({
      caught: 3,
      escaped: 1,
      failing: true,
      metrics: [
        makeMetric(EVAL_METRIC.catchRate, {
          value: 0.75,
          numerator: 3,
          denominator: 4,
          meets: false,
        }),
        makeMetric(EVAL_METRIC.declineAccuracy),
      ],
      checks: [
        { decline: "unbackedReference", count: 2 },
        { decline: "unbackedCommitment", count: 1 },
      ],
      ...overrides,
    });
  }

  test("draws a failing badge on a run below its threshold", async () => {
    // R8, and the badge is deliberately not the "Failed" one: this run finished
    // and its numbers are the answer. A reader has to be able to tell "the
    // provider was unreachable" from "a payload got out".
    runsGet.mockResolvedValue(response({ runs: [catchRun()] }));

    render();

    expect(await screen.findByText("Failing")).toBeInTheDocument();
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();
  });

  test("shows the catch rate over payloads attempted, with the bar it had to clear", async () => {
    // The denominator is on screen because it is the argument: 3 of 4 attempts
    // is a completely different claim from 3 of 175 repeats, and a bare
    // percentage invites the second reading.
    runsGet.mockResolvedValue(response({ runs: [catchRun()] }));

    render();

    expect(await screen.findByText("Safety catch rate")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(
      screen.getByText("3 of 4 payloads attempted · needs 100%"),
    ).toBeInTheDocument();
  });

  test("says which check caught each payload", async () => {
    // R9's second half. A rate says the checks held; this says which of the two
    // string comparisons did the holding.
    runsGet.mockResolvedValue(response({ runs: [catchRun()] }));

    render();

    // Scoped to the named list, not the card: the same wording labels a decline
    // in the Expected and Reached columns of the table below, so an unscoped
    // query would be satisfied by a completely different claim.
    const breakdown = await screen.findByRole("list", {
      name: "Payloads caught by check",
    });
    expect(
      within(breakdown).getByText("Carried a link no article contains"),
    ).toBeInTheDocument();
    expect(
      within(breakdown).getByText("Promised money no article states"),
    ).toBeInTheDocument();
    expect(within(breakdown).getByText("×2")).toBeInTheDocument();
  });

  test("says out loud when a payload reached an accepted reply", async () => {
    // The only value on this page that is a defect rather than a measurement,
    // so it is a sentence rather than a red figure among black ones.
    runsGet.mockResolvedValue(response({ runs: [catchRun()] }));

    render();

    expect(
      await screen.findByText(/reached an accepted reply/),
    ).toBeInTheDocument();
  });

  test("reports no catch rate rather than a perfect one when nothing was planted", async () => {
    // The most misleading thing this page could say is 100% over a run where
    // the model never planted a payload — a green score for a safety check
    // nothing exercised.
    render();

    await screen.findByText("Safety catch rate");
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(
      screen.getByText("no payloads attempted in this run"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Failing")).not.toBeInTheDocument();
  });

  test("marks a payload's own row with what got out", async () => {
    // A payload case can be 5/5 "as expected" and still have leaked: the two
    // questions are different, and one number would hide the second.
    runsGet.mockResolvedValue(
      response({
        runs: [
          catchRun({
            results: [
              makeResult({
                adversarial: true,
                caseName: "Planted portal link",
                caught: 3,
                escaped: 1,
              }),
            ],
          }),
        ],
      }),
    );

    render();

    await screen.findByText("Planted portal link");
    expect(screen.getByText("1 escaped")).toBeInTheDocument();
    expect(screen.getByText("3 caught")).toBeInTheDocument();
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

describe("classifier accuracy", () => {
  test("is a third metric with a denominator of its own", async () => {
    // R15. Three numbers, three different denominators, and the third one is
    // repeats the classifier *answered* rather than repeats the run made —
    // which is why the unit is on screen rather than left to be inferred.
    runsGet.mockResolvedValue(
      response({
        runs: [
          makeRun({
            metrics: [
              makeMetric(EVAL_METRIC.catchRate, {
                value: null,
                numerator: 0,
                denominator: 0,
              }),
              makeMetric(EVAL_METRIC.declineAccuracy),
              makeMetric(EVAL_METRIC.classifierAccuracy, {
                value: 0.8,
                numerator: 4,
                denominator: 5,
              }),
            ],
          }),
        ],
      }),
    );
    render();

    expect(await screen.findByText("Classifier accuracy")).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getByText(/4 of 5 repeats classified/)).toBeInTheDocument();
  });

  test("says which category was mistaken for which", async () => {
    // The breakdown, and the pair is the point. "Refund → General" is the one
    // line on this page that says the control between a refund request and an
    // unattended reply has moved.
    runsGet.mockResolvedValue(
      response({
        runs: [
          makeRun({
            categories: [
              {
                expected: TICKET_CATEGORY.Refund,
                actual: TICKET_CATEGORY.General,
                count: 3,
                matched: false,
              },
              {
                expected: TICKET_CATEGORY.Refund,
                actual: TICKET_CATEGORY.Refund,
                count: 2,
                matched: true,
              },
            ],
          }),
        ],
      }),
    );
    render();

    const list = await screen.findByRole("list", {
      name: "Cases filed under an unexpected category",
    });
    expect(within(list).getByText("Refund → General")).toBeInTheDocument();
    // Only the disagreements. A pair that landed where it should has said so in
    // the rate, and listing it here is how a breakdown stops being read.
    expect(within(list).queryByText("Refund → Refund")).not.toBeInTheDocument();
  });

  test("draws no breakdown at all when everything landed where it should", async () => {
    render();

    await screen.findByText("Nothing in the corpus covers it");
    expect(
      screen.queryByRole("list", {
        name: "Cases filed under an unexpected category",
      }),
    ).not.toBeInTheDocument();
  });

  test("a case it cannot be scored on draws a dash, not a zero", async () => {
    // `unclassified` and `no-inbound-message` are never asked. "0/0" in that
    // cell would read as a measurement that came out badly.
    runsGet.mockResolvedValue(
      response({
        runs: [
          makeRun({
            results: [
              makeResult({
                caseId: "unclassified",
                caseName: "Classification never landed",
                expectedCategory: null,
                classified: 0,
                classifyMatches: 0,
                filed: [],
              }),
            ],
          }),
        ],
      }),
    );
    render();

    const row = (
      await screen.findByText("Classification never landed")
    ).closest("tr")!;
    expect(within(row).getByText("—")).toBeInTheDocument();
    expect(within(row).queryByText("0/0")).not.toBeInTheDocument();
  });

  test("a case filed somewhere else shows the rate and where the rest went", async () => {
    runsGet.mockResolvedValue(
      response({
        runs: [
          makeRun({
            results: [
              makeResult({
                expectedCategory: TICKET_CATEGORY.Refund,
                classified: 5,
                classifyMatches: 3,
                filed: [
                  { category: TICKET_CATEGORY.Refund, count: 3, matched: true },
                  {
                    category: TICKET_CATEGORY.General,
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

    const row = (
      await screen.findByText("Nothing in the corpus covers it")
    ).closest("tr")!;
    expect(within(row).getByText("3/5")).toBeInTheDocument();
    expect(within(row).getByText("expected Refund")).toBeInTheDocument();
    expect(within(row).getByText("General")).toBeInTheDocument();
  });
});
