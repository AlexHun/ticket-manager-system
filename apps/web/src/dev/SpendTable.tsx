import { useId, useMemo, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Columns3,
  ExternalLink,
  Search,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Hint } from "@/components/Hint";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Toggle } from "@/components/ui/toggle";
import { TableFrame } from "@/lib/table-frame";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { cn } from "@/lib/utils";
import { SEARCH_DEBOUNCE_MS, countLabel, matchesQuery } from "./module-match";
import { UsageFilters } from "./UsageFilters";
import { formatTokens } from "./usage-charts";
import { DEFAULT_USAGE_FACETS, matchesFacets } from "./usage-facets";
import {
  DEFAULT_USAGE_SORT,
  nextSort,
  sortIssues,
  type UsageSort,
  type UsageSortKey,
} from "./usage-sort";
import {
  USAGE_COLUMNS,
  USAGE_DETAIL,
  USAGE_DETAIL_LABEL,
  USAGE_NO_MATCH,
  USAGE_SEARCH_LABEL,
  USAGE_SPINE,
  USAGE_TABLE_LABEL,
  BUCKETS,
  VERDICT,
  type Bucket,
  type IssueSpend,
  type IssueUsage,
  type UsageColumn,
  type UsageFacets,
  type Verdict,
} from "./protocol";

/**
 * The Usage page's spend table, and the definitions of every column in it.
 *
 * Lifted out of `UsagePage.tsx` whole (#270), which had grown to hold the page,
 * this table, the column record and four small components at once — and is the
 * file each of the four tickets after this one edits. Nothing about the page
 * changed in the move; what the page keeps is the parts that describe a
 * *reading* rather than a row (`Gathered`, `Unattributed`), and what came here
 * is everything that renders an issue.
 *
 * **Two sources per row, and the table never lets them be confused.** The
 * figures are read off the filesystem; the title, the link and the forecast
 * band come from `gh`, which may be absent. Anything `gh` could not supply
 * renders as an em dash meaning *unknown* — never a zero, never a default band,
 * and never a verdict, because a verdict on work nobody forecast is a score
 * invented by the page. With `gh` missing or unauthenticated every figure a row
 * has still lands and only those parts go quiet, which is the state CI is in by
 * default.
 */

/**
 * Stands in for a value `gh` could not supply.
 *
 * One marker for everything that can lack one for this reason, because they
 * fail together and mean the same thing: *unknown*. The distinction it protects
 * is the page's only real claim — an empty forecast is not a forecast of zero,
 * and an empty verdict is not a passing grade. The hint is where that is said
 * in words, since a bare dash is not self-explanatory to anyone who has not
 * read this file.
 */
const Unknown = () => (
  <Hint content="Unknown — gh could not supply this">
    <span className="text-muted-foreground">&mdash;</span>
  </Hint>
);

/**
 * Stands in for a figure there is no work to report.
 *
 * The same dash as `Unknown` above and deliberately a different component,
 * because it is a different claim: `Unknown` means the question could not be
 * asked, this means it was asked and the answer is *nothing yet*. The
 * transcripts were read and they name no branch for this issue.
 *
 * What it must never be is a zero. `bucketFor(0)` is `S` and a forecast of `L`
 * read against it is "under", so an unstarted issue rendered as zeroes would
 * sit in the table claiming to have come in comfortably under budget — and
 * would take the accuracy figure and the percentile distribution down with it.
 * The two markers are told apart on hover rather than by sight, which is enough
 * because the *pattern* of dashes already differs: a `gh` that failed leaves the
 * figures standing, an issue nobody has started leaves only its title.
 */
const NotStarted = () => (
  <Hint content="No recorded work — these transcripts name no branch for this issue">
    <span className="text-muted-foreground">&mdash;</span>
  </Hint>
);

/** A band, as its letter and the range that letter means. Both, because the
 *  letter alone is jargon and the range alone does not match the label on the
 *  issue. */
const Band = ({ band }: { band: Bucket }) => (
  <span className="whitespace-nowrap">
    <span className="font-medium">{band}</span>{" "}
    <span className="text-xs text-muted-foreground">{BUCKETS[band].label}</span>
  </span>
);

/**
 * A numeric cell, from the figure it reads off a row's spend.
 *
 * One definition rather than four, because the branch is the same one every
 * time and it is the branch that carries this slice's rule: a row with no spend
 * has no figures, and each of the four is absent exactly when the others are —
 * which is why `IssueSpend` is one nullable object on the wire rather than four
 * nullable numbers.
 */
const figure =
  (pick: (spend: IssueSpend) => number) =>
  (row: IssueUsage): ReactNode =>
    row.spend ? formatTokens(pick(row.spend)) : <NotStarted />;

/** Colour carries the same three verdicts the word does, and adds nothing: over
 *  is the one worth catching an eye. */
const VERDICT_VARIANT: Record<Verdict, "default" | "outline" | "destructive"> =
  {
    [VERDICT.onTarget]: "default",
    [VERDICT.over]: "destructive",
    [VERDICT.under]: "outline",
  };

/**
 * The band aimed at, the band landed in, and the word comparing them — in one
 * cell (#270).
 *
 * Three columns until this slice, which spelled the comparison out across the
 * width of the table and made it the reason nobody could read the table without
 * scrolling sideways. As a sentence — `M 60-150k → S <60k` and then the verdict
 * — it is the same three facts in the order they are actually read, and the
 * arrow is what says which way round they go.
 *
 * **The merge must not cost the distinction the page is built on.** Two
 * different absences live here and they are not the same claim: the left half
 * is `Unknown` when `gh` could not supply a band (no listing, unauthenticated,
 * or the issue carries no `forecast/S|M|L` label), and the right half is
 * `NotStarted` when the transcripts name no branch for the issue. They are the
 * same em dash and different words on hover, which is enough because the
 * *pattern* differs: a `gh` that failed leaves the landed band and every figure
 * standing, an issue nobody has started leaves only its title and its band.
 * Neither may ever be substituted by a zero or by a default band — `bucketFor(0)`
 * is `S`, so an unstarted row shown as zeroes would claim to have come in under
 * an `L` forecast, and would drag the accuracy figure and the quartiles with it.
 *
 * The verdict is simply absent whenever either half is, because `verdict` on
 * the wire is null unless both are known. There is nothing to add for the
 * absence: the half that is dashed already says which question went unanswered,
 * and a third marker after it would be the same sentence twice.
 *
 * The arrow is `aria-hidden`, so the cell reads out as its two bands and the
 * verdict with nothing between them. The column header carries the direction in
 * words — forecast first, landed second — which is what a reader who cannot see
 * the arrow has to go on, and is why that hint names both halves in order
 * rather than calling the column a comparison and stopping.
 */
const Comparison = ({ row }: { row: IssueUsage }) => (
  <span className="flex items-center gap-2">
    {row.forecast ? <Band band={row.forecast} /> : <Unknown />}
    <ArrowRight
      aria-hidden="true"
      className="size-3 shrink-0 text-muted-foreground"
    />
    {row.bucket ? <Band band={row.bucket} /> : <NotStarted />}
    {row.verdict && (
      <Badge variant={VERDICT_VARIANT[row.verdict]}>{row.verdict}</Badge>
    )}
  </span>
);

/**
 * One column, and what it renders from a row.
 *
 * The renderer is what lets this one list drive the header *and* the body. As
 * two parallel literals — a column array for the `<thead>` and hand-written
 * cells beneath it — adding or reordering a column is two edits that can
 * silently disagree about order or alignment, which is the shape of bug a table
 * ships quietly. It started as a list of numeric accessors and generalised the
 * moment words arrived beside the figures; `numeric` is what still separates
 * the two, and it decides alignment for the header and the cell together.
 *
 * The issue number is deliberately not in here: it is the row's identity rather
 * than one of its columns, and it is marked up as a header cell on both axes.
 */
interface Column {
  label: string;
  /** What the column means, on hover. */
  title: string;
  render: (row: IssueUsage) => ReactNode;
  /** Right-aligned and tabular — a figure rather than a word. */
  numeric?: boolean;
  /** The column this page exists for. */
  lead?: boolean;
  /** Muted — the figure that is not comparable to a forecast band. */
  muted?: boolean;
}

/**
 * Which columns offer a sort, and which key each one ranks by — said once, in
 * the type (#272).
 *
 * A column whose name is also a sort key **must** carry `sort`, and it must be
 * its own name; every other column may not carry one at all. Written as an
 * optional field instead, the two lists would be independent: dropping `sort`
 * from `turns` would leave `usage-sort.ts`'s tests green while no header
 * offered it, and a copy-pasted `sort: "turns"` on `cacheRead` would compile
 * and rank the wrong column — neither of which any assertion here would see,
 * because only some of the six have a header-level test.
 *
 * The exclusions are the same fact from the other side: `title` and
 * `comparison` are not keys of `SORTABLE` in `./usage-sort`, so they cannot be
 * given one by accident either.
 */
type ColumnDefinitions = {
  [Name in UsageColumn]: Name extends UsageSortKey
    ? Column & { sort: Name }
    : Column & { sort?: never };
};

/**
 * What each column renders, keyed by name.
 *
 * The *order* is `USAGE_COLUMNS` in `./protocol` and not this literal's key
 * order, because two tests index a row by position and neither can import this
 * file — so the order has to live somewhere import-free. Keying by the same
 * names is what keeps the two in step: a column defined here and left out of
 * that list does not compile, and neither does the reverse.
 */
const COLUMNS: ColumnDefinitions = {
  title: {
    label: "Title",
    title: "The issue on GitHub — the link opens it in a new tab",
    render: (row) =>
      row.title === null ? (
        <Unknown />
      ) : row.url === null ? (
        <span className="block max-w-[26rem] truncate">{row.title}</span>
      ) : (
        // The hint carries the untruncated title, which is the one thing the
        // cell cannot show: `max-w` plus `truncate` is what stops a long title
        // widening the table past every figure beside it.
        <Hint content={row.title}>
          <a
            href={row.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex max-w-[26rem] items-center gap-1 underline decoration-dotted underline-offset-4 hover:decoration-solid"
          >
            <span className="truncate">{row.title}</span>
            <ExternalLink aria-hidden="true" className="size-3 shrink-0" />
          </a>
        </Hint>
      ),
  },
  out: {
    label: "Output tokens",
    title:
      "Actual output tokens — the unit the forecast bands are denominated in",
    render: figure((spend) => spend.out),
    sort: "out",
    numeric: true,
    lead: true,
  },
  comparison: {
    label: "Forecast vs actual",
    title:
      "The band its forecast/S|M|L label named, the band its actual spend landed in, and the two read against each other — nothing to score until an issue has both",
    render: (row) => <Comparison row={row} />,
  },
  turns: {
    label: "Turns",
    title: "Assistant turns recorded against this issue's branches",
    render: figure((spend) => spend.turns),
    sort: "turns",
    numeric: true,
  },
  sessions: {
    label: "Sessions",
    title: "Distinct sittings the work was split across",
    render: figure((spend) => spend.sessions),
    sort: "sessions",
    numeric: true,
  },
  cacheRead: {
    label: "Cache read",
    title:
      "Cache-read tokens — a measure of session hygiene, never part of the forecast",
    render: figure((spend) => spend.cacheRead),
    sort: "cacheRead",
    numeric: true,
    muted: true,
  },
};

/**
 * The columns the table walks, for a given answer to "show the detail three?".
 *
 * `USAGE_SPINE`'s order or `USAGE_COLUMNS`'s, `COLUMNS`'s definitions — one
 * list driving the header and the body both, in either state. The detail
 * columns **append**, which is the property the two positional suites rest on:
 * a spine cell sits at the same index whether the toggle is on or off, so one
 * index map read off `USAGE_COLUMNS` serves both. See `USAGE_DETAIL` in
 * `./protocol` for why that is two lists rather than one list with a flag.
 */
const columnsShown = (detail: boolean) =>
  (detail ? USAGE_COLUMNS : USAGE_SPINE).map(
    (name) => [name, COLUMNS[name]] as const,
  );

/**
 * How the developer is reading the table, as opposed to what the table is
 * reading.
 *
 * One object rather than two pieces of state, because the two are not
 * independent: a sort on `turns` means nothing without the column that
 * announces it, and the rules below hold them together. It lives on
 * `UsagePage` for a measured reason — see `SpendTable`'s own comment.
 */
export interface UsageTableView {
  sort: UsageSort;
  /** Whether `USAGE_DETAIL`'s three columns are appended (#271). */
  detail: boolean;
  /**
   * What the search box holds, live rather than debounced (#273).
   *
   * The raw term and not the settled one, because this is the input's value:
   * lifted in its settled form, every keystroke would either wait 150 ms to
   * appear in the box it was typed into or need a second copy of itself kept
   * below. The debounce happens where the term is *spent* — see `SpendTable`.
   */
  query: string;
  /**
   * Which forecast band, which verdict and whether work has been recorded
   * (#274).
   *
   * Up here with the query and for the same reasons: it is how the developer is
   * reading the rows rather than part of the reading, and the mutation clears
   * its `data` while it re-reads, so anything kept below would be thrown away
   * by the press of Scan that re-asks the same question. Undebounced, unlike
   * the query — a select settles the moment it is picked, and there is no
   * per-keystroke cost to wait out.
   */
  facets: UsageFacets;
}

export const DEFAULT_USAGE_TABLE_VIEW: UsageTableView = {
  sort: DEFAULT_USAGE_SORT,
  detail: false,
  query: "",
  facets: DEFAULT_USAGE_FACETS,
};

/**
 * The sort keys that only exist while the detail columns are shown.
 *
 * Derived from the two contracts rather than listed again: `USAGE_DETAIL` says
 * which columns those are and `COLUMNS` says what each ranks by, so a column
 * moved between the spine and the detail needs no edit here.
 */
const DETAIL_SORT_KEYS = new Set<UsageSortKey>(
  USAGE_DETAIL.map((name) => COLUMNS[name].sort),
);

/** The sticky header cell, shared by both kinds of heading below — the ones
 *  that rank the table and the two that do not. */
const HEADER_CELL = "sticky top-0 z-10 bg-muted px-3 py-2 font-medium";

/**
 * One column heading — and, where the column can be ranked, the control that
 * ranks it (#272).
 *
 * `ModuleTable` next door is the shape this copies, down to where each part
 * goes: `aria-sort` on the `<th>` rather than on the button, because the sort is
 * a property of the column and the button is what changes it; the arrow
 * `aria-hidden`, because the same fact is already on the cell in words; and the
 * hint on the button rather than around the label, so the thing a pointer lands
 * on is the thing that explains itself.
 *
 * **A column nothing ranks by carries no `aria-sort` at all**, rather than
 * `"none"`. The two are different claims: `"none"` says this column is sortable
 * and is not currently sorted, which on `Title` would advertise a control that
 * is not there.
 */
function HeaderCell({
  label,
  title,
  numeric,
  sortKey,
  sort,
  onSortChange,
}: {
  label: string;
  title: string;
  numeric?: boolean;
  sortKey?: UsageSortKey;
  sort: UsageSort;
  onSortChange: (next: UsageSort) => void;
}) {
  const sortable = sortKey !== undefined;
  const active = sortable && sort.key === sortKey;
  return (
    <th
      scope="col"
      aria-sort={
        !sortable
          ? undefined
          : active
            ? sort.descending
              ? "descending"
              : "ascending"
            : "none"
      }
      className={cn(HEADER_CELL, numeric ? "text-right" : "text-left")}
    >
      <Hint content={title}>
        {!sortable ? (
          <span>{label}</span>
        ) : (
          <button
            type="button"
            onClick={() => onSortChange(nextSort(sort, sortKey))}
            className={cn(
              "flex cursor-pointer items-center gap-1 select-none hover:text-foreground",
              numeric && "ml-auto",
            )}
          >
            {label}
            {active &&
              (sort.descending ? (
                <ArrowDown aria-hidden="true" className="size-3" />
              ) : (
                <ArrowUp aria-hidden="true" className="size-3" />
              ))}
          </button>
        )}
      </Hint>
    </th>
  );
}

/**
 * Every issue worth looking at, biggest spend first — and, after them, the open
 * issues nobody has started, which carry a forecast and no figures at all.
 *
 * A plain `<table>` rather than a component, matching `ModuleTable` and
 * `TicketsTable` — this repo has no shadcn table, and a table is markup, not a
 * control. The frame around it is `TableFrame`, which is what makes the
 * scroller focusable and gives it a name (#111); the height cap is what gives it
 * something to scroll and the sticky header something to stick to.
 *
 * The ranking opens as the server's: rows arrive in output-token order with the
 * issue number as a tie-break, so two scans of an unchanged directory agree —
 * and so does `bun run tokens`, which since slice 2 prints these same rows
 * rather than ordering the scan itself. The unstarted issues are a block at the
 * end rather than rows sorted at zero, because an empty actual is not a small
 * one and filing them among the cheapest issues is where they would read as
 * work that cost almost nothing.
 *
 * **Every figure and the issue number re-rank the table from their header**
 * (#272), and that block at the end survives all of it. The comparator and the
 * reason it sinks a row rather than reading it as zero are `./usage-sort`'s;
 * what is here is the wiring — which columns offer it (`Column.sort`), what a
 * click does (`HeaderCell`), and the default that matches the order the rows
 * arrived in, so the first render after a scan does not reshuffle in front of
 * the developer.
 *
 * **The chosen sort is the page's state, not this component's**, which is the
 * one thing about it that is not `ModuleTable`'s shape. The reason is measured
 * rather than stylistic: `useUsageScan` is a mutation, and a mutation clears its
 * `data` the moment it is fired, so `UsagePage`'s `report &&` gate closes for
 * the length of the read and this component unmounts. State kept here would be
 * thrown away by the Scan that re-asks the same question — see
 * `UsagePage.tsx`. **Everything else on the bar travels with it, in one
 * `UsageTableView`**: the detail toggle (#271 moved up with the sort, and had
 * to — a sort on `turns` surviving without the column announcing it is a
 * ranking with no arrow and nothing on screen saying why), the query (#273) and
 * the three facets (#274). The rows change on a re-scan; how the developer is
 * reading them does not.
 *
 * **Four columns by default, and one control for the other three** (#271). The
 * spine is the issue, its title, the spend and the comparison; `turns`,
 * `sessions` and `cacheRead` come back on one press and are allowed to
 * reintroduce a horizontal scroll, because by then it is something the
 * developer asked for and `TableFrame` makes the scroller reachable (#111).
 *
 * **What this buys is less to read, and measurably not less to scroll.**
 * Measured 2026-09-19 against a real scan — 103 issues, 152 transcripts, at a
 * 1280px window — the frame reports `scrollWidth` 1218 against `clientWidth`
 * 1218 in *both* states: seven columns already fit. The horizontal scroll the
 * PRD is about was nine columns wide, and #270 is what removed it, by merging
 * the forecast, the landed band and the verdict into one cell. Do not read this
 * toggle as the fix for the width, and do not take the E2E's scroll-width
 * assertion (`dev-usage.spec.ts`) as saying otherwise — its own doc comment says
 * what it holds. A fifth column in the spine is where that assertion starts
 * earning its keep.
 *
 * **Four controls narrow it, and they are one filter** (#273, #274). The search
 * box matches the issue number and the title; the three selects beside it pick
 * a forecast band, a verdict or started-versus-unstarted (`./UsageFilters`,
 * with the predicates in `./usage-facets`). They are `&&`'d in one pass, so
 * "they compose" holds by construction and the shown-out-of-total line counts
 * what all four left. What none of them touches is the rest of the page: the
 * charts, the unattributed total and the gathered-at line read `report.issues`
 * up on `UsagePage` and never see these rows, which is #273's decision and the
 * one this slice had to keep rather than re-make.
 */
export function SpendTable({
  issues,
  view,
  onViewChange,
}: {
  issues: IssueUsage[];
  view: UsageTableView;
  onViewChange: (next: UsageTableView) => void;
}) {
  const { sort, detail, facets } = view;
  const searchId = useId();
  /* Debounced here rather than on the page, because here is where the term is
     spent: the box's own value has to keep up with the keystrokes, and only the
     filtering below is worth doing once the typing stops. The hook seeds itself
     from the value it is given, so the remount a re-scan forces (see below)
     comes back already settled rather than waiting out another 150 ms. */
  const query = useDebouncedValue(view.query, SEARCH_DEBOUNCE_MS);
  const needle = query.trim().toLowerCase();

  /* Filtered, then ranked — the same rows either way round, and cheaper in this
     order. The issue number is matched as the row prints it (`#101`), so the
     hash a developer copies out of the table or a commit message is a term that
     matches rather than one that matches nothing; a bare `101` still does,
     since the hash is a prefix. Nothing else on the row is searched: the URL is
     the number again, and a band is what the facets beside the box are for.

     The two narrowings are one `&&` rather than two passes, which is what makes
     "they compose" true by construction instead of by convention — and it is
     why the count below can be `rows.length` against `issues.length` and
     describe every control on the bar at once (#274). Both halves treat an
     untouched control as matching everything, so neither needs an "is the
     developer narrowing" branch that a later one could forget to write. */
  const rows = useMemo(
    () =>
      sortIssues(
        issues.filter(
          (row) =>
            matchesQuery(needle, `#${row.issue}`, row.title) &&
            matchesFacets(row, facets),
        ),
        sort,
      ),
    [issues, needle, facets, sort],
  );

  const onSortChange = (next: UsageSort) =>
    onViewChange({ ...view, sort: next });

  /**
   * Hiding the detail columns gives the table back its default ranking, when
   * the sort was on one of them.
   *
   * The alternative is a table ranked by a column that is no longer on screen:
   * no arrow, no `aria-sort`, nothing anywhere saying why the rows are in the
   * order they are in. Returning to the order the rows arrived in is the one
   * outcome that can still be announced — `Output tokens` takes its arrow back
   * — and it is visible in the same gesture that caused it.
   */
  const onDetailChange = (next: boolean) =>
    onViewChange({
      ...view,
      detail: next,
      sort: !next && DETAIL_SORT_KEYS.has(sort.key) ? DEFAULT_USAGE_SORT : sort,
    });

  // No control on the empty state, and deliberately: it widens a table that has
  // no cells to widen, and the sentence beside it is the answer to why.
  if (issues.length === 0) {
    return (
      <TableFrame
        label={USAGE_TABLE_LABEL}
        className="grid place-items-center p-6"
      >
        <p className="max-w-prose text-center text-sm text-muted-foreground">
          No issue spend in these transcripts, and no open issue to list beside
          it. Only a branch named{" "}
          <code className="font-mono">{"<type>/<issue>-<slug>"}</code> can be
          attributed to an issue.
        </p>
      </TableFrame>
    );
  }

  const columns = columnsShown(detail);

  return (
    <div className="space-y-2">
      {/* The filter bar: the box and the three selects that narrow the table,
          what they have narrowed it to, and the control that widens it (#271,
          #273, #274).

          **Its reach is the table and nothing else**, which is this slice's
          whole decision. The two charts, the unattributed total and the
          gathered-at line all read `report.issues` up on `UsagePage` and never
          see `rows`, so the accuracy figure goes on describing the scan rather
          than the search box — a filter that moved it would turn a claim about
          this repository into a claim about what somebody had typed. The
          project map's bar next door reaches two ways at once (its selects stop
          at two tabs, its search reaches all four), which is why a new
          filtering surface here has to choose one deliberately.

          They all sit on one row because they are one bar. The toggle keeps
          `variant="outline"` and its `aria-label`; the box is the project map's
          shape down to the icon and the `pl-8`, and the selects are that page's
          workspace select down to the `w-44`, because two filter bars two
          clicks apart should not need learning twice.

          The narrowing controls wrap as a group of their own rather than
          sharing one `flex-wrap` with the count and the toggle: at a width
          where the selects have to drop to a second line, a `justify-between`
          over all six would leave the count stranded beside the search box with
          the thing it counts below it. */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-56 max-w-sm flex-1 flex-col gap-1.5">
            <Label htmlFor={searchId}>{USAGE_SEARCH_LABEL}</Label>
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id={searchId}
                type="search"
                value={view.query}
                placeholder="issue number or words from a title"
                onChange={(event) =>
                  onViewChange({ ...view, query: event.target.value })
                }
                className="pl-8"
              />
            </div>
          </div>

          <UsageFilters
            facets={facets}
            onChange={(next) => onViewChange({ ...view, facets: next })}
          />
        </div>

        <div className="flex items-center gap-3">
          {/* The count, and it has to move when the rows do: a line still
              reading 98 over three visible rows is the same lie the map's
              frozen module counter used to tell, and the number is what a
              developer reads to confirm the search took at all. `countLabel` is
              that helper — a bare total at rest, `shown of total` while
              anything is narrowing it. **Anything**, which is why it reads
              `rows.length` rather than counting the query's own work: the
              facets narrow the same list, so one number describes all four
              controls without any of them having to report itself (#274).

              Visible rather than folded into the scroller's `aria-label`, which
              is where the plan first put it. `TableFrame`'s name is a landmark
              name: re-writing it on every keystroke would make the region
              announce a new title as you type, and it would still leave a
              sighted developer counting rows. The frame keeps the stable
              `USAGE_TABLE_LABEL`, and this line carries the arithmetic. */}
          <p className="text-sm text-muted-foreground tabular-nums">
            {USAGE_TABLE_LABEL} ({countLabel(rows.length, issues.length)})
          </p>
          <Toggle
            variant="outline"
            size="sm"
            pressed={detail}
            onPressedChange={onDetailChange}
            aria-label={USAGE_DETAIL_LABEL}
          >
            <Columns3 aria-hidden="true" />
            Detail columns
          </Toggle>
        </div>
      </div>

      {/* A bar that matches nothing says so, and — the half that matters —
          says it *below* the bar rather than instead of it. Replacing the whole
          block the way the no-issues state above does would take the controls
          away with the rows, leaving whatever emptied the table with nothing
          left to clear it from. `issues.length` is non-zero by here, so this is
          reachable only through the search or a facet — and since #274 a facet
          reaches it on its own, which is why the sentence names the filters
          rather than the search. */}
      {rows.length === 0 ? (
        <TableFrame
          label={USAGE_TABLE_LABEL}
          className="grid place-items-center p-6"
        >
          <p className="text-sm text-muted-foreground">{USAGE_NO_MATCH}</p>
        </TableFrame>
      ) : (
        <TableFrame label={USAGE_TABLE_LABEL} className="max-h-[70dvh]">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground">
              <tr>
                {/* Sortable like the figures beside it, and for the same reason
                  the row's identity is a `<th>`: the issue number is a column
                  of numbers a reader ranks by, and it is the only sortable one
                  an unstarted row carries a value for. */}
                <HeaderCell
                  label="Issue"
                  title="GitHub issue number, taken from the branch name"
                  sortKey="issue"
                  sort={sort}
                  onSortChange={onSortChange}
                />
                {columns.map(([name, column]) => (
                  <HeaderCell
                    key={name}
                    label={column.label}
                    title={column.title}
                    numeric={column.numeric}
                    sortKey={column.sort}
                    sort={sort}
                    onSortChange={onSortChange}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.issue} className="border-t border-border">
                  {/* A row header, not a cell: the issue number is what every
                  figure on the row is about, so a screen reader announcing a
                  cell announces which issue it belongs to. */}
                  <th
                    scope="row"
                    className="px-3 py-1.5 text-left font-mono font-normal tabular-nums"
                  >
                    #{row.issue}
                  </th>
                  {columns.map(([name, column]) => (
                    <td
                      key={name}
                      className={cn(
                        "px-3 py-1.5",
                        column.numeric && "text-right tabular-nums",
                        column.lead && "font-medium",
                        column.muted && "text-muted-foreground",
                      )}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      )}
    </div>
  );
}
