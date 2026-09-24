import { matchesQuery } from "./module-match";
import {
  DEFAULT_USAGE_FACETS,
  matchesFacets,
  type UsageFacets,
} from "./usage-facets";
import {
  DEFAULT_USAGE_SORT,
  sortIssues,
  type UsageSort,
  type UsageSortKey,
} from "./usage-sort";
import { USAGE_DETAIL } from "./usage-copy";
import type { IssueUsage } from "./usage-protocol";

/**
 * How the developer is reading the Usage table — and what that leaves on
 * screen (#287).
 *
 * The narrowing used to live inside `SpendTable.tsx`: the `&&` of the search
 * box and the three facets, the `sortIssues` call over what they left, and the
 * rule that hiding the detail columns gives the ranking back its default. All
 * of it was real logic in a `.tsx` module, so the only way to ask "what does
 * this filter show" was to mount a page, stub axios, press Scan and read the
 * rows back out of the DOM — which is how `UsagePage.test.tsx` came to be 1,726
 * lines, two thirds of them about a comparator and three predicates.
 *
 * **The three modules below it each answer about one thing, and that is why
 * this one is not a fourth.** `usage-sort.ts` knows an ordering, `usage-facets.ts`
 * knows a predicate, `module-match.ts` knows a substring. None of them can say
 * whether the four controls narrow the *same* list, in the order that keeps the
 * ranking honest — and that composition is exactly where a filter goes wrong:
 * two passes instead of one `&&`, or a sort applied before the narrowing rather
 * than after it. `usage-view.test.ts` asks it directly, importing no component.
 *
 * **What this module deliberately does not own is the state itself.** `view`
 * lives on `UsagePage`, which is #272's measured decision and not a stylistic
 * one: `useUsageScan` is a `useMutation`, and a mutation clears its `data` the
 * moment it is fired, so `UsagePage`'s `report &&` gate closes for the length
 * of the read and `SpendTable` unmounts. Anything kept below that gate is
 * thrown away by the press of Scan that re-asks the same question. These are
 * pure functions *over* that state, which is what lets the page hold it and the
 * table merely render what it is handed.
 */

/**
 * How the developer is reading the table, as opposed to what the table is
 * reading.
 *
 * One object rather than four pieces of state, because they are not
 * independent: a sort on `turns` means nothing without the column that
 * announces it, and `withDetail` below is where that is held. Moved here from
 * `SpendTable.tsx` (#287), which had been exporting the shape of its *parent's*
 * state upward — the parent being where the state has to live.
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
   * below. The debounce happens where the term is *spent* — see `SpendTable`,
   * which hands `visibleRows` a view carrying the settled term.
   *
   * It is also raw in the other sense: untrimmed and uncased. Normalising it up
   * here would make the box show something other than what was typed, so
   * `visibleRows` does it instead, which is what satisfies `matchesQuery`'s
   * "arrives trimmed and lowercased" contract in one place rather than at every
   * call site.
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

/** The state the table opens on, and the one a re-scan comes back to: the
 *  order the server sent, nothing narrowing it, the detail columns away. */
export const DEFAULT_USAGE_TABLE_VIEW: UsageTableView = {
  sort: DEFAULT_USAGE_SORT,
  detail: false,
  query: "",
  facets: DEFAULT_USAGE_FACETS,
};

/**
 * The sort keys that only exist while the detail columns are shown.
 *
 * `USAGE_DETAIL` itself rather than a second list, and the `satisfies` is what
 * makes that legal to say: it asserts every detail column is something the
 * table can rank by, which is the claim `SpendTable`'s column record used to
 * carry alone (a detail column with no `sort` made `new Set<UsageSortKey>` fail
 * to compile there). Keeping the assertion means a fourth detail column still
 * cannot arrive without a way to rank by it — and moving a column between the
 * spine and the detail still needs no edit here.
 *
 * Typed as a `ReadonlySet<UsageSortKey>` rather than of the three literals, so
 * `has` can be asked about any sort a header produced.
 */
const DETAIL_SORT_KEYS: ReadonlySet<UsageSortKey> = new Set(
  USAGE_DETAIL satisfies readonly UsageSortKey[],
);

/**
 * The rows on screen: every issue the four controls agree on, ranked.
 *
 * **Filtered, then ranked** — the same rows either way round, and cheaper in
 * this order. The issue number is matched as the row prints it (`#101`), so the
 * hash a developer copies out of the table or out of a commit message is a term
 * that matches; a bare `101` still does, since the hash is a prefix. Nothing
 * else on the row is searched: the URL is the number again, and a band is what
 * the facets beside the box are for.
 *
 * **The two narrowings are one `&&` rather than two passes**, which is what
 * makes "they compose" true by construction instead of by convention — and it
 * is why the table's count can be `visibleRows(...).length` against
 * `issues.length` and describe every control on the bar at once (#274). Both
 * halves treat an untouched control as matching everything, so neither needs an
 * "is the developer narrowing" branch that a later one could forget to write.
 *
 * A copy comes back, because the rows belong to the report the page is holding
 * and a scan is a reading rather than a working set — `sortIssues` is what
 * makes that true.
 *
 * **Three fields of the view and not the whole of it, which is a claim rather
 * than a tidy signature.** The detail toggle changes which *columns* are drawn
 * and never which rows, so naming it here would be a promise this function does
 * not keep — and the caller feels it: `SpendTable`'s memo would have to list
 * `detail` as a dependency and re-filter every row on a press that changed
 * nothing. The one case where the toggle does move the rows is the sort reset,
 * and that arrives as a changed `sort`, which is named. A full `UsageTableView`
 * still satisfies this, so the page's state can be handed over whole.
 */
export function visibleRows(
  issues: IssueUsage[],
  { query, facets, sort }: Pick<UsageTableView, "sort" | "query" | "facets">,
): IssueUsage[] {
  const needle = query.trim().toLowerCase();
  return sortIssues(
    issues.filter(
      (row) =>
        matchesQuery(needle, `#${row.issue}`, row.title) &&
        matchesFacets(row, facets),
    ),
    sort,
  );
}

/**
 * The view after the detail toggle is pressed — and the ranking it has to give
 * back.
 *
 * Hiding the detail columns returns the sort to the default when it was on one
 * of them. The alternative is a table ranked by a column that is no longer on
 * screen: no arrow, no `aria-sort`, nothing anywhere saying why the rows are in
 * the order they are in. Returning to the order the rows arrived in is the one
 * outcome that can still be announced — `Output tokens` takes its arrow back —
 * and it happens in the same gesture that caused it.
 *
 * Only in that direction. Showing the columns brings a header back rather than
 * taking one away, so there is nothing to announce and nothing to reset. And
 * the toggle speaks for none of the other three controls: the query and the
 * facets travel through untouched, because clearing a developer's search in a
 * gesture about columns would be a worse surprise than the one this rule
 * exists to prevent.
 */
export const withDetail = (
  view: UsageTableView,
  detail: boolean,
): UsageTableView => ({
  ...view,
  detail,
  sort:
    !detail && DETAIL_SORT_KEYS.has(view.sort.key)
      ? DEFAULT_USAGE_SORT
      : view.sort,
});
