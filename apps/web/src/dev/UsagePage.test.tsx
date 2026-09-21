import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi, beforeEach } from "vitest";
import { renderRoutes } from "@/test/render";
import { UsagePage } from "./UsagePage";
import {
  USAGE_COLUMNS,
  USAGE_DETAIL,
  USAGE_DETAIL_LABEL,
  USAGE_FACETS,
  USAGE_FACET_KEYS,
  USAGE_NO_MATCH,
  USAGE_SEARCH_LABEL,
  USAGE_SPINE,
  USAGE_TABLE_LABEL,
} from "./protocol";
import type {
  Bucket,
  IssueUsage,
  UsageColumn,
  UsageFacetKey,
  UsageReport,
} from "./protocol";

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
const spendTable = () =>
  screen.findByRole("region", { name: USAGE_TABLE_LABEL });

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
 * about. The name itself comes from the contract rather than being retyped
 * here — see `USAGE_DETAIL_LABEL`. A `Toggle` is a button with `aria-pressed`,
 * so the state is asserted from that attribute and never from the columns it
 * happens to have produced.
 */
const detailToggle = () =>
  screen.getByRole("button", { name: USAGE_DETAIL_LABEL });

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
      screen.queryByRole("button", { name: USAGE_DETAIL_LABEL }),
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

/**
 * R5/R6, slice 3 (#272): the table ranks itself, and refuses to rank one row.
 *
 * The ordering rules themselves are `usage-sort.test.ts`'s — the sink asked of
 * every key in both directions, the total order, the measured zero that is not
 * an absence. What is asked here is everything that only exists once the rules
 * are wired to a header: which column a click ranks by, what the header says
 * about it, and whether the answer survives the next press of Scan.
 *
 * The rows are three because three is the smallest set that can tell a flip
 * from a reversal *and* carry the row that must sink through both. `#102` has
 * the smaller spend and the larger session count on purpose, so a sort by a
 * detail column is visibly not the sort by output tokens.
 */
describe("UsagePage sorting", () => {
  const UNSTARTED = 300;

  const sortableReport = () =>
    makeReport({
      issues: [
        makeIssue(),
        makeIssue({
          issue: 102,
          spend: { out: 3_000, turns: 9, sessions: 4, cacheRead: 12_000 },
          title: "A second issue",
          url: "https://github.com/AlexHun/ticket-manager-system/issues/102",
          forecast: "S",
          verdict: "on target",
        }),
        makeIssue({
          issue: UNSTARTED,
          spend: null,
          bucket: null,
          verdict: null,
          title: "Nobody has started this",
          url: "https://github.com/AlexHun/ticket-manager-system/issues/300",
          forecast: "L",
        }),
      ],
    });

  /** The column header cell, which is where the direction is announced. */
  const header = (name: string) =>
    screen.getByRole("columnheader", { name: new RegExp(`^${name}$`, "i") });

  /** The control inside it. A header that sorts carries a button; one that does
   *  not carries its label and nothing else. */
  const sortBy = (user: ReturnType<typeof userEvent.setup>, name: string) =>
    user.click(screen.getByRole("button", { name }));

  /** The rows in the order they are rendered, by the issue each one is about. */
  const issueOrder = async () =>
    within(await spendTable())
      .getAllByRole("rowheader")
      .map((cell) => cell.textContent);

  beforeEach(() => {
    post.mockResolvedValue({ data: sortableReport() });
  });

  /**
   * The first render after a scan is the rows as they arrived, so pressing Scan
   * does not hand back a table that immediately reshuffles itself. Both halves
   * are asserted — the order, and the header saying which order it is — because
   * a page that sorted correctly and announced nothing would pass on the rows
   * alone.
   */
  test("opens on output tokens descending, the order the rows arrive in", async () => {
    await scanned();

    expect(await issueOrder()).toEqual(["#101", "#102", `#${UNSTARTED}`]);
    expect(header("Output tokens")).toHaveAttribute("aria-sort", "descending");
    expect(header("Issue")).toHaveAttribute("aria-sort", "none");
    // A column nothing ranks by says nothing rather than "none": `aria-sort` on
    // it would advertise a sort that is not offered.
    expect(header("Title")).not.toHaveAttribute("aria-sort");
  });

  test("reverses the active column on a second click", async () => {
    const user = await scanned();
    await spendTable();

    await sortBy(user, "Output tokens");

    expect(await issueOrder()).toEqual(["#102", "#101", `#${UNSTARTED}`]);
    expect(header("Output tokens")).toHaveAttribute("aria-sort", "ascending");

    await sortBy(user, "Output tokens");

    expect(await issueOrder()).toEqual(["#101", "#102", `#${UNSTARTED}`]);
    expect(header("Output tokens")).toHaveAttribute("aria-sort", "descending");
  });

  /**
   * The ticket's real constraint, at the level a reader meets it. `#300` is an
   * open issue nobody has started: ascending by output tokens is where a row
   * read as zero would float to the top as the cheapest work in the repository,
   * and its forecast band would then score it as having come in under.
   */
  test("keeps an issue nobody has started last in both directions", async () => {
    const user = await scanned();
    await spendTable();

    for (const _ of [0, 1]) {
      expect((await issueOrder()).at(-1)).toBe(`#${UNSTARTED}`);
      await sortBy(user, "Output tokens");
    }
    expect((await issueOrder()).at(-1)).toBe(`#${UNSTARTED}`);
  });

  test("ranks by a detail column once the detail columns are shown", async () => {
    const user = await scanned();
    await spendTable();
    await user.click(detailToggle());

    await sortBy(user, "Sessions");

    // Sessions and output tokens disagree about these two rows, which is what
    // says the click ranked by the column it was on.
    expect(await issueOrder()).toEqual(["#102", "#101", `#${UNSTARTED}`]);
    expect(header("Sessions")).toHaveAttribute("aria-sort", "descending");
    expect(header("Output tokens")).toHaveAttribute("aria-sort", "none");
    expect((await cellsOf(1))[CELL.sessions]).toHaveTextContent("4");
  });

  /**
   * The issue number is a column too, and the only sortable one an unstarted
   * row carries a value for — so the sink is what decides where `#300` goes,
   * not the number itself.
   */
  test("ranks by the issue number from the column that names the rows", async () => {
    const user = await scanned();
    await spendTable();

    await sortBy(user, "Issue");

    expect(await issueOrder()).toEqual(["#102", "#101", `#${UNSTARTED}`]);
    expect(header("Issue")).toHaveAttribute("aria-sort", "descending");

    await sortBy(user, "Issue");

    expect(await issueOrder()).toEqual(["#101", "#102", `#${UNSTARTED}`]);
  });

  /**
   * A scan is a reading; the sort is how the developer is reading it. Pressing
   * Scan again answers the same question, so it must not throw the answer's
   * arrangement away.
   *
   * This is the assertion that catches the shape the page is actually in: the
   * mutation clears `data` the moment it is fired, so the table unmounts for
   * the length of the read and any state left inside it goes with it.
   */
  test("keeps the chosen sort when Scan is pressed again", async () => {
    const user = await scanned();
    await spendTable();
    await sortBy(user, "Output tokens");
    expect(await issueOrder()).toEqual(["#102", "#101", `#${UNSTARTED}`]);

    await user.click(scanButton());

    await waitFor(async () => expect(post).toHaveBeenCalledTimes(2));
    expect(await issueOrder()).toEqual(["#102", "#101", `#${UNSTARTED}`]);
    expect(header("Output tokens")).toHaveAttribute("aria-sort", "ascending");
  });

  /**
   * A ranking with nothing left to announce it is the state this rule exists
   * to make unreachable.
   *
   * `turns` only has a header while the detail columns are shown, so hiding
   * them while the table is ranked by it would leave the rows in an order with
   * no arrow, no `aria-sort` and nothing on screen saying why. Going back to
   * the order the rows arrived in is the one outcome that can still be
   * announced, and it happens in the same gesture that caused it.
   */
  test("returns to the default ranking when the column it ranked by is hidden", async () => {
    const user = await scanned();
    await spendTable();
    await user.click(detailToggle());
    await sortBy(user, "Turns");
    expect(await issueOrder()).toEqual(["#102", "#101", `#${UNSTARTED}`]);

    await user.click(detailToggle());

    expect(await issueOrder()).toEqual(["#101", "#102", `#${UNSTARTED}`]);
    expect(header("Output tokens")).toHaveAttribute("aria-sort", "descending");
    expect(screen.queryByRole("columnheader", { name: /turns/i })).toBeNull();
  });

  /**
   * The other half of the same rule, and the reason both pieces of state sit on
   * the page rather than only the sort.
   *
   * A sort on a detail column that came back from a re-scan without the column
   * beside it would satisfy "the chosen sort survives" and break "the active
   * column shows its direction" in the same render.
   */
  test("keeps the detail columns, and a sort on one of them, across a re-scan", async () => {
    const user = await scanned();
    await spendTable();
    await user.click(detailToggle());
    await sortBy(user, "Sessions");
    expect(await issueOrder()).toEqual(["#102", "#101", `#${UNSTARTED}`]);

    await user.click(scanButton());

    await waitFor(async () => expect(post).toHaveBeenCalledTimes(2));
    expect(detailToggle()).toHaveAttribute("aria-pressed", "true");
    expect(header("Sessions")).toHaveAttribute("aria-sort", "descending");
    expect(await issueOrder()).toEqual(["#102", "#101", `#${UNSTARTED}`]);
  });

  /**
   * Sorting rearranges the rows and nothing else. The two charts read the whole
   * report, the unattributed total belongs to no row at all, and the line at the
   * top describes the reading rather than its arrangement — so all three have to
   * come through a re-rank unchanged.
   */
  test("leaves the charts, the unattributed total and the reading alone", async () => {
    const user = await scanned();
    const before = {
      accuracy: (await panel("Forecast accuracy")).textContent,
      distribution: (await panel("Output distribution")).textContent,
      unattributed: (await panel("Unattributed work")).textContent,
      gathered: (await screen.findByText(/^Gathered at/)).textContent,
    };

    await sortBy(user, "Output tokens");

    expect((await panel("Forecast accuracy")).textContent).toBe(
      before.accuracy,
    );
    expect((await panel("Output distribution")).textContent).toBe(
      before.distribution,
    );
    expect((await panel("Unattributed work")).textContent).toBe(
      before.unattributed,
    );
    expect((await screen.findByText(/^Gathered at/)).textContent).toBe(
      before.gathered,
    );
  });
});

/**
 * R7, R9, R10, R11 and R12 (#273): one box narrows the table, and the reach of
 * it stops there.
 *
 * The reach is the whole ticket. Everything else on the page — the accuracy
 * figure, the distribution marks, the unattributed total and the gathered-at
 * line — describes the *scan*, and a filter that moved any of them would turn a
 * claim about this repository into a claim about a search box. So the last two
 * blocks here are not decoration on the narrowing tests: they are what the
 * slice is for.
 */
describe("UsagePage search", () => {
  const UNSTARTED = 300;

  const searchableReport = () =>
    makeReport({
      issues: [
        makeIssue(),
        makeIssue({
          issue: 102,
          spend: { out: 3_000, turns: 1, sessions: 1, cacheRead: 12_000 },
          title: "A second issue",
          url: "https://github.com/AlexHun/ticket-manager-system/issues/102",
          forecast: "S",
          verdict: "on target",
        }),
        makeIssue({
          issue: UNSTARTED,
          spend: null,
          bucket: null,
          verdict: null,
          title: "Nobody has started this",
          url: "https://github.com/AlexHun/ticket-manager-system/issues/300",
          forecast: "L",
        }),
      ],
    });

  const ALL = ["#101", "#102", `#${UNSTARTED}`];

  /** The rows on screen, by the issue each one is about. */
  const issueOrder = async () =>
    within(await spendTable())
      .getAllByRole("rowheader")
      .map((cell) => cell.textContent);

  const searchBox = () => screen.getByLabelText(USAGE_SEARCH_LABEL);

  /**
   * Type a term and wait out the debounce.
   *
   * The wait describes the **settled** state and carries an explicit timeout,
   * which is `testing.md`'s rule for anything debounced: RTL's `waitFor` has its
   * own 1,000 ms default that Vitest's `testTimeout` does not govern, and a
   * prefix of the term renders on the way past it.
   */
  const searchFor = async (
    user: ReturnType<typeof userEvent.setup>,
    term: string,
    settled: string[],
  ) => {
    await user.clear(searchBox());
    await user.type(searchBox(), term);
    await waitFor(async () => expect(await issueOrder()).toEqual(settled), {
      timeout: 5_000,
    });
  };

  beforeEach(() => {
    post.mockResolvedValue({ data: searchableReport() });
  });

  /**
   * R12: the bar is gated on a reading like everything else on this page. A
   * filter over no data is an invitation to configure a view of nothing, and
   * the scan does not survive a reload, so there would be nothing to configure
   * it against.
   */
  test("offers no search box until a scan has been read", async () => {
    renderPage();

    expect(screen.queryByLabelText(USAGE_SEARCH_LABEL)).toBeNull();

    await userEvent.setup().click(scanButton());

    expect(await screen.findByLabelText(USAGE_SEARCH_LABEL)).toBeVisible();
  });

  test("narrows the table to an issue number", async () => {
    const user = await scanned();
    await spendTable();

    await searchFor(user, "102", ["#102"]);
  });

  /** The number is matched as the row prints it, so the `#` a developer copies
   *  out of the table or a commit message is not a term that matches nothing. */
  test("narrows the table to an issue number written with its hash", async () => {
    const user = await scanned();
    await spendTable();

    await searchFor(user, "#300", [`#${UNSTARTED}`]);
  });

  test("narrows the table to words from a title", async () => {
    const user = await scanned();
    await spendTable();

    await searchFor(user, "second", ["#102"]);
  });

  /** An empty query matches everything — `matchesQuery`'s rule, and the reason
   *  the filter is applied unconditionally rather than behind an "is the
   *  developer searching" branch. */
  test("matches every row again once the box is cleared", async () => {
    const user = await scanned();
    await spendTable();
    await searchFor(user, "second", ["#102"]);

    await user.clear(searchBox());

    await waitFor(async () => expect(await issueOrder()).toEqual(ALL), {
      timeout: 5_000,
    });
  });

  /**
   * The debounce, proved rather than timed.
   *
   * Asserting "still three rows" straight after a real-timer `type()` would be
   * a race against the 150 ms the hook waits: it passes on an idle machine and
   * goes red under a loaded one, which is the flake `testing.md` records for
   * the tickets list. Under a fake clock the two states are separable — the
   * term is in the box and nothing has moved, and then the clock is what moves
   * it — so this is the one assertion in the file that can say *why* the table
   * narrowed rather than only that it did.
   *
   * **`fireEvent`, not `userEvent`, and that is what makes it work at all.**
   * `userEvent` awaits between keystrokes through RTL's async wrapper, which
   * needs a clock that is running; under `vi.useFakeTimers()` the very first
   * `type()` never resolves, the test dies on Vitest's own 15 s timeout, and
   * the `finally` that would have restored the clock never runs — so every test
   * after it in the file times out too. A `change` event is synchronous, is
   * already wrapped in `act`, and is all this needs: nothing here is about how
   * the characters arrive, only about when the term is spent.
   */
  test("filters once the typing settles rather than on every keystroke", async () => {
    await scanned();
    await spendTable();
    const rowsNow = () =>
      within(screen.getByRole("region", { name: USAGE_TABLE_LABEL }))
        .getAllByRole("rowheader")
        .map((cell) => cell.textContent);

    vi.useFakeTimers();
    try {
      fireEvent.change(searchBox(), { target: { value: "102" } });

      expect(searchBox()).toHaveValue("102");
      expect(rowsNow()).toEqual(ALL);

      // Generously past the debounce rather than exactly on it: what is being
      // held is that the clock has to move at all, not the length of the wait.
      act(() => {
        vi.advanceTimersByTime(1_000);
      });

      expect(rowsNow()).toEqual(["#102"]);
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * R9: a line still claiming three over one visible row is the same lie the
   * project map's frozen module counter used to tell, so the count moves when
   * the rows do. `countLabel` is the shared helper — a bare total at rest, and
   * `shown of total` while anything is narrowing it.
   */
  test("states how many rows are shown out of how many exist", async () => {
    const user = await scanned();
    await spendTable();

    expect(screen.getByText(`${USAGE_TABLE_LABEL} (3)`)).toBeVisible();

    await searchFor(user, "102", ["#102"]);

    expect(screen.getByText(`${USAGE_TABLE_LABEL} (1 of 3)`)).toBeVisible();
  });

  /**
   * A term that matches nothing says so, and — this is the half that matters —
   * leaves the box you typed it into on screen. An empty state that took the
   * controls with it would be a trap: the query that emptied the table would
   * have no control left to clear it from.
   */
  test("says nothing matches rather than showing a table with no rows", async () => {
    const user = await scanned();
    await spendTable();

    await user.type(searchBox(), "nothing-matches-this");

    await waitFor(
      () => expect(screen.getByText(USAGE_NO_MATCH)).toBeVisible(),
      { timeout: 5_000 },
    );
    expect(searchBox()).toBeVisible();
    expect(screen.getByText(`${USAGE_TABLE_LABEL} (0 of 3)`)).toBeVisible();
  });

  /**
   * R11. A scan is a reading; the query is how the developer is reading it. You
   * press Scan to refresh the figures, not to clear your view — and the
   * mutation clears its `data` while it reads, so the table and the bar above
   * it really do unmount and come back.
   */
  test("keeps the query when Scan is pressed again", async () => {
    const user = await scanned();
    await spendTable();
    await searchFor(user, "102", ["#102"]);

    await user.click(scanButton());

    await waitFor(async () => expect(post).toHaveBeenCalledTimes(2));
    expect(searchBox()).toHaveValue("102");
    expect(await issueOrder()).toEqual(["#102"]);
  });

  /**
   * Deliberately unlike the tickets list and the dashboard, which put their
   * filters in the URL. This page's scan does not survive a reload, so a
   * restored query would deserialize onto an empty page and describe rows that
   * are not there.
   */
  test("puts nothing about the query in the URL", async () => {
    const user = userEvent.setup();
    const { router } = renderPage();
    await user.click(scanButton());
    await spendTable();

    await searchFor(user, "102", ["#102"]);

    expect(router.state.location.search).toBe("");
  });

  /**
   * R10, and the reason this slice is where it is proved.
   *
   * The accuracy figure describes the whole scan. It is the number somebody
   * might quote, and a filter that moved it would turn a claim about this
   * repository into a claim about a search box — so the two charts, the
   * unattributed total and the gathered-at line have to read identically either
   * side of a narrowing. Compared on `textContent` rather than on a figure
   * picked out of each, because what is being asserted is that *nothing* in
   * them moved.
   */
  test("leaves the charts, the unattributed total and the reading alone", async () => {
    const user = await scanned();
    const before = {
      accuracy: (await panel("Forecast accuracy")).textContent,
      distribution: (await panel("Output distribution")).textContent,
      unattributed: (await panel("Unattributed work")).textContent,
      gathered: (await screen.findByText(/^Gathered at/)).textContent,
    };

    await searchFor(user, "102", ["#102"]);

    expect((await panel("Forecast accuracy")).textContent).toBe(
      before.accuracy,
    );
    expect((await panel("Output distribution")).textContent).toBe(
      before.distribution,
    );
    expect((await panel("Unattributed work")).textContent).toBe(
      before.unattributed,
    );
    expect((await screen.findByText(/^Gathered at/)).textContent).toBe(
      before.gathered,
    );
  });

  /**
   * The two controls above the table are independent: a narrowed table still
   * ranks from its headers, and the query survives the click that re-ranks it.
   */
  test("ranks what the query left, and keeps the query while it does", async () => {
    const user = await scanned();
    await spendTable();

    await searchFor(user, "10", ["#101", "#102"]);
    await user.click(screen.getByRole("button", { name: "Output tokens" }));

    expect(await issueOrder()).toEqual(["#102", "#101"]);
    expect(searchBox()).toHaveValue("10");
  });
});

/**
 * R8, slice 5 (#274): three selects beside the box, and the composition of all
 * four.
 *
 * The facet *predicates* are unit-tested over made-up rows in
 * `usage-facets.test.ts`, which is where "an absence is not a quantity" is
 * asked of every option. What only this level can say is that the controls
 * exist, are named, reach the rows, compose with the query and with each other,
 * and survive the press of Scan that re-asks the same question.
 *
 * The rows are chosen so that every assertion below has a wrong answer that
 * would be visible: `#105` is the only one over its band, `#101` the only one
 * on target, `#102` carries figures and no band at all, and `#300` a band and
 * no figures. A facet that matched too widely picks up one of the other three.
 */
describe("UsagePage facets", () => {
  const OVER = 105;
  const UNSTARTED = 300;

  /** An on-target row, a row over its band, a row nobody forecast, and a row
   *  nobody has started — the four states the three facets cut across. */
  const facetedReport = () =>
    makeReport({
      issues: [
        makeIssue({
          issue: OVER,
          spend: { out: 90_000, turns: 1, sessions: 1, cacheRead: 250_000 },
          title: "An issue that came in over its band",
          url: "https://github.com/AlexHun/ticket-manager-system/issues/105",
          forecast: "S",
          bucket: "M",
          verdict: "over",
        }),
        makeIssue({
          issue: 101,
          forecast: "S",
          bucket: "S",
          verdict: "on target",
        }),
        makeIssue({
          issue: 102,
          spend: { out: 3_000, turns: 1, sessions: 1, cacheRead: 12_000 },
          title: "A second issue",
          url: "https://github.com/AlexHun/ticket-manager-system/issues/102",
          forecast: null,
          verdict: null,
        }),
        makeIssue({
          issue: UNSTARTED,
          spend: null,
          bucket: null,
          verdict: null,
          title: "Nobody has started this",
          url: "https://github.com/AlexHun/ticket-manager-system/issues/300",
          forecast: "L",
        }),
      ],
    });

  /** Output tokens descending with the unstarted row sunk — the order the rows
   *  arrive in, and what every narrowing below is a subset of. */
  const ALL = [`#${OVER}`, "#101", "#102", `#${UNSTARTED}`];

  const issueOrder = async () =>
    within(await spendTable())
      .getAllByRole("rowheader")
      .map((cell) => cell.textContent);

  const searchBox = () => screen.getByLabelText(USAGE_SEARCH_LABEL);

  /**
   * A facet's select, by the accessible name its `<Label>` gives it.
   *
   * A Radix `Select` is a `combobox`, not a native `<select>`, so nothing here
   * can use `selectOptions` and the current value is read off the trigger's
   * text rather than with `toHaveValue` — `frontend.md`'s rule, and the shims
   * these need in jsdom are already in `src/test/setup.ts`.
   */
  const facetSelect = (key: UsageFacetKey) =>
    screen.getByRole("combobox", { name: USAGE_FACETS[key].label });

  /** Open a facet and pick a row from it, by the words on the row. */
  const pickFacet = async (
    user: ReturnType<typeof userEvent.setup>,
    key: UsageFacetKey,
    option: string,
  ) => {
    await user.click(facetSelect(key));
    await user.click(await screen.findByRole("option", { name: option }));
  };

  /** The band rows read as the letter and the range that letter means, the same
   *  pair a row's comparison cell prints — the letter alone is jargon. */
  const band = (value: Bucket) =>
    USAGE_FACETS.forecast.options.find((option) => option.value === value)!
      .label;

  beforeEach(() => {
    post.mockResolvedValue({ data: facetedReport() });
  });

  /**
   * R12, the same gate the search box is behind: a filter bar over no data is
   * an invitation to configure a view of nothing, and the scan does not survive
   * a reload, so there would be nothing to configure it against.
   */
  test("offers no facet selects until a scan has been read", async () => {
    renderPage();

    for (const key of USAGE_FACET_KEYS) {
      expect(
        screen.queryByRole("combobox", { name: USAGE_FACETS[key].label }),
      ).toBeNull();
    }

    await userEvent.setup().click(scanButton());
    await spendTable();

    for (const key of USAGE_FACET_KEYS) {
      expect(facetSelect(key)).toBeVisible();
    }
  });

  /** Each opens on its "any" row, which is the state the table opens in: three
   *  controls that are present and narrowing nothing. */
  test("opens with every facet at its any row", async () => {
    await scanned();
    await spendTable();

    for (const key of USAGE_FACET_KEYS) {
      expect(facetSelect(key)).toHaveTextContent(USAGE_FACETS[key].any);
    }
    expect(await issueOrder()).toEqual(ALL);
  });

  test("narrows the table to a single forecast band", async () => {
    const user = await scanned();
    await spendTable();

    await pickFacet(user, "forecast", band("S"));

    // Both `S` rows, still ranked by spend — and not `#102`, which carries no
    // band at all, nor `#300`, whose band is `L`.
    expect(await issueOrder()).toEqual([`#${OVER}`, "#101"]);
    expect(facetSelect("forecast")).toHaveTextContent(band("S"));
  });

  /**
   * The verdict the ticket is named for. "Which issues came in over their
   * forecast?" is one action, and the answer is the one row that did.
   */
  test("narrows the table to a verdict, including over", async () => {
    const user = await scanned();
    await spendTable();

    await pickFacet(user, "verdict", "over");

    expect(await issueOrder()).toEqual([`#${OVER}`]);

    await pickFacet(user, "verdict", "on target");

    expect(await issueOrder()).toEqual(["#101"]);
  });

  test("narrows the table to started, and to unstarted, issues", async () => {
    const user = await scanned();
    await spendTable();

    await pickFacet(user, "started", "Not started");

    expect(await issueOrder()).toEqual([`#${UNSTARTED}`]);

    await pickFacet(user, "started", "Started");

    expect(await issueOrder()).toEqual([`#${OVER}`, "#101", "#102"]);
  });

  /**
   * The "any" row is what clears a facet, and it needs a non-empty token to be
   * a `SelectItem` at all — Radix reserves `""` for *cleared* and throws on it.
   * `ANY_FACET` is that token; this is the assertion that it round-trips.
   */
  test("clears a facet from its any row", async () => {
    const user = await scanned();
    await spendTable();
    await pickFacet(user, "verdict", "over");
    expect(await issueOrder()).toEqual([`#${OVER}`]);

    await pickFacet(user, "verdict", USAGE_FACETS.verdict.any);

    expect(await issueOrder()).toEqual(ALL);
  });

  /** Two facets at once are an `and`, not an `or` — which is also how the
   *  empty state below is reachable from the bar alone. */
  test("requires every facet a developer has set", async () => {
    const user = await scanned();
    await spendTable();

    await pickFacet(user, "forecast", band("S"));
    await pickFacet(user, "verdict", "over");

    expect(await issueOrder()).toEqual([`#${OVER}`]);
  });

  /**
   * R7 thickened: the facets and the search box are one filter, so both apply
   * at once. `forecast/S` alone leaves two rows and `101` alone leaves one of
   * each pair, so a run where either was being ignored shows a different table.
   */
  test("composes a facet with the search query", async () => {
    const user = await scanned();
    await spendTable();

    await pickFacet(user, "forecast", band("S"));
    await user.type(searchBox(), "101");

    await waitFor(async () => expect(await issueOrder()).toEqual(["#101"]), {
      timeout: 5_000,
    });
    expect(screen.getByText(`${USAGE_TABLE_LABEL} (1 of 4)`)).toBeVisible();
  });

  /**
   * R9: the count describes every control on the bar rather than the box
   * alone. A line still reading four over two visible rows is the same lie the
   * project map's frozen module counter used to tell.
   */
  test("counts what every control left, not what the query left", async () => {
    const user = await scanned();
    await spendTable();
    expect(screen.getByText(`${USAGE_TABLE_LABEL} (4)`)).toBeVisible();

    await pickFacet(user, "forecast", band("S"));

    expect(screen.getByText(`${USAGE_TABLE_LABEL} (2 of 4)`)).toBeVisible();
  });

  /**
   * A facet matching nothing says so, and leaves the controls that produced it
   * on screen. An empty state that took them with it would be a trap: the
   * selection that emptied the table would have nothing left to clear it from
   * — and unlike a typed term, a facet cannot be guessed at from the rows.
   *
   * `M` is the band nothing in this report was forecast into, which is the
   * whole reason the options are the vocabulary rather than an inventory of the
   * rows on screen.
   */
  test("says nothing matches rather than showing a table with no rows", async () => {
    const user = await scanned();
    await spendTable();

    await pickFacet(user, "forecast", band("M"));

    expect(screen.getByText(USAGE_NO_MATCH)).toBeVisible();
    expect(screen.getByText(`${USAGE_TABLE_LABEL} (0 of 4)`)).toBeVisible();
    for (const key of USAGE_FACET_KEYS) {
      expect(facetSelect(key)).toBeVisible();
    }
    expect(searchBox()).toBeVisible();
  });

  /**
   * R11. You press Scan to refresh the figures, not to clear your view — and
   * the mutation clears its `data` while it reads, so the bar and the table
   * really do unmount and come back. This is why the facets live in
   * `UsageTableView` on the page rather than inside `SpendTable`.
   */
  test("keeps the facets when Scan is pressed again", async () => {
    const user = await scanned();
    await spendTable();
    await pickFacet(user, "verdict", "over");
    expect(await issueOrder()).toEqual([`#${OVER}`]);

    await user.click(scanButton());

    await waitFor(async () => expect(post).toHaveBeenCalledTimes(2));
    expect(facetSelect("verdict")).toHaveTextContent("over");
    expect(await issueOrder()).toEqual([`#${OVER}`]);
  });

  /**
   * R10, the guardrail, re-asserted for the second kind of control. The
   * accuracy figure describes the whole scan — it is the number somebody might
   * quote — so a filter that moved it would turn a claim about this repository
   * into a claim about what somebody picked from a dropdown. Compared on
   * `textContent` because what is held is that *nothing* in them moved.
   */
  test("leaves the charts, the unattributed total and the reading alone", async () => {
    const user = await scanned();
    const before = {
      accuracy: (await panel("Forecast accuracy")).textContent,
      distribution: (await panel("Output distribution")).textContent,
      unattributed: (await panel("Unattributed work")).textContent,
      gathered: (await screen.findByText(/^Gathered at/)).textContent,
    };

    await pickFacet(user, "verdict", "over");
    expect(await issueOrder()).toEqual([`#${OVER}`]);

    expect((await panel("Forecast accuracy")).textContent).toBe(
      before.accuracy,
    );
    expect((await panel("Output distribution")).textContent).toBe(
      before.distribution,
    );
    expect((await panel("Unattributed work")).textContent).toBe(
      before.unattributed,
    );
    expect((await screen.findByText(/^Gathered at/)).textContent).toBe(
      before.gathered,
    );
  });

  /** The bar's controls are independent of the ranking: a narrowed table still
   *  ranks from its headers, and the facet survives the click that re-ranks
   *  it. */
  test("ranks what the facets left, and keeps them while it does", async () => {
    const user = await scanned();
    await spendTable();

    await pickFacet(user, "started", "Started");
    await user.click(screen.getByRole("button", { name: "Output tokens" }));

    expect(await issueOrder()).toEqual(["#102", "#101", `#${OVER}`]);
    expect(facetSelect("started")).toHaveTextContent("Started");
  });
});
