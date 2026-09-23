import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ExternalLink } from "lucide-react";
import { Hint } from "@/components/Hint";
import { cn } from "@/lib/utils";
import { Comparison, Unknown, figure } from "./SpendCells";
import { USAGE_COLUMNS, USAGE_SPINE, type UsageColumn } from "./usage-copy";
import type { IssueUsage } from "./usage-protocol";
import { nextSort, type UsageSort, type UsageSortKey } from "./usage-sort";

/**
 * The Usage table's columns — what each one is called, what it renders and
 * which key it ranks by — and the heading that offers that ranking.
 *
 * Out of `SpendTable.tsx` since #297. A new column is an edit here and in
 * `./usage-copy` and nowhere else: the name goes in the positional contract,
 * the definition goes in `COLUMNS`, and the type below refuses either without
 * the other. The table itself only walks `columnsShown`.
 */

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
 * The *order* is `USAGE_COLUMNS` in `./usage-copy` and not this literal's
 * key order, because two tests index a row by position and neither can import
 * this file — so the order has to live somewhere import-free. Keying by the
 * same names is what keeps the two in step: a column defined here and left out
 * of that list does not compile, and neither does the reverse.
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
 * `./usage-copy` for why that is two lists rather than one list with a
 * flag.
 */
export const columnsShown = (detail: boolean) =>
  (detail ? USAGE_COLUMNS : USAGE_SPINE).map(
    (name) => [name, COLUMNS[name]] as const,
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
export function HeaderCell({
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
