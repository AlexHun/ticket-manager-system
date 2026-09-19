import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi, beforeEach } from "vitest";
import { renderRoutes } from "@/test/render";
import { UsagePage } from "./UsagePage";
import { USAGE_COLUMNS, USAGE_DETAIL, USAGE_SPINE } from "./protocol";
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
    // Two turns on `main` or on no branch, spending 6,200 output tokens. Not
    // zero by default: a total nothing else on the page carries is exactly the
    // figure a default of zero would let the page quietly stop rendering.
    unattributed: { turns: 2, out: 6200 },
    warnings: [],
    ...over,
  };
}

const renderPage = () => renderRoutes([{ path: "/", element: <UsagePage /> }]);

const scanButton = () => screen.getByRole("button", { name: "Scan" });

/** The frame `TableFrame` puts round the spend table, once one has been read. */
const spendTable = () => screen.findByRole("region", { name: "Issue spend" });

/** Any of the page's named regions — the two chart panels and the unattributed
 *  total. All three are addressed by name for the same reason: the region is
 *  what a reader lands on, and it is what the E2E asks for too. */
const panel = (name: string) => screen.findByRole("region", { name });

/** Render, press Scan, and hand back the `user` for whatever comes next. Shared
 *  rather than written once per describe: the blocks below all begin this way,
 *  and a second copy is a second thing to keep in step with `renderPage`. */
const scanned = async () => {
  const user = userEvent.setup();
  renderPage();
  await user.click(scanButton());
  return user;
};

/**
 * The one control that appends the detail columns (#271).
 *
 * Addressed by its accessible name rather than by its visible chip, for the
 * same reason the project map's two toggles carry one: the chip is short enough
 * to fit above a table and the name is what says which three columns it is
 * about. A `Toggle` is a button with `aria-pressed`, so the state is asserted
 * from that attribute and never from the columns it happens to have produced.
 */
const detailToggle = () =>
  screen.getByRole("button", { name: /turns, sessions and cache read/i });

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

  /** What each detail column's header reads, so the toggle test can name the
   *  three columns it appends instead of trusting a count to have appended the
   *  right ones. Restated here on purpose: these are the words on screen, and a
   *  test that read them off `SpendTable` would agree with it about a typo. */
  const COLUMN_HEADING: Record<(typeof USAGE_DETAIL)[number], string> = {
    turns: "Turns",
    sessions: "Sessions",
    cacheRead: "Cache read",
  };

  /**
   * The two halves of the merged comparison cell, in the order they read: the
   * band forecast, then the band the spend landed in.
   *
   * Only the halves that are *absent* are addressed this way — a present band
   * is asserted by its text — so this returns the markers, and which index a
   * marker carries is what says which absence it is. That ordering is the cell's
   * contract, not an accident of the DOM: `Comparison` renders forecast, arrow,
   * landed, verdict, and a cell that put them the other way round would read as
   * the spend having been forecast from the actual.
   */
  const markersIn = (cell: HTMLElement) => within(cell).getAllByText("—");

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

  /**
   * R3/R4 (#270): the whole comparison in one cell, and the table seven columns
   * wide rather than nine.
   *
   * The sentence is what is asserted, not three neighbouring cells: band aimed
   * at, band landed in, and only then the word — with the letter and the range
   * together each time, because the letter alone is jargon and the range alone
   * does not match the label on the issue.
   */
  test("reads the forecast, the landed band and the verdict as one cell", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(scanButton());

    const cells = await cellsOf(1);
    expect(cells).toHaveLength(USAGE_SPINE.length);

    const comparison = cells[CELL.comparison]!;
    expect(comparison).toHaveTextContent("M 60-150k");
    expect(comparison).toHaveTextContent("S <60k");
    expect(comparison).toHaveTextContent("under");
    // Nothing is missing here, so neither marker is standing in for anything.
    expect(within(comparison).queryByText("—")).toBeNull();
  });

  /**
   * R1/R2 (#271): the table opens on its spine — four columns including the
   * issue row-header — and one control appends the rest.
   *
   * Counted against `USAGE_SPINE` rather than against the literal 4, for the
   * reason every index in this file is read off the contract: a column moved
   * between the two lists must fail here rather than quietly re-point the
   * assertions below at a neighbour.
   *
   * The header row carries one more than the body, always: the issue number is
   * a `columnheader` above and a `rowheader` beside each row, because it is what
   * every figure on the row is about rather than a figure itself.
   */
  test("opens on four columns, the issue row-header among them", async () => {
    await scanned();

    expect(await cellsOf(1)).toHaveLength(USAGE_SPINE.length);
    expect(
      within((await screen.findAllByRole("row"))[0]!).getAllByRole(
        "columnheader",
      ),
    ).toHaveLength(USAGE_SPINE.length + 1);
    expect(detailToggle()).toHaveAttribute("aria-pressed", "false");
    // Named, not merely absent: a header the spine does not carry is the thing
    // the control is for.
    expect(
      screen.queryByRole("columnheader", { name: /cache read/i }),
    ).toBeNull();
  });

  test("appends the detail columns on one press, and removes them again", async () => {
    const user = await scanned();
    await spendTable();

    await user.click(detailToggle());

    expect(detailToggle()).toHaveAttribute("aria-pressed", "true");
    expect(await cellsOf(1)).toHaveLength(USAGE_COLUMNS.length);
    for (const name of USAGE_DETAIL)
      expect(
        within(await spendTable()).getByRole("columnheader", {
          name: new RegExp(COLUMN_HEADING[name], "i"),
        }),
      ).toBeVisible();

    await user.click(detailToggle());

    expect(detailToggle()).toHaveAttribute("aria-pressed", "false");
    expect(await cellsOf(1)).toHaveLength(USAGE_SPINE.length);
  });

  /**
   * The reason the contract is two lists rather than one list with a flag.
   *
   * Detail columns **append**, so a spine cell sits at the same index in both
   * states and the one `CELL` map above serves both. Asserted on the cell's
   * contents rather than on its index alone: an index that matched while the
   * cell beside it had shifted is exactly the failure a positional contract
   * exists to make impossible, and it is invisible to a count.
   */
  test("keeps a spine cell at the same index with the detail columns shown", async () => {
    const user = await scanned();
    const before = (await cellsOf(1)).map((cell) => cell.textContent);

    await user.click(detailToggle());

    const after = await cellsOf(1);
    expect(
      after.slice(0, USAGE_SPINE.length).map((c) => c.textContent),
    ).toEqual(before);
    expect(after[CELL.out]).toHaveTextContent("20,000");
    expect(after[CELL.comparison]).toHaveTextContent("M 60-150k");
    // And the appended three really are the ones that were hidden.
    expect(after[CELL.turns]).toHaveTextContent("2");
    expect(after[CELL.sessions]).toHaveTextContent("1");
    expect(after[CELL.cacheRead]).toHaveTextContent("400,000");
  });

  /** The control belongs to the table, so it arrives with one and not before:
   *  there is nothing to widen until a scan has been read. */
  test("offers no column control until a scan has been read", () => {
    renderPage();

    expect(
      screen.queryByRole("button", { name: /turns, sessions and cache read/i }),
    ).toBeNull();
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
    const comparison = cells[CELL.comparison]!;
    // One marker, on the forecast half — and the band it landed in beside it,
    // since that is the row's own arithmetic and owes `gh` nothing.
    expect(markersIn(comparison)).toHaveLength(1);
    expect(comparison).toHaveTextContent("S <60k");
    expect(comparison).not.toHaveTextContent(/target|over|under/);
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
    // Turns and cache-read are detail columns since #271, so this is the state
    // the assertion below is about rather than the page's default.
    await user.click(detailToggle());

    const cells = await cellsOf(1);
    expect(cells[CELL.out]).toHaveTextContent("20,000");
    expect(cells[CELL.turns]).toHaveTextContent("2");
    expect(cells[CELL.cacheRead]).toHaveTextContent("400,000");
    const comparison = cells[CELL.comparison]!;
    // The landed band is derived from the figures, so it survives a `gh` that
    // does not — and the forecast half is the one marker in the cell.
    expect(comparison).toHaveTextContent("S <60k");
    expect(markersIn(comparison)).toHaveLength(1);
    expect(comparison).not.toHaveTextContent(/target|over|under/);
    expect(cells[CELL.title]).toHaveTextContent("—");
    expect(screen.queryByRole("link", { name: /Usage page/ })).toBeNull();
    expect(await screen.findByText(/gh` could not list/)).toBeInTheDocument();
  });

  /**
   * R4: a row is no longer proof that work happened. An open issue nobody has
   * started carries its band and nothing else — and above all no verdict, since
   * `bucketFor(0)` is `S` and a forecast of `L` read against it would print as
   * "under" on every untouched issue in the backlog.
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
    // All four figures are the claim here, and three of them are detail
    // columns — an assertion that only reached `out` would be a weaker test
    // than the one #251 earned.
    await user.click(detailToggle());

    const cells = await cellsOf(1);
    const comparison = cells[CELL.comparison]!;
    // What `gh` knows is all there is, and it is all shown.
    expect(comparison).toHaveTextContent("L 150-250k");
    expect(
      await screen.findByRole("link", { name: /Not started yet/ }),
    ).toBeVisible();
    // Every figure is empty rather than zero, and so is the half of the
    // comparison that would carry a band: there is none to land in until
    // something has been spent, and no verdict to read against the forecast.
    for (const column of ["out", "turns", "sessions", "cacheRead"])
      expect(cells[CELL[column as UsageColumn]]).toHaveTextContent("—");
    expect(markersIn(comparison)).toHaveLength(1);
    expect(comparison).not.toHaveTextContent(/target|over|under/);
    // Above all, not a band the page picked for it.
    expect(comparison).not.toHaveTextContent("<60k");
  });

  /**
   * The two absences render as the same em dash, so the words behind them are
   * the only thing that tells a reader which one they are looking at — and
   * since #270 both can sit inside the *same cell*, an inch apart.
   *
   * One row carries both, which is what makes this an assertion about the
   * *distinction* rather than about one marker: nothing has been spent on it
   * (so every figure and the landed band are `NotStarted`) and `gh` supplied no
   * band for it (so the forecast half is `Unknown`). Asserting only one would
   * pass just as well if the merged cell had collapsed them into one marker,
   * which is exactly the failure the merge risks.
   */
  const bothAbsent = async () => {
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
    return { user, cells: await cellsOf(1) };
  };

  // Three tests rather than three hovers in one: Radix keeps the open tooltip's
  // state on its provider, so a second trigger hovered in the same render does
  // not open. A fresh render per marker is the honest way to ask. The dash
  // itself is the tooltip's trigger, so it is what a pointer lands on — and
  // reaching it by its text keeps these off `Hint`'s internals.
  test("says a figure nobody has spent is unrecorded", async () => {
    const { user, cells } = await bothAbsent();

    await user.hover(within(cells[CELL.out]!).getByText("—"));

    expect(await screen.findByText(/no recorded work/i)).toBeInTheDocument();
  });

  test("says a band gh could not supply is unknown", async () => {
    const { user, cells } = await bothAbsent();
    const comparison = cells[CELL.comparison]!;
    // Both halves are dashed on this row, which is the point: the forecast is
    // the first, and it must not be the same marker as the one beside it.
    expect(markersIn(comparison)).toHaveLength(2);

    await user.hover(markersIn(comparison)[0]!);

    expect(await screen.findByText(/gh could not supply/i)).toBeInTheDocument();
  });

  test("says the band an unstarted issue landed in is unrecorded", async () => {
    const { user, cells } = await bothAbsent();

    await user.hover(markersIn(cells[CELL.comparison]!)[1]!);

    expect(await screen.findByText(/no recorded work/i)).toBeInTheDocument();
    // And not the other marker's words, which is the assertion that would fail
    // if the cell rendered one `Unknown` for both halves.
    expect(screen.queryByText(/gh could not supply/i)).toBeNull();
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

/**
 * R7 (#253): what ran on `main` or on no branch, reported as its own total.
 *
 * It is a large share of everything the machine has done — 28% of all turns
 * when the scan was written — and the page used to say only that it existed.
 * The three claims below are the acceptance criteria said in the page's own
 * terms: both figures are there, they are not an issue, and no row absorbed
 * them.
 */
describe("UsagePage unattributed work", () => {
  const unattributed = () => panel("Unattributed work");

  test("reports nothing about it until a scan has been read", () => {
    renderPage();

    expect(
      screen.queryByRole("region", { name: "Unattributed work" }),
    ).toBeNull();
  });

  test("reports it in turns and in output tokens", async () => {
    await scanned();

    const panel = await unattributed();
    expect(panel).toHaveTextContent("2 turns");
    expect(panel).toHaveTextContent("6,200 output tokens");
  });

  /**
   * The criterion the shape of this is for: it must read as *not an issue*.
   *
   * A row would be the obvious place to put it and is the one place it cannot
   * go — it has no issue number, nothing forecast it, and `bucketFor` would file
   * its tokens in a band as though somebody had estimated them. So the table
   * holds the same rows it did before and the total sits beside it.
   */
  test("keeps it out of the table rather than making it a row", async () => {
    await scanned();

    const table = await spendTable();
    const rows = within(table).getAllByRole("row");
    // Header, #101, #102 — the two issues the report carries, and nothing else.
    expect(rows).toHaveLength(3);
    expect(table).not.toHaveTextContent("6,200");
    expect(within(await unattributed()).queryByRole("link")).toBeNull();
    expect(await unattributed()).not.toHaveTextContent("#");
  });

  // Reported as a measurement rather than dropped. Nothing scores this figure —
  // no band, no verdict, no quartile — so a zero here is the honest answer to
  // "what ran on main", and its absence would read as the page not asking.
  test("reports a zero total rather than falling silent", async () => {
    post.mockResolvedValue({
      data: makeReport({ unattributed: { turns: 0, out: 0 } }),
    });
    await scanned();

    const panel = await unattributed();
    expect(panel).toHaveTextContent("0 turns");
    expect(panel).toHaveTextContent("0 output tokens");
  });

  test("says turn rather than turns when there was one", async () => {
    post.mockResolvedValue({
      data: makeReport({ unattributed: { turns: 1, out: 5000 } }),
    });
    await scanned();

    const panel = await unattributed();
    expect(panel).toHaveTextContent("1 turn");
    expect(panel).not.toHaveTextContent("1 turns");
  });

  test("replaces the total on a second press rather than holding the first", async () => {
    const user = await scanned();
    expect(await unattributed()).toHaveTextContent("6,200");

    post.mockResolvedValue({
      data: makeReport({ unattributed: { turns: 9, out: 31_500 } }),
    });
    await user.click(scanButton());

    await waitFor(async () =>
      expect(await unattributed()).toHaveTextContent("31,500"),
    );
    expect(await unattributed()).not.toHaveTextContent("6,200");
  });
});

/**
 * The two charts (#252), at the only level a component test can hold them.
 *
 * Recharts draws nothing in jsdom — every container measures zero, which is why
 * no dashboard chart has a component test either — so what is asserted here is
 * the panel around it: the figure in the corner, the footer, and above all the
 * two empty states, which are the parts that have to *say* something rather than
 * draw it. The drawn result is `tests/e2e/dev-usage.spec.ts`'s job; the
 * arithmetic is `usage-charts.test.ts`'s.
 */
describe("UsagePage charts", () => {
  test("draws neither chart until a scan has been read", async () => {
    renderPage();

    expect(
      screen.queryByRole("region", { name: "Forecast accuracy" }),
    ).toBeNull();
    expect(
      screen.queryByRole("region", { name: "Output distribution" }),
    ).toBeNull();
  });

  test("scores the issues that carry a forecast, and only those", async () => {
    await scanned();

    // Two rows, both with a verdict: #101 under, #102 on target.
    const accuracy = await panel("Forecast accuracy");
    expect(accuracy).toHaveTextContent(/1\/2 on target/);
    expect(accuracy).toHaveTextContent(/50%/);
  });

  /**
   * The acceptance criterion this chart exists to get right: with no forecast
   * labels anywhere it says there is nothing to score, rather than drawing three
   * empty columns under an axis — which reads as "we forecast everything and got
   * all of it wrong".
   *
   * It is also the ordinary state of this page with no `gh`: the bands come from
   * the listing, so a machine that cannot reach GitHub has every figure and
   * nothing to score.
   */
  test("says there is nothing to score when no issue carries a forecast", async () => {
    post.mockResolvedValue({
      data: makeReport({
        issues: [makeIssue({ forecast: null, verdict: null })],
      }),
    });
    await scanned();

    const accuracy = await panel("Forecast accuracy");
    expect(within(accuracy).getByRole("status")).toHaveTextContent(
      /nothing to score/i,
    );
    expect(accuracy).not.toHaveTextContent(/on target \(/);
  });

  test("marks the quartiles of the spend it actually recorded", async () => {
    await scanned();

    // 20,000 and 3,000: nearest-rank over two values puts p25 on the smaller and
    // both upper quartiles on the larger. The figures are the shared
    // `percentiles`, so they are the ones `bun run tokens` prints.
    const distribution = await panel("Output distribution");
    expect(distribution).toHaveTextContent(
      "p25 3,000 · median 20,000 · p75 20,000",
    );
    expect(distribution).toHaveTextContent(/2 issues with recorded spend/);
  });

  /**
   * The rule both readings share, asserted where it would be felt.
   *
   * The unstarted row carries a `forecast/L` band and no spend. Counted as a
   * zero it would be scored "under" — dragging the accuracy figure to 1/3 — and
   * would file itself in band `S` as a third measurement, pulling every quartile
   * down with it.
   */
  test("keeps an issue nobody has started out of both readings", async () => {
    post.mockResolvedValue({
      data: makeReport({
        issues: [
          makeIssue(),
          makeIssue({
            issue: 300,
            spend: null,
            forecast: "L",
            bucket: null,
            verdict: null,
          }),
        ],
      }),
    });
    await scanned();

    expect(await panel("Forecast accuracy")).toHaveTextContent(
      /0\/1 on target/,
    );
    expect(await panel("Output distribution")).toHaveTextContent(
      /1 issue with recorded spend/,
    );
  });

  test("says there is no distribution when nothing has been spent", async () => {
    post.mockResolvedValue({
      data: makeReport({
        issues: [makeIssue({ spend: null, bucket: null, verdict: null })],
      }),
    });
    await scanned();

    const distribution = await panel("Output distribution");
    expect(within(distribution).getByRole("status")).toHaveTextContent(
      /no recorded spend yet/i,
    );
    // Not three marks at the origin: `percentiles([])` answers 0/0/0, which
    // would draw as a repository of very cheap issues.
    expect(distribution).not.toHaveTextContent(/p25 0/);
  });

  test("redraws both charts on a fresh scan rather than holding the first", async () => {
    const user = await scanned();
    expect(await panel("Forecast accuracy")).toHaveTextContent(
      /1\/2 on target/,
    );

    post.mockResolvedValue({
      data: makeReport({
        issues: [
          makeIssue({ verdict: "on target" }),
          makeIssue({
            issue: 102,
            spend: { out: 3000, turns: 1, sessions: 1, cacheRead: 12_000 },
            forecast: "S",
            verdict: "on target",
          }),
        ],
      }),
    });
    await user.click(scanButton());

    await waitFor(async () =>
      expect(await panel("Forecast accuracy")).toHaveTextContent(
        /2\/2 on target/,
      ),
    );
    // The first reading is gone rather than sitting beneath the second.
    expect(await panel("Forecast accuracy")).not.toHaveTextContent(
      /1\/2 on target/,
    );
  });
});
