import { useMemo } from "react";
import { TableFrame } from "@/lib/table-frame";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { cn } from "@/lib/utils";
import { SEARCH_DEBOUNCE_MS } from "./module-match";
import { HeaderCell, columnsShown } from "./SpendColumns";
import { SpendTableBar } from "./SpendTableBar";
import { USAGE_NO_MATCH, USAGE_TABLE_LABEL } from "./usage-copy";
import type { IssueUsage } from "./usage-protocol";
import type { UsageSort } from "./usage-sort";
import { visibleRows, type UsageTableView } from "./usage-view";

/**
 * The Usage page's spend table.
 *
 * Lifted out of `UsagePage.tsx` whole (#270), which had grown to hold the page,
 * this table, the column record and four small components at once — and is the
 * file each of the four tickets after this one edits. Nothing about the page
 * changed in the move; what the page keeps is the parts that describe a
 * *reading* rather than a row (`Gathered`, `Unattributed`), and what came here
 * is everything that renders an issue.
 *
 * **Four modules since #297, split by what a change to each one touches.** What
 * goes in a cell — the absence markers, the bands, the comparison — is
 * `./SpendCells`; which columns exist, what they render and which key each
 * ranks by is `./SpendColumns`; the search box, the facet selects, the count
 * and the detail toggle are `./SpendTableBar`; and this file is what remains —
 * the debounce, the narrowing handed to `visibleRows`, the two empty states and
 * the markup that walks the columns.
 */

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
 * **It renders the rows it is handed, and computes no narrowing of its own**
 * (#287). Which issues survive the four controls, in what order, and what
 * hiding the detail columns does to a sort that was on one of them are all
 * `./usage-view` — `visibleRows` and `withDetail`, pure and unit-tested without
 * a renderer. What is left for the `.tsx` modules is wiring: which columns
 * offer a sort and what a header click produces (`./SpendColumns`), what the
 * bar writes back (`./SpendTableBar`), and here, where the term is debounced
 * and the markup.
 *
 * **Every figure and the issue number re-rank the table from their header**
 * (#272), and the unstarted block at the end survives all of it. The comparator
 * and the reason it sinks a row rather than reading it as zero are
 * `./usage-sort`'s.
 *
 * **The chosen sort is the page's state, not this component's**, which is the
 * one thing about it that is not `ModuleTable`'s shape. The reason is measured
 * rather than stylistic: `useUsageScan` is a mutation, and a mutation clears its
 * `data` the moment it is fired, so `UsagePage`'s `report &&` gate closes for
 * the length of the read and this component unmounts. State kept here would be
 * thrown away by the Scan that re-asks the same question — see
 * `UsagePage.tsx`. **Everything else on the bar travels with it, in one
 * `UsageTableView`** (`./usage-view`, which is where that shape now lives
 * rather than being exported upward from here): the detail toggle (#271 moved
 * up with the sort, and had to — a sort on `turns` surviving without the column
 * announcing it is a ranking with no arrow and nothing on screen saying why),
 * the query (#273) and the three facets (#274). The rows change on a re-scan;
 * how the developer is reading them does not.
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
 * a forecast band, a verdict or started-versus-unstarted (`./UsageFilters`
 * inside `./SpendTableBar`, with the predicates in `./usage-facets`). They are
 * `&&`'d in one pass in `visibleRows`, so "they compose" holds by construction
 * and the
 * shown-out-of-total line counts what all four left. What none of them touches
 * is the rest of the page: the
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
  /* Debounced here rather than on the page, because here is where the term is
     spent: the box's own value has to keep up with the keystrokes, and only the
     filtering below is worth doing once the typing stops. The hook seeds itself
     from the value it is given, so the remount a re-scan forces (see below)
     comes back already settled rather than waiting out another 150 ms. */
  const query = useDebouncedValue(view.query, SEARCH_DEBOUNCE_MS);

  /* Which rows are on screen is `visibleRows` in `./usage-view` (#287), not
     this component's arithmetic: what the four controls leave and how it is
     ranked is a claim about every row a scan could produce, and a component
     test can only ask it about the three or four it happened to render.

     What is handed over is the three fields that decide the rows, with the
     *settled* term in place of the live one — the only substitution the
     debounce needs, and the reason it can happen here while the state lives on
     the page. Rebuilt field by field rather than spread, so the dependency list
     below is the memo's real inputs: a spread `view` would re-filter and
     re-sort on every keystroke, which is precisely what the 150 ms is for.
     `detail` is in neither, because `visibleRows` does not take it — the
     toggle changes which columns are drawn, and the one case where it does move
     the rows is the sort reset, which arrives as a changed `sort`. */
  const rows = useMemo(
    () => visibleRows(issues, { sort, facets, query }),
    [issues, sort, facets, query],
  );

  const onSortChange = (next: UsageSort) =>
    onViewChange({ ...view, sort: next });

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
      <SpendTableBar
        view={view}
        onViewChange={onViewChange}
        shown={rows.length}
        total={issues.length}
      />

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
