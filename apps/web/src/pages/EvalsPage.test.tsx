import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  EVAL_CORPUS,
  EVAL_METRIC,
  EVAL_RUN_LIMIT,
  EVAL_RUN_STATUS,
  EVAL_THRESHOLD,
  PIPELINE_OUTCOME,
  TICKET_CATEGORY,
  USER_ROLE,
  type EvalCaseResultRow,
  type EvalCorpus,
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
 *
 * Since #234 there is a fourth: the corpus selector is **one** control doing
 * two jobs — it filters the list and aims the Run button — so what is asserted
 * below is that the two halves can never disagree about which series is on
 * screen.
 */

vi.mock("@/lib/api", () => import("@/test/api-stub"));

const runsGet = apiStub.get("/api/evals/runs");
const runsPost = apiStub.post("/api/evals/runs");
/**
 * The schedule panel's own request, given a resting value here (#236).
 *
 * Declaring an endpoint this file has no opinion about is part of the setup: an
 * unrecognised request throws by name, and the panel this page now mounts
 * fetches one. What it *makes* of the answer is
 * `EvalSchedulePanel.test.tsx`'s subject, not this file's.
 */
const scheduleGet = apiStub.get("/api/evals/schedule");

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
    cacheable: 4,
    caught: 0,
    escaped: 0,
    expectedCategory: TICKET_CATEGORY.General,
    classifiedRepeats: 5,
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
    // No earlier run by default, so a test about something else is not also a
    // test about R14. The comparison tests below opt in.
    previous: null,
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
    classifiedRepeats: 5,
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
    previous: null,
    failing: false,
    results: [makeResult()],
    ...overrides,
  };
}

function response(overrides: Partial<EvalRunsResponse> = {}): {
  data: EvalRunsResponse;
} {
  return {
    data: {
      evalConfigured: true,
      // Echoed by the route, because the list is one corpus and a page that
      // guessed which one would caption it from the control rather than from
      // what it was actually sent (#234).
      corpus: EVAL_CORPUS.frozen,
      anyRuns: true,
      runs: [makeRun()],
      ...overrides,
    },
  };
}

/** The query params the nth (0-indexed) `GET /api/evals/runs` was sent with. */
function paramsOfCall(index: number): unknown {
  const config = runsGet.mock.calls[index]?.[1] as
    { params?: unknown } | undefined;
  return config?.params;
}

/**
 * The Run button, which names the corpus it will run (#234).
 *
 * The wording is written out rather than composed from the page's own label
 * map — which the page does not export, and should not: an assertion that built
 * the string the same way the component does would pass however the component
 * worded it.
 */
const RUN_BUTTON: Record<EvalCorpus, string> = {
  [EVAL_CORPUS.frozen]: "Run frozen corpus",
  [EVAL_CORPUS.live]: "Run live articles",
};

const runButton = (corpus: EvalCorpus = EVAL_CORPUS.frozen) =>
  screen.getByRole("button", { name: RUN_BUTTON[corpus] });

/**
 * The case table's own toggle, which is closed on load (#237).
 *
 * Matched by its tail rather than written out, because the label counts what
 * the run holds — "1 case, 5 repeats each" on a finished run, "5 repeats
 * answered so far" on one still filling in — and a test about the rows behind
 * it should not have to restate the arithmetic.
 */
const CASES_TOGGLE = /repeats (each|answered so far)$/;

/**
 * Reveal the case table of the run that is open on load.
 *
 * Every assertion about a result row goes through this since #237: the table is
 * the bulk of the card and folds separately from the run, so a row is one click
 * away rather than on screen.
 */
async function showCases(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: CASES_TOGGLE }));
}

function render() {
  return renderRoutes([{ path: "/", element: <EvalsPage /> }]);
}

beforeEach(() => {
  apiStub.reset();
  runsGet.mockResolvedValue(response());
  runsPost.mockResolvedValue({ data: { runId: 8 } });
  scheduleGet.mockResolvedValue({
    data: {
      evalConfigured: true,
      schedule: {
        hour: 3,
        minute: 47,
        paused: false,
        updatedAt: "2026-09-11T09:00:00.000Z",
        updatedByName: null,
      },
      plannedRuns: [],
    },
  });
});

// --- Tests ------------------------------------------------------------------

describe("a finished run", () => {
  test("shows what was expected beside where the repeats actually landed", async () => {
    // Both, not just the verdict. "Expected declined, got declined for a
    // completely different reason" is the finding this page exists to surface,
    // and a row that reported only a boolean would hide it.
    const user = userEvent.setup();
    render();

    await showCases(user);
    expect(
      screen.getAllByText("Declined — Not covered by the knowledge base"),
    ).toHaveLength(2);
    expect(screen.getByText("5×")).toBeInTheDocument();
  });

  test("reports a rate per case rather than a pass", async () => {
    const user = userEvent.setup();
    render();

    await showCases(user);
    const row = screen
      .getByText("Nothing in the corpus covers it")
      .closest("tr")!;
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

    const user = userEvent.setup();
    render();

    await showCases(user);
    expect(screen.getByText("3/5")).toBeInTheDocument();
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

    // A substring: the caption also carries the verdict word now.
    expect(await screen.findByText(/4 of 4 repeats/)).toBeInTheDocument();
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
      screen.getByText(/3 of 4 payloads attempted · needs 100%/),
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
      screen.getByText(/^no payloads attempted in this run/),
    ).toHaveTextContent(/^no payloads attempted in this run$/);
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

    const user = userEvent.setup();
    render();

    await showCases(user);
    expect(screen.getByText("Planted portal link")).toBeInTheDocument();
    expect(screen.getByText("1 escaped")).toBeInTheDocument();
    expect(screen.getByText("3 caught")).toBeInTheDocument();
  });
});

describe("how a number reads against its bar", () => {
  /**
   * Every assertion here reads a **whole caption**, exactly.
   *
   * Not a class — a test that matched `text-status-critical` would pass on a
   * tile whose only cue was colour, which is the rendering this feature exists
   * to prevent. And not a bare word either: an exact caption pins the verdict
   * to the denominator it belongs under, and it is the only way to assert the
   * neutral case, where the proof is that nothing was appended at all.
   */

  test("captions a metric that missed its bar with the word, not only the colour", async () => {
    runsGet.mockResolvedValue(
      response({
        runs: [
          makeRun({
            failing: true,
            metrics: [
              makeMetric(EVAL_METRIC.declineAccuracy, {
                value: 0.6,
                numerator: 3,
                denominator: 5,
                meets: false,
              }),
            ],
          }),
        ],
      }),
    );

    render();

    // The caption element, found by its denominator, then read whole: the
    // verdict is a coloured span inside it, so the assertion has to cross the
    // element boundary the colour introduces.
    expect(await screen.findByText(/^3 of 5 repeats/)).toHaveTextContent(
      /^3 of 5 repeats · needs 80% · missed$/,
    );
  });

  test("says when a metric only just cleared its bar", async () => {
    // 83% against a stored 80%: passing, and three points from not being. The
    // point of the middle band is that this is not the same news as 95%.
    runsGet.mockResolvedValue(
      response({
        runs: [
          makeRun({
            metrics: [
              makeMetric(EVAL_METRIC.classifierAccuracy, {
                value: 0.83,
                numerator: 83,
                denominator: 100,
              }),
            ],
          }),
        ],
      }),
    );

    render();

    expect(
      await screen.findByText(/^83 of 100 repeats classified/),
    ).toHaveTextContent(
      /^83 of 100 repeats classified · needs 80% · marginal$/,
    );
  });

  test("bands an old run against the threshold it was stored with", async () => {
    // The whole reason the threshold travels on the row. This run was judged
    // against 60% and is clear of it; the constant this build carries is 80%,
    // against which the same figure would be below the bar entirely.
    runsGet.mockResolvedValue(
      response({
        runs: [
          makeRun({
            metrics: [
              makeMetric(EVAL_METRIC.declineAccuracy, {
                value: 0.7,
                numerator: 70,
                denominator: 100,
                threshold: 0.6,
              }),
            ],
          }),
        ],
      }),
    );

    render();

    expect(await screen.findByText(/^70 of 100 repeats/)).toHaveTextContent(
      /^70 of 100 repeats · needs 60% · clear$/,
    );
  });

  test("leaves a metric that measured nothing with no verdict at all", async () => {
    // The default run planted no payload. A green "met" here would be a clean
    // bill of health for a safety check nothing exercised — so the caption is
    // the reason and nothing else, which is what an exact match asserts.
    render();

    await screen.findByText("Safety catch rate");
    expect(
      screen.getByText("no payloads attempted in this run"),
    ).toBeInTheDocument();
  });

  test("says the prompt cache stalled when nothing came off it", async () => {
    // The one prompt-caching alarm this codebase has a screen for.
    runsGet.mockResolvedValue(
      response({ runs: [makeRun({ cachedRepeats: 0, cacheable: 4 })] }),
    );

    render();

    expect(await screen.findByText(/^0 of 4 repeats/)).toHaveTextContent(
      /^0 of 4 repeats · cache stalled$/,
    );
  });

  test("leaves the prompt cache unjudged when no repeat could have hit it", async () => {
    // An old run stored before the counters existed looks exactly like this,
    // and it must not read as a stalled cache.
    runsGet.mockResolvedValue(
      response({ runs: [makeRun({ cachedRepeats: 0, cacheable: 0 })] }),
    );

    render();

    await screen.findByText("Prompt cache");
    expect(screen.getByText(/^0 of 0 repeats/)).toHaveTextContent(
      /^0 of 0 repeats$/,
    );
  });

  test("calls unanswered repeats out without calling them a failure", async () => {
    // An outage is not the model getting things wrong, so the caption is the
    // sentence this tile always carried rather than the word a missed
    // threshold gets.
    runsGet.mockResolvedValue(
      response({ runs: [makeRun({ abandoned: 2, attempts: 5 })] }),
    );

    render();

    expect(
      await screen.findByText("repeats where nothing was decided"),
    ).toBeInTheDocument();
  });

  test("leaves the cost unjudged", async () => {
    // No amount of dollars is bad in a way the harness can know, so this
    // caption is its denominator and nothing else.
    render();

    await screen.findByText("Estimated cost");
    expect(screen.getByText(/^1 cases × 5/)).toHaveTextContent(/^1 cases × 5$/);
  });

  test("names an escaped payload a defect, not another number below its bar", async () => {
    // Every other value on the card is a measurement. This one is a break, and
    // the word says so where colour alone could not.
    runsGet.mockResolvedValue(
      response({
        runs: [makeRun({ escaped: 1, caught: 3, failing: true })],
      }),
    );

    render();

    expect(await screen.findByText(/^Defect —/)).toBeInTheDocument();
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

describe("the corpus control", () => {
  /**
   * Pick a corpus the way the repo's other Radix Select tests do — click the
   * trigger, click the option. It is a floating layer, not a native `<select>`,
   * so `selectOptions` does not work on it (frontend.md).
   */
  async function pick(user: ReturnType<typeof userEvent.setup>, name: string) {
    await user.click(screen.getByRole("combobox", { name: "Corpus" }));
    await user.click(screen.getByRole("option", { name }));
  }

  test("asks the server for one corpus, and for the frozen one on load", async () => {
    // The filter is the server's, which is what puts the list's cap inside the
    // series: twenty nightly frozen runs must not push the live ones off the
    // page.
    render();

    await screen.findByRole("button", { name: "Run 7" });
    expect(paramsOfCall(0)).toEqual({
      corpus: EVAL_CORPUS.frozen,
    });
  });

  test("re-asks for the corpus the admin picked, and the list follows it", async () => {
    const user = userEvent.setup();
    render();
    await screen.findByRole("button", { name: "Run 7" });

    runsGet.mockResolvedValue(
      response({
        corpus: EVAL_CORPUS.live,
        runs: [
          makeRun({
            id: 11,
            corpus: EVAL_CORPUS.live,
            results: [makeResult({ caseName: "A live-corpus case" })],
          }),
        ],
      }),
    );

    await pick(user, "Live articles");

    // The value is read off the trigger, not with `toHaveValue` — there is no
    // native select underneath it.
    expect(screen.getByRole("combobox", { name: "Corpus" })).toHaveTextContent(
      "Live articles",
    );
    // The cards themselves, by the run each one names: the case rows behind
    // them are folded away (#237), and which runs are on screen is the claim.
    expect(
      await screen.findByRole("button", { name: "Run 11" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Run 7" }),
    ).not.toBeInTheDocument();
    expect(paramsOfCall(1)).toEqual({
      corpus: EVAL_CORPUS.live,
    });
  });

  test("offers the two series and no way to ask for both", async () => {
    // There is deliberately no "all": the two are never averaged, and an "all"
    // the Run button could not honour would be a control meaning two different
    // things depending on which half of the page you were looking at.
    const user = userEvent.setup();
    render();
    await screen.findByRole("button", { name: "Run 7" });

    await user.click(screen.getByRole("combobox", { name: "Corpus" }));

    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Frozen corpus",
      "Live articles",
    ]);
  });

  test("names the corpus the Run button will run", async () => {
    // Rather than a bare "Run" beside a selector the eye has already left.
    const user = userEvent.setup();
    render();
    await screen.findByRole("button", { name: "Run 7" });

    expect(runButton(EVAL_CORPUS.frozen)).toBeInTheDocument();

    runsGet.mockResolvedValue(response({ corpus: EVAL_CORPUS.live, runs: [] }));
    await pick(user, "Live articles");

    expect(runButton(EVAL_CORPUS.live)).toBeInTheDocument();
  });

  test("stays usable on a deployment with no key, though the Run button does not", async () => {
    // The history is still worth reading — both series of it — on a deployment
    // that can start nothing.
    runsGet.mockResolvedValue(response({ evalConfigured: false }));

    render();

    await screen.findByRole("button", { name: "Run 7" });
    expect(screen.getByRole("combobox", { name: "Corpus" })).toBeEnabled();
    expect(runButton()).toBeDisabled();
  });

  test("says the list is capped, and says which series it is capped within", async () => {
    // A page that silently stopped at twenty would draw its oldest card as the
    // first run ever made — and the count has to stay true under the filter,
    // which is what the corpus in the sentence is for. It is a claim about
    // where this list stops, not about runs beyond it: a series holding exactly
    // twenty is not truncated, and nothing on screen can tell the two apart.
    runsGet.mockResolvedValue(
      response({
        runs: Array.from({ length: EVAL_RUN_LIMIT }, (_, i) =>
          makeRun({ id: i + 1 }),
        ),
      }),
    );

    render();

    expect(
      await screen.findByText(
        `This list is capped at the ${EVAL_RUN_LIMIT} most recent runs on the frozen corpus.`,
      ),
    ).toBeInTheDocument();
  });
});

describe("an empty list", () => {
  test("says nobody has run one when nobody has", async () => {
    runsGet.mockResolvedValue(response({ runs: [], anyRuns: false }));

    render();

    expect(await screen.findByText(/^No runs yet\./)).toBeInTheDocument();
  });

  test("says the runs are on the other series when they are", async () => {
    // The two are different pieces of news, and "No runs yet" said to an admin
    // who has run twenty live ones would be a lie about their own history.
    runsGet.mockResolvedValue(response({ runs: [], anyRuns: true }));

    render();

    expect(
      await screen.findByText(/No runs against the frozen corpus yet\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^No runs yet\./)).not.toBeInTheDocument();
  });
});

describe("starting a run", () => {
  test("posts once and refetches", async () => {
    const user = userEvent.setup();
    render();
    await screen.findByRole("button", { name: "Run 7" });

    await user.click(runButton());

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
    await screen.findByRole("button", { name: "Run 7" });

    await user.click(runButton());

    await waitFor(() => expect(runsPost).toHaveBeenCalledTimes(1));
    expect(runsPost.mock.calls[0]?.[1]).toEqual({
      corpus: EVAL_CORPUS.frozen,
    });
  });

  test("sends the corpus the admin picked", async () => {
    const user = userEvent.setup();
    render();
    await screen.findByRole("button", { name: "Run 7" });

    // Radix's Select is a floating layer, not a native `<select>` — click the
    // trigger, then the option (frontend.md).
    await user.click(screen.getByRole("combobox", { name: "Corpus" }));
    await user.click(screen.getByRole("option", { name: "Live articles" }));
    // And the button is now the live one — picking a corpus aims it (#234).
    await user.click(runButton(EVAL_CORPUS.live));

    await waitFor(() => expect(runsPost).toHaveBeenCalledTimes(1));
    expect(runsPost.mock.calls[0]?.[1]).toEqual({ corpus: EVAL_CORPUS.live });
  });

  test("is unavailable when the deployment has no key, and says why", async () => {
    runsGet.mockResolvedValue(response({ evalConfigured: false, runs: [] }));

    render();

    expect(
      await screen.findByText("No AI provider is configured"),
    ).toBeInTheDocument();
    expect(runButton()).toBeDisabled();
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

    await screen.findByRole("button", { name: "Run 7" });
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
                classifiedRepeats: 0,
                classifyMatches: 0,
                filed: [],
              }),
            ],
          }),
        ],
      }),
    );
    const user = userEvent.setup();
    render();

    await showCases(user);
    const row = screen.getByText("Classification never landed").closest("tr")!;
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
                classifiedRepeats: 5,
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
    const user = userEvent.setup();
    render();

    await showCases(user);
    const row = screen
      .getByText("Nothing in the corpus covers it")
      .closest("tr")!;
    expect(within(row).getByText("3/5")).toBeInTheDocument();
    expect(within(row).getByText("expected Refund")).toBeInTheDocument();
    expect(within(row).getByText("General")).toBeInTheDocument();
  });
});

describe("what moved since last time", () => {
  /** A run whose decline accuracy is down six points on the run before it. */
  function comparedRun(overrides: Partial<EvalRunRow> = {}): EvalRunRow {
    return makeRun({
      previous: { id: 6, startedAt: "2026-09-03T10:00:00.000Z" },
      metrics: [
        makeMetric(EVAL_METRIC.catchRate, {
          value: 1,
          numerator: 4,
          denominator: 4,
          previous: { value: 1 },
        }),
        makeMetric(EVAL_METRIC.declineAccuracy, {
          value: 0.84,
          numerator: 21,
          denominator: 25,
          previous: { value: 0.9 },
        }),
      ],
      ...overrides,
    });
  }

  test("shows how far each metric moved, in percentage points", async () => {
    // R14, and the whole reason the epic stores runs rather than printing them:
    // an admin edits a prompt, runs the harness, and reads what changed without
    // opening a second page or re-running anything.
    runsGet.mockResolvedValue(response({ runs: [comparedRun()] }));

    render();

    await screen.findByText("Decline accuracy");
    expect(screen.getByText("-6pp")).toBeInTheDocument();
    // Points, not percent: 90 to 84 is a fall of six points and of seven
    // percent, and the unit is what stops the two being read as one.
    expect(screen.queryByText("-6%")).not.toBeInTheDocument();
    // A metric that held says so rather than drawing a bare zero.
    expect(screen.getByText("unchanged")).toBeInTheDocument();
  });

  test("says which run those deltas are against", async () => {
    // A delta whose other end is unnamed is a number nobody can go and look at.
    runsGet.mockResolvedValue(response({ runs: [comparedRun()] }));

    render();

    expect(await screen.findByText(/Compared with run 6/)).toBeInTheDocument();
  });

  test("says out loud that a first run has nothing to compare against", async () => {
    // Otherwise "no delta on this card" and "nothing moved" look identical —
    // and on this screen the second reading is the reassuring one, which is the
    // wrong way round for a silence to be misread.
    render();

    expect(
      await screen.findByText(/First run on the frozen corpus/),
    ).toBeInTheDocument();
  });

  test("draws no delta at all on a metric neither run measured", async () => {
    // The catch rate on two quiet nights. A zero here would say the two runs
    // agreed about something neither of them measured.
    runsGet.mockResolvedValue(
      response({
        runs: [
          comparedRun({
            metrics: [
              makeMetric(EVAL_METRIC.catchRate, {
                value: null,
                numerator: 0,
                denominator: 0,
                previous: { value: null },
              }),
            ],
          }),
        ],
      }),
    );

    render();

    await screen.findByText("Safety catch rate");
    expect(screen.getByText("neither run measured this")).toBeInTheDocument();
    expect(screen.queryByText("unchanged")).not.toBeInTheDocument();
  });

  test("takes the delta between the two figures as drawn, not the rates behind them", async () => {
    // 89.6% and 84.4% are five points apart and draw as 90% and 84%, which are
    // six. A caption rounded off the raw fractions would sit under two numbers
    // it contradicts — and on a screen whose whole job is "did this get worse",
    // arguing with itself is the one thing it cannot afford to do.
    runsGet.mockResolvedValue(
      response({
        runs: [
          comparedRun({
            metrics: [
              makeMetric(EVAL_METRIC.declineAccuracy, {
                value: 0.896,
                numerator: 112,
                denominator: 125,
                previous: { value: 0.844 },
              }),
            ],
          }),
        ],
      }),
    );

    render();

    expect(await screen.findByText("90%")).toBeInTheDocument();
    expect(screen.getByText("+6pp")).toBeInTheDocument();
    expect(screen.queryByText("+5pp")).not.toBeInTheDocument();
  });

  test("says what the last run measured when this one measured nothing", async () => {
    // A dash where a number was is not the same news twice over: "—" under a
    // remembered 100% is a quiet night, and "—" under a remembered 40% is a
    // metric that has stopped being taken at all.
    runsGet.mockResolvedValue(
      response({
        runs: [
          comparedRun({
            metrics: [
              makeMetric(EVAL_METRIC.catchRate, {
                value: null,
                numerator: 0,
                denominator: 0,
                previous: { value: 0.4 },
              }),
            ],
          }),
        ],
      }),
    );

    render();

    await screen.findByText("Safety catch rate");
    expect(screen.getByText("previously 40%")).toBeInTheDocument();
  });

  test("says a metric is newly measured rather than drawing a delta from nothing", async () => {
    // The first run after a metric was added. There is no fall from zero here —
    // there is no earlier figure at all, and inventing one is how a green
    // dashboard turns into an alarm nobody trusts.
    runsGet.mockResolvedValue(
      response({
        runs: [
          comparedRun({
            metrics: [
              makeMetric(EVAL_METRIC.classifierAccuracy, {
                value: 0.8,
                numerator: 4,
                denominator: 5,
                previous: { value: null },
              }),
            ],
          }),
        ],
      }),
    );

    render();

    await screen.findByText("Classifier accuracy");
    expect(screen.getByText("not measured last run")).toBeInTheDocument();
    expect(screen.queryByText(/pp$/)).not.toBeInTheDocument();
  });

  test("compares nothing on a run that is still filling in", async () => {
    // A rate over the third of the set that has been answered is a different
    // number, not a smaller one, so there is nothing yet to compare — and the
    // line that names a predecessor would imply there was.
    runsGet.mockResolvedValue(
      response({
        runs: [
          makeRun({
            status: EVAL_RUN_STATUS.running,
            finishedAt: null,
            metrics: [],
            previous: null,
          }),
        ],
      }),
    );

    render();

    await screen.findByText(/Running/);
    expect(screen.queryByText(/Compared with run/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/First run on the frozen corpus/),
    ).not.toBeInTheDocument();
  });
});

describe("folding a run", () => {
  /**
   * The page draws twenty runs. A card that is a screenful of metrics, cost,
   * two breakdowns and a 36-row table is a page nobody scrolls, so a run folds
   * to the part that decides whether to open it — and what that header still
   * has to report is what every assertion here pins.
   *
   * The toggles are asserted through `aria-expanded` and through what is in the
   * DOM, never through a class or a `data-state`: a collapsed run whose content
   * is merely hidden would satisfy a class assertion and still be the page this
   * ticket exists to fix.
   */

  test("opens the newest run and leaves the older ones closed", async () => {
    // Not remembered between visits, and not "all open" either: the newest run
    // is the one an admin came to read, and the twenty behind it are history.
    runsGet.mockResolvedValue(
      response({ runs: [makeRun({ id: 9 }), makeRun({ id: 8 })] }),
    );

    render();

    expect(
      await screen.findByRole("button", { name: "Run 9" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Run 8" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  test("keeps the headline numbers on a collapsed run, and folds the rest away", async () => {
    // The whole trade: which run, which corpus, when, and the judged metrics
    // with their verdict words and deltas stay; cost, the cache figure and the
    // case table are what folding buys back.
    const user = userEvent.setup();
    runsGet.mockResolvedValue(
      response({
        runs: [
          makeRun({
            previous: { id: 6, startedAt: "2026-09-03T10:00:00.000Z" },
            metrics: [
              makeMetric(EVAL_METRIC.declineAccuracy, {
                value: 0.84,
                numerator: 21,
                denominator: 25,
                previous: { value: 0.9 },
              }),
            ],
          }),
        ],
      }),
    );

    render();

    await user.click(await screen.findByRole("button", { name: "Run 7" }));

    const trigger = screen.getByRole("button", { name: "Run 7" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    // Scoped to the card, because the corpus selector in the page header says
    // "Frozen corpus" too and an unscoped query would be satisfied by the
    // control rather than by the run.
    const card = within(trigger.closest("[data-slot='card']")!);
    expect(card.getByText("Frozen corpus")).toBeInTheDocument();
    // Formatted rather than written out: the wording is the platform's, not the
    // page's, and a literal would pin the test to one timezone.
    expect(
      card.getByText(new Date("2026-09-09T10:00:00.000Z").toLocaleString()),
    ).toBeInTheDocument();
    expect(screen.getByText("84%")).toBeInTheDocument();
    expect(screen.getByText(/^21 of 25 repeats/)).toHaveTextContent(
      /^21 of 25 repeats · needs 80% · marginal$/,
    );
    expect(screen.getByText("-6pp")).toBeInTheDocument();
    // The line that makes that delta mean anything travels with it.
    expect(screen.getByText(/Compared with run 6/)).toBeInTheDocument();

    // Audited monthly, not scanned — so it is body, not header.
    expect(screen.queryByText("Estimated cost")).not.toBeInTheDocument();
    expect(screen.queryByText("Prompt cache")).not.toBeInTheDocument();
    expect(screen.queryByText("Unanswered")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: CASES_TOGGLE }),
    ).not.toBeInTheDocument();
  });

  test("still says a payload escaped when the run is folded shut", async () => {
    // The one value on this card that is a defect rather than a measurement.
    // A fold that hid it would be a fold that hides the only thing on the page
    // nobody may miss.
    const user = userEvent.setup();
    runsGet.mockResolvedValue(
      response({ runs: [makeRun({ escaped: 1, caught: 3, failing: true })] }),
    );

    render();

    await user.click(await screen.findByRole("button", { name: "Run 7" }));

    expect(screen.getByText(/^Defect —/)).toBeInTheDocument();
    expect(screen.getByText("Failing")).toBeInTheDocument();
  });

  test("a failed run folds to a header that says so and claims no metrics", async () => {
    // A run that fell over has no rates worth banding, so the header is the
    // status and nothing that would read as a measurement.
    const user = userEvent.setup();
    runsGet.mockResolvedValue(
      response({
        runs: [
          makeRun({
            status: EVAL_RUN_STATUS.failed,
            finishedAt: null,
            error: "The provider could not be reached.",
            metrics: [],
            results: [],
          }),
        ],
      }),
    );

    render();

    await user.click(await screen.findByRole("button", { name: "Run 7" }));

    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.queryByText("Decline accuracy")).not.toBeInTheDocument();
    expect(screen.queryByText("Safety catch rate")).not.toBeInTheDocument();
    expect(screen.queryByText("Estimated cost")).not.toBeInTheDocument();
  });

  test("leaves a run still filling in with its cases on screen", async () => {
    // The one run whose table is the interesting part. A run in flight has no
    // metrics yet and the rows arriving one at a time *are* the progress, so a
    // run you started and then had to open a second disclosure to watch would
    // be a worse screen than the one folding is fixing.
    runsGet.mockResolvedValue(
      response({
        runs: [
          makeRun({
            status: EVAL_RUN_STATUS.running,
            finishedAt: null,
            metrics: [],
            previous: null,
          }),
        ],
      }),
    );

    render();

    expect(
      await screen.findByRole("button", { name: CASES_TOGGLE }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByText("Nothing in the corpus covers it"),
    ).toBeInTheDocument();
  });

  test("folds the case table separately, inside an open run", async () => {
    // The bulk of the card. An admin reading the metrics rarely wants all
    // thirty-six rows with them, so the run being open is not the table being
    // open.
    const user = userEvent.setup();
    render();

    const toggle = await screen.findByRole("button", { name: CASES_TOGGLE });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // The run itself is open — this is the second toggle, not the first.
    expect(screen.getByRole("button", { name: "Run 7" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(
      screen.queryByText("Nothing in the corpus covers it"),
    ).not.toBeInTheDocument();

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByText("Nothing in the corpus covers it"),
    ).toBeInTheDocument();
  });

  test("forgets what was open when the page is left and come back to", async () => {
    // Deliberately not remembered: which runs you had open goes stale as runs
    // age off the page, and it is state nobody asked for.
    const user = userEvent.setup();
    const { unmount } = render();

    await user.click(await screen.findByRole("button", { name: CASES_TOGGLE }));
    await user.click(screen.getByRole("button", { name: "Run 7" }));
    unmount();

    render();

    expect(
      await screen.findByRole("button", { name: "Run 7" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: CASES_TOGGLE })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});
