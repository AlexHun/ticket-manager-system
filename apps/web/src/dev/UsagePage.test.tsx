import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi, beforeEach } from "vitest";
import { renderRoutes } from "@/test/render";
import { UsagePage } from "./UsagePage";
import { USAGE_COLUMNS } from "./protocol";
import type { IssueUsage, UsageColumn, UsageReport } from "./protocol";

/**
 * The page's one rule: it reads nothing until asked, and what it shows
 * afterwards is that reading and no other (R5).
 *
 * Mocked at `axios` rather than at `./dev-api`, which is where
 * `ProjectMapPage.test.tsx` cuts. The difference matters here: "held until the
 * next press" is a property of the react-query mutation in `useUsageScan`, so a
 * hand-made stub of the hook would be asserting the stub. Cutting one layer
 * lower leaves the hook, the mutation and the page under test and stubs only the
 * wire — which is the seam the dev middleware sits behind anyway.
 */

const { post } = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock("axios", async (importOriginal) => {
  const actual = await importOriginal<typeof import("axios")>();
  return {
    ...actual,
    // `isAxiosError` is kept real: `extractErrorMessage` calls it on the
    // rejection path below.
    default: { create: () => ({ post }), isAxiosError: actual.isAxiosError },
  };
});

const FIXTURE_DIR = "/fixtures/transcripts";

const ISSUE_URL = "https://github.com/AlexHun/ticket-manager-system/issues/101";

/** The default row's figures, so a test that changes one can say which. */
const SPEND = { out: 20_000, turns: 2, sessions: 1, cacheRead: 400_000 };

/**
 * One row. The default is an issue `gh` answered for and the transcripts
 * recorded work against; the two absences the page distinguishes are overrides
 * of it. `{ title: null, url: null, forecast: null, verdict: null }` is the
 * degraded row — `gh` could not answer — and `{ spend: null, bucket: null,
 * verdict: null }` is an issue nobody has started. Both are asserted on below,
 * and the page must not render them the same way.
 */
function makeIssue(over: Partial<IssueUsage> = {}): IssueUsage {
  return {
    issue: 101,
    spend: { ...SPEND },
    title: "Usage page: titles, links, forecast bands and verdicts",
    url: ISSUE_URL,
    forecast: "M",
    bucket: "S",
    verdict: "under",
    ...over,
  };
}

function makeReport(over: Partial<UsageReport> = {}): UsageReport {
  return {
    gatheredAt: "2026-09-17T10:30:00.000Z",
    scanMs: 42,
    transcriptDir: FIXTURE_DIR,
    transcripts: 2,
    issues: [
      makeIssue(),
      makeIssue({
        issue: 102,
        spend: { out: 3000, turns: 1, sessions: 1, cacheRead: 12_000 },
        title: "A second issue",
        url: "https://github.com/AlexHun/ticket-manager-system/issues/102",
        forecast: "S",
        verdict: "on target",
      }),
    ],
    warnings: [],
    ...over,
  };
}

const renderPage = () => renderRoutes([{ path: "/", element: <UsagePage /> }]);

const scanButton = () => screen.getByRole("button", { name: "Scan" });

/** The frame `TableFrame` puts round the spend table, once one has been read. */
const spendTable = () => screen.findByRole("region", { name: "Issue spend" });

beforeEach(() => {
  post.mockReset();
  post.mockResolvedValue({ data: makeReport() });
});

describe("UsagePage", () => {
  test("reads nothing, and says so, until Scan is pressed", () => {
    renderPage();

    expect(post).not.toHaveBeenCalled();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(screen.getByText(/nothing gathered yet/i)).toBeInTheDocument();
  });

  test("lists issues and their output tokens, biggest spend first", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(scanButton());

    const rows = within(await spendTable()).getAllByRole("row");
    // Row 0 is the column header. The issue number is a `rowheader`, not a
    // `cell` — it names what every figure beside it is about.
    expect(
      within(rows[1]!).getByRole("rowheader", { name: "#101" }),
    ).toBeVisible();
    expect(within(rows[1]!).getByText("20,000")).toBeVisible();
    expect(
      within(rows[2]!).getByRole("rowheader", { name: "#102" }),
    ).toBeVisible();
    expect(within(rows[2]!).getByText("3,000")).toBeVisible();
  });

  /**
   * Where a named column sits in a row. Read off `USAGE_COLUMNS` rather than
   * counted here: a bare index is exactly the literal that goes stale silently
   * when a column is inserted, and these are the assertions that would then be
   * checking a neighbour.
   */
  const CELL = Object.fromEntries(
    USAGE_COLUMNS.map((name, i) => [name, i]),
  ) as Record<UsageColumn, number>;

  const cellsOf = async (n: number) =>
    within((await screen.findAllByRole("row"))[n]!).getAllByRole("cell");

  test("links each row's title to the issue on GitHub", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(scanButton());

    const link = await screen.findByRole("link", {
      name: /Usage page: titles, links, forecast bands and verdicts/,
    });
    expect(link).toHaveAttribute("href", ISSUE_URL);
    // A new tab: the scan on screen is a named moment's reading, and navigating
    // away from it loses figures that cost a filesystem sweep to gather.
    expect(link).toHaveAttribute("target", "_blank");
  });

  test("shows the band it was forecast into, the band it landed in, and the verdict", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(scanButton());

    const cells = await cellsOf(1);
    // The letter and the range together: the letter alone is jargon, and the
    // range alone does not match the label on the issue.
    expect(cells[CELL.forecast]).toHaveTextContent("M");
    expect(cells[CELL.forecast]).toHaveTextContent("60-150k");
    expect(cells[CELL.bucket]).toHaveTextContent("S");
    expect(cells[CELL.bucket]).toHaveTextContent("<60k");
    expect(cells[CELL.verdict]).toHaveTextContent("under");
  });

  // R3's sharp edge: an unforecast issue is unscored, not scored generously.
  test("shows no verdict for an issue nobody forecast", async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({
      data: makeReport({
        issues: [makeIssue({ forecast: null, verdict: null })],
      }),
    });
    renderPage();

    await user.click(scanButton());

    const cells = await cellsOf(1);
    expect(cells[CELL.forecast]).toHaveTextContent("—");
    expect(cells[CELL.verdict]).toHaveTextContent("—");
    expect(cells[CELL.verdict]).not.toHaveTextContent(/target|over|under/);
    // The title still came from `gh`; only the label was missing.
    expect(cells[CELL.title]).toHaveTextContent(/Usage page/);
  });

  // The degraded path: `gh` missing or unauthenticated costs three columns, not
  // the page. It is the state CI is in by default.
  test("keeps every figure, and says what is unknown, when gh could not answer", async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({
      data: makeReport({
        issues: [
          makeIssue({ title: null, url: null, forecast: null, verdict: null }),
        ],
        warnings: ["`gh` could not list this repository's issues: ENOENT"],
      }),
    });
    renderPage();

    await user.click(scanButton());

    const cells = await cellsOf(1);
    expect(cells[CELL.out]).toHaveTextContent("20,000");
    expect(cells[CELL.turns]).toHaveTextContent("2");
    expect(cells[CELL.cacheRead]).toHaveTextContent("400,000");
    // Derived from the figures, so it survives a `gh` that does not.
    expect(cells[CELL.bucket]).toHaveTextContent("S");
    expect(cells[CELL.title]).toHaveTextContent("—");
    expect(cells[CELL.forecast]).toHaveTextContent("—");
    expect(screen.queryByRole("link", { name: /Usage page/ })).toBeNull();
    expect(await screen.findByText(/gh` could not list/)).toBeInTheDocument();
  });

  /**
   * R4: a row is no longer proof that work happened. An open issue nobody has
   * started carries its band and nothing else — and above all no verdict, since
   * `bucketFor(0)` is `S` and a forecast of `L` read against it would print as
   * "under" on every untouched ticket in the backlog.
   */
  test("shows an issue nobody has started with its band and no figures", async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({
      data: makeReport({
        issues: [
          makeIssue({
            issue: 300,
            spend: null,
            title: "Not started yet",
            url: "https://github.com/AlexHun/ticket-manager-system/issues/300",
            forecast: "L",
            bucket: null,
            verdict: null,
          }),
        ],
      }),
    });
    renderPage();

    await user.click(scanButton());

    const cells = await cellsOf(1);
    // What `gh` knows is all there is, and it is all shown.
    expect(cells[CELL.forecast]).toHaveTextContent("L");
    expect(cells[CELL.forecast]).toHaveTextContent("150-250k");
    expect(
      await screen.findByRole("link", { name: /Not started yet/ }),
    ).toBeVisible();
    // Every figure is empty rather than zero, the bucket with them: there is no
    // band to land in until something has been spent.
    for (const column of ["out", "turns", "sessions", "cacheRead", "bucket"])
      expect(cells[CELL[column as UsageColumn]]).toHaveTextContent("—");
    expect(cells[CELL.verdict]).toHaveTextContent("—");
    expect(cells[CELL.verdict]).not.toHaveTextContent(/target|over|under/);
  });

  /**
   * The two absences render as the same em dash, so the words behind them are
   * the only thing that tells a reader which one they are looking at.
   *
   * One row carries both, which is what makes this an assertion about the
   * *distinction* rather than about one marker: nothing has been spent on it
   * (so every figure is `NotStarted`) and `gh` supplied no band for it (so the
   * forecast is `Unknown`). Asserting only the first would pass just as well if
   * the page rendered one marker everywhere.
   */
  const hoverDash = async (column: UsageColumn) => {
    const user = userEvent.setup();
    post.mockResolvedValue({
      data: makeReport({
        issues: [
          makeIssue({
            spend: null,
            forecast: null,
            bucket: null,
            verdict: null,
          }),
        ],
      }),
    });
    renderPage();

    await user.click(scanButton());
    const cells = await cellsOf(1);
    // The dash itself is the tooltip's trigger, so it is what a pointer lands
    // on — and reaching it by its text keeps the test off `Hint`'s internals.
    await user.hover(within(cells[CELL[column]]!).getByText("—"));
  };

  // Two tests rather than two hovers in one: Radix keeps the open tooltip's
  // state on its provider, so a second trigger hovered in the same render does
  // not open. A fresh render per marker is the honest way to ask.
  test("says a figure nobody has spent is unrecorded", async () => {
    await hoverDash("out");

    expect(await screen.findByText(/no recorded work/i)).toBeInTheDocument();
  });

  test("says a band gh could not supply is unknown", async () => {
    await hoverDash("forecast");

    expect(await screen.findByText(/gh could not supply/i)).toBeInTheDocument();
  });

  test("states when the figures were gathered and what was read", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(scanButton());

    const gathered = await screen.findByText(/^Gathered at/);
    // The machine-readable stamp, not the locale string rendered beside it: a
    // test that asserted the visible time would be asserting the runner's
    // locale and timezone rather than the page.
    expect(gathered.querySelector("time")).toHaveAttribute(
      "datetime",
      "2026-09-17T10:30:00.000Z",
    );
    expect(gathered).toHaveTextContent(FIXTURE_DIR);
    expect(gathered).toHaveTextContent("2 transcripts");
  });

  test("re-reads on a second press rather than holding the first answer", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(scanButton());
    expect(await spendTable()).toHaveTextContent("20,000");

    post.mockResolvedValue({
      data: makeReport({
        issues: [
          makeIssue({
            spend: { ...SPEND, out: 31_500, turns: 3, sessions: 2 },
          }),
        ],
      }),
    });
    await user.click(scanButton());

    await waitFor(async () =>
      expect(await spendTable()).toHaveTextContent("31,500"),
    );
    expect(post).toHaveBeenCalledTimes(2);
    // The first reading is gone rather than sitting beneath the second.
    expect(await spendTable()).not.toHaveTextContent("20,000");
  });

  test("shows an empty table rather than nothing when no issue has spend", async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({ data: makeReport({ issues: [] }) });
    renderPage();

    await user.click(scanButton());

    expect(
      within(await spendTable()).getByText(/no issue spend/i),
    ).toBeVisible();
  });

  test("reports what the scan could not see", async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({
      data: makeReport({
        issues: [],
        transcripts: 0,
        warnings: [`No .jsonl transcripts in ${FIXTURE_DIR}.`],
      }),
    });
    renderPage();

    await user.click(scanButton());

    expect(
      await screen.findByText(/no \.jsonl transcripts in/i),
    ).toBeInTheDocument();
  });

  test("surfaces a failed scan and leaves the page usable", async () => {
    const user = userEvent.setup();
    post.mockRejectedValue(new Error("EPERM: operation not permitted"));
    renderPage();

    await user.click(scanButton());

    expect(await screen.findByText(/EPERM/)).toBeInTheDocument();
    expect(scanButton()).toBeEnabled();
  });
});
