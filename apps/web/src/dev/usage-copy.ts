/**
 * The Usage table's positional contract and the strings its two suites reach
 * for: the column order, and the accessible names of the table, the search box,
 * the detail toggle and the no-match line.
 *
 * Split out of `./usage-protocol` in #297, because nothing in the node half
 * reads a word of it — its readers are the `Spend*.tsx` modules,
 * `UsagePage.test.tsx`, `SpendTable.test.tsx` and `tests/e2e/dev-usage.spec.ts`,
 * and the last three cannot import a `.tsx` module. That is the whole reason
 * these live in a `.ts` file rather than beside the markup that renders them.
 *
 * Import-free, and must stay so: `dev-usage.spec.ts` reaches in here the way
 * `route-timing.spec.ts` reaches into `routes.ts`. The facet selects' labels
 * are not here — they are derived from `BUCKETS` and `ACCURACY_ORDER`, so they
 * sit with the facet predicates in `./usage-facets`.
 */

/**
 * The columns a scan opens on, left to right — the issue number excepted, which
 * is the row's identity rather than one of its columns.
 *
 * Three of the seven since #271; the other three are `USAGE_DETAIL` below, and
 * `USAGE_COLUMNS` under that is where the positional contract both suites rest
 * on is written down.
 *
 * **`comparison` is one cell carrying three former columns** (#270): the band
 * that was forecast, the band the actual landed in, and the verdict reading one
 * against the other. They were `forecast`, `out`, `bucket`, `verdict` across
 * four columns, which is the comparison spelled out at the cost of a table
 * nobody could read without scrolling sideways. Merged, the spend the page
 * exists to report still sits on its own in `out`, and the sentence about it
 * reads in one place: `M 60-150k → S <60k` and then the word.
 *
 * What the merge must not cost is the distinction the page is built on. The two
 * halves fail for different reasons and are still told apart — an absent
 * forecast means `gh` could not say, an absent landed band means no work has
 * been recorded — and neither may ever be rendered as a zero or a default band.
 * See `Comparison` in `SpendCells.tsx`.
 */
export const USAGE_SPINE = ["title", "out", "comparison"] as const;

/**
 * The three diagnostic columns, hidden until the developer asks for them
 * (#271).
 *
 * They **append**, and that is the whole reason the contract is two lists
 * rather than one list carrying a `detail` flag: a spine column sits at the
 * same index whether the toggle is on or off, so the one index map built from
 * `USAGE_COLUMNS` below serves both states. Two maps — one per state — would
 * be two things to keep in step, and the two suites that index a row by
 * position would go on passing while asserting against a neighbouring cell.
 *
 * What is in here rather than in the spine is what a developer consults rather
 * than reads: turns and sessions describe how the work was arranged, and
 * cache-read is session hygiene that is deliberately not comparable to a
 * forecast band. None of the three is the figure the page exists to report —
 * that is `out`.
 *
 * **They are hidden because they are noise, and measurably not because they
 * overflow.** The horizontal scroll the PRD complains about was *nine* columns
 * wide, and #270's merged comparison cell is what removed it: against a real
 * scan on 2026-09-19 (103 issues, a 1280px window) the frame reads
 * `scrollWidth` 1218 against `clientWidth` 1218 with all seven columns shown.
 * Bringing them back is still *allowed* to reintroduce a scroll — it is opt-in,
 * and `TableFrame` makes the scroller focusable and named (#111) — but nothing
 * here should be read as claiming it currently does.
 */
export const USAGE_DETAIL = ["turns", "sessions", "cacheRead"] as const;

/**
 * Every column, in the order the table walks them once the detail columns are
 * shown — the spine and then the detail, as the concatenation and never as a
 * third literal. A restatement would be a third copy of the order, free to
 * disagree with the two it is built from.
 *
 * Here, in the import-free contract, for the reason `ROUTE` is in an
 * import-free `routes.ts`: two tests index a row by position, and a column
 * inserted in `SpendColumns.tsx` would otherwise leave each of them asserting
 * against a neighbouring cell with nothing failing. `SpendColumns.tsx` keys its
 * column definitions by these names and walks `USAGE_SPINE` or this list
 * depending on the toggle, so the order the page prints and the order a test
 * counts are one list; a name added to either half without a definition, or a
 * definition without a name, does not compile.
 * `tests/e2e/dev-usage.spec.ts` reaches in here the same way
 * `route-timing.spec.ts` reaches into `routes.ts`.
 */
export const USAGE_COLUMNS = [...USAGE_SPINE, ...USAGE_DETAIL] as const;

export type UsageColumn = (typeof USAGE_COLUMNS)[number];

/**
 * The accessible name of the one control that appends `USAGE_DETAIL`.
 *
 * In the contract beside the columns it is about, and for the same reason the
 * order is: three modules spend this string — `SpendTableBar.tsx` renders it as
 * the `Toggle`'s `aria-label`, `UsagePage.test.tsx` and `dev-usage.spec.ts`
 * each reach for the control by it — and neither suite can import a `.tsx`
 * module. Retyped, a reworded label leaves both suites querying a button that
 * no longer exists, which is the failure `route-timing.spec.ts` records for the
 * user-timing mark names: the E2E could not catch the rename either, because it
 * had restated the strings too.
 *
 * It is the *name* rather than the chip on the button, which is short enough to
 * sit above a table and says nothing about which three columns it means.
 */
export const USAGE_DETAIL_LABEL = "Show turns, sessions and cache read";

/**
 * The accessible name of the search box above the table, which is also the
 * visible label beside it (#273).
 *
 * Here for the reason `USAGE_DETAIL_LABEL` is: `SpendTableBar.tsx` renders it,
 * `SpendTable.test.tsx` reaches for the input by it and `dev-usage.spec.ts`
 * does the same, and neither suite can import a `.tsx` module. Retyped in
 * three places, a reworded label would leave both suites typing into a control
 * that no longer exists — the failure `route-timing.spec.ts` records for the
 * user-timing mark names.
 *
 * "An issue" rather than "a row": the thing being narrowed to is an issue, and
 * the two things that match one are the number it is filed under and the words
 * in its title.
 */
export const USAGE_SEARCH_LABEL = "Find an issue";

/**
 * The table's own name, and what the visible count sits beside (#273).
 *
 * One constant because it is said three times — as the scroller's accessible
 * name (`TableFrame`'s required `label`), in the line above it that carries
 * `countLabel`, and in the empty frame a search matching nothing leaves — and
 * because both suites address the region by it, neither being able to import a
 * `.tsx` module. What the suites do *not* take from here is the count's shape:
 * `(1 of 3)` is restated in each, because a test deriving it from `countLabel`
 * would agree with the code about a typo in it. The
 * **name** is deliberately not the thing that carries the count: a landmark
 * whose name changes on every keystroke is a worse place for a screen-reader
 * user to land than a stable one, and the count is stated in the visible line
 * that the search box and the toggle share. See `SpendTableBar.tsx`.
 */
export const USAGE_TABLE_LABEL = "Issue spend";

/**
 * What the table says when nothing on the bar above it matches a row (#273,
 * reworded in #274).
 *
 * A string both suites reach for and neither can import from a `.tsx` module,
 * which is the whole of the rule `USAGE_DETAIL_LABEL` above records. It began
 * as the project map's sentence with the noun changed — `MapWiring` says "No
 * endpoint matches the search." of its own lists — because the two bars are two
 * clicks apart and a developer should not have to learn which words each one
 * uses for the same answer.
 *
 * **"These filters" rather than "the search", since #274.** The bar has four
 * controls now and any of them can empty the table on its own; naming only the
 * box would send a developer who had narrowed to `forecast/L` to clear a search
 * term that was never there. The two bars diverge on this one word deliberately
 * — the map's search is the only control that can empty one of its lists.
 *
 * Distinct from the frame's other empty state, which is not here: "no issue
 * spend in these transcripts at all" is a fact about the scan, is worded as
 * one, and no test addresses it by a whole string.
 */
export const USAGE_NO_MATCH = "No issue matches these filters.";
