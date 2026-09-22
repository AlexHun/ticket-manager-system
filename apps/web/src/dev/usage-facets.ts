import {
  ANY_FACET,
  USAGE_FACET_KEYS,
  USAGE_STARTED,
  hasRecordedSpend,
  type IssueUsage,
  type UsageFacetKey,
  type UsageFacets,
} from "./usage-protocol";

/**
 * What the Usage table's three facet selects ask of a row (#274).
 *
 * Pure and separate from the components for the reason `usage-sort.ts` and
 * `usage-charts.ts` are: what a facet says is a predicate over *every* row, and
 * a component test can only ask it about the three or four rows it happened to
 * render. The contract half — the labels, the option rows and the shape of the
 * state — lives in `./usage-protocol`, because both suites reach for those
 * strings and neither can import a `.tsx` module.
 *
 * **Two rules run through all three predicates.** A facet nobody has touched
 * carries `ANY_FACET` and matches everything, which is `matchesQuery`'s rule
 * arriving at the other control on the same bar: callers filter
 * unconditionally rather than branching on "is the developer narrowing". And a
 * row that carries *no* value for a facet — no forecast band, no verdict — is
 * in none of that facet's results rather than in a default one, which is the
 * distinction the page is built on told in a filter instead of in a cell.
 *
 * The `started` facet's own predicate is not written here: it is
 * `hasRecordedSpend` in `./usage-protocol`, the one statement of "has any work
 * been recorded against this issue" that the ranking, the comparator, the
 * distribution's sample and the table's em-dash cells all read too (#285).
 */

/**
 * One predicate per facet, keyed by the facet — exhaustive by construction.
 *
 * A `Record` over `UsageFacetKey` rather than three `if`s inside
 * `matchesFacets`, for the reason `SORTABLE` in `./usage-sort` is a record
 * rather than a list: a fourth facet added to the contract does not compile
 * until it has been decided about here, where a list of checks would simply
 * have gone on passing while the new control narrowed nothing.
 *
 * Each predicate takes the whole state and destructures its own field, so the
 * "is this facet set at all" test sits beside the comparison it guards rather
 * than being lifted into a loop that would have to widen the value's type to
 * do it.
 */
const FACET_MATCH: Record<
  UsageFacetKey,
  (row: IssueUsage, facets: UsageFacets) => boolean
> = {
  forecast: (row, { forecast }) =>
    forecast === ANY_FACET || row.forecast === forecast,
  verdict: (row, { verdict }) =>
    verdict === ANY_FACET || row.verdict === verdict,
  started: (row, { started }) =>
    started === ANY_FACET ||
    hasRecordedSpend(row) === (started === USAGE_STARTED.started),
};

/** Nothing narrowed: every select on its "any" row, which is what the table
 *  opens on and what pressing Scan again comes back to. */
export const DEFAULT_USAGE_FACETS: UsageFacets = {
  forecast: ANY_FACET,
  verdict: ANY_FACET,
  started: ANY_FACET,
};

/**
 * Whether a row survives every facet — **every**, not any.
 *
 * Composition is what makes the empty state reachable from the bar alone: two
 * answers that are each true of some row and of no row together (`forecast/L`
 * and `over`, say) narrow to nothing, and the table has to say so rather than
 * draw a header over no rows. It is also what lets the search box and the three
 * selects be one filter — `visibleRows` in `./usage-view` `&&`s this with
 * `matchesQuery` and the shown-out-of-total count reads the result of both.
 */
export const matchesFacets = (row: IssueUsage, facets: UsageFacets): boolean =>
  USAGE_FACET_KEYS.every((key) => FACET_MATCH[key](row, facets));
