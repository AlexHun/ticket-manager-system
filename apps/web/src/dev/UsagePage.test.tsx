import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi, beforeEach } from "vitest";
import { renderRoutes } from "@/test/render";
import { UsagePage } from "./UsagePage";
import type { IssueUsage, UsageReport } from "./protocol";

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

/**
 * One row. The default is an issue `gh` answered for; the degraded row — every
 * `gh`-sourced field null — is what an override of `{ title: null, url: null,
 * forecast: null, verdict: null }` produces, and is asserted on below.
 */
function makeIssue(over: Partial<IssueUsage> = {}): IssueUsage {
  return {
    issue: 101,
    out: 20_000,
    turns: 2,
    sessions: 1,
    cacheRead: 400_000,
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
        out: 3000,
        turns: 1,
        cacheRead: 12_000,
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
   * The columns, in the order `COLUMNS` declares them. Named rather than
   * counted at each assertion: an index into a nine-column row is exactly the
   * literal that goes stale silently when a column is inserted, and these are
   * the assertions that would then be checking a neighbour.
   */
  const CELL = {
    title: 0,
    forecast: 1,
    out: 2,
    bucket: 3,
    verdict: 4,
    turns: 5,
    sessions: 6,
    cacheRead: 7,
  } as const;

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
        issues: [makeIssue({ out: 31_500, turns: 3, sessions: 2 })],
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
