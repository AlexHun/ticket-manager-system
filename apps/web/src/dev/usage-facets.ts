import { ACCURACY_ORDER, hasRecordedSpend } from "./usage-readings";
import {
  BUCKETS,
  type Bucket,
  type IssueUsage,
  type Verdict,
} from "./usage-protocol";

/**
 * The Usage table's three facet selects: what each one offers, and what each
 * one asks of a row (#274).
 *
 * **The vocabulary and the predicates are one module since #297.** The labels,
 * the option rows and the shape of the state used to sit in `./usage-protocol`
 * while the predicates over them sat here, so a fourth facet was an edit in two
 * files that the type system then had to walk you between. Now the key set, the
 * specs, the state type and `FACET_MATCH` are in one place, and adding a facet
 * is one edit and three compile errors a screen apart. It stays a `.ts` module
 * for the reason `./usage-copy` is one: both suites reach for these strings and
 * neither can import a `.tsx` module.
 *
 * The predicates are pure and separate from the components for the reason
 * `usage-sort.ts` and `usage-charts.ts` are: what a facet says is a predicate
 * over *every* row, and a component test can only ask it about the three or
 * four rows it happened to render.
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
 * `hasRecordedSpend` in `./usage-readings`, the one statement of "has any work
 * been recorded against this issue" that the ranking, the comparator, the
 * distribution's sample and the table's em-dash cells all read too (#285).
 */

/**
 * The token every facet's "any" row carries (#274).
 *
 * Non-empty, and that is a requirement rather than a preference: the Radix
 * `Select` underneath reserves `""` for *cleared* and throws on a `SelectItem`
 * whose value is it. `ProjectMapPage` learned the same thing for its workspace
 * select and answered it the same way; this one is exported because three
 * selects share it and because `SpendTable.test.tsx` and `dev-usage.spec.ts`
 * both have to name the row it puts a facet at.
 *
 * It is a token rather than `null` on the wire of the state because it is what
 * a `SelectItem` is given — the mapping from "any" to "no constraint" happens
 * once, in `FACET_MATCH` below, rather than in each of the three selects.
 */
export const ANY_FACET = "any";

/**
 * The two answers to "has any work been recorded against this issue?" (#274).
 *
 * A vocabulary of its own rather than a boolean, because it is a facet value
 * like the bands and the verdicts beside it and travels through the same
 * `string`-valued control. The words are the values for the reason `VERDICT`'s
 * are: what the select shows and what the state holds cannot then disagree.
 *
 * What it asks is `hasRecordedSpend` and nothing else — the predicate in
 * `./usage-readings`, which `FACET_MATCH` below calls rather than restating. It
 * is deliberately not "spent more than zero": a row that really recorded zero
 * output tokens is a measurement, and the distinction this whole page is built
 * on is that an absence is not a small quantity. See `NotStarted` in
 * `SpendCells.tsx`.
 */
export const USAGE_STARTED = {
  started: "started",
  unstarted: "unstarted",
} as const;

export type UsageStarted = (typeof USAGE_STARTED)[keyof typeof USAGE_STARTED];

/**
 * What each facet narrows on — the type that makes the other three lists
 * exhaustive (#274).
 *
 * The key set is derived from this one interface, so a fourth facet is one
 * edit here and then three compile errors: a spec with no entry in
 * `USAGE_FACETS`, a field missing from `UsageFacets`, and a predicate missing
 * from `FACET_MATCH` below. Written as three independent lists it would be
 * three things to keep in step, which is the shape `SORTABLE` in
 * `./usage-sort` exists to refuse for the sort keys.
 *
 * Each value type is the vocabulary the row already carries, never a second
 * spelling of it: a forecast facet is a `Bucket` because `IssueUsage.forecast`
 * is one, and a verdict facet is a `Verdict` for the same reason. That is what
 * lets `FACET_MATCH` be three `===` comparisons with nothing to translate.
 */
interface UsageFacetValues {
  forecast: Bucket;
  verdict: Verdict;
  started: UsageStarted;
}

export type UsageFacetKey = keyof UsageFacetValues;

/**
 * The facets in the order they sit on the bar. A list rather than
 * `Object.keys(USAGE_FACETS)`, whose order is a record's and means nothing —
 * the same distinction `ACCURACY_ORDER` draws against `Object.values(VERDICT)`.
 *
 * Forecast first because it is the column the page is about, verdict second
 * because it reads the first against the spend, and "work recorded" last
 * because it is the only one that asks about the row's existence rather than
 * about its figures.
 */
export const USAGE_FACET_KEYS = [
  "forecast",
  "verdict",
  "started",
] as const satisfies readonly UsageFacetKey[];

/**
 * One facet's control: its accessible name, the row that clears it, and the
 * rows that constrain it.
 *
 * The options are `{ value, label }` pairs rather than bare values because two
 * of the three read differently from how they are stored: a band's row says
 * `M 60-150k`, since the letter alone is jargon and the range alone does not
 * match the label on the issue (the same pair `Band` renders in a row), while a
 * verdict's row is the verdict itself.
 */
interface UsageFacetSpec<Value extends string> {
  /** The select's accessible name, and the visible label beside it. */
  label: string;
  /** The "any" row's words — what `ANY_FACET` reads as. */
  any: string;
  options: readonly { value: Value; label: string }[];
}

/**
 * The three selects beside the search box, said once (#274).
 *
 * In a `.ts` module for the reason `USAGE_DETAIL_LABEL` and
 * `USAGE_SEARCH_LABEL` (`./usage-copy`) are: `UsageFilters.tsx` renders every
 * string here, and both suites reach for the controls and the rows by them
 * while neither can import a `.tsx` module. A retyped label would leave them
 * driving a select that no longer exists, which is the failure
 * `route-timing.spec.ts` records for the user-timing mark names.
 *
 * **Every band is offered, including `XL`, and every verdict, including ones
 * nothing currently lands in.** The options are the *vocabulary*, not an
 * inventory of the rows on screen — which is what makes "narrow to a band and
 * find the table empty" a reachable, honest answer rather than an option that
 * quietly vanishes. Derived from the rows instead, a facet could never produce
 * the empty state at all, and the developer would be left unable to ask a
 * question whose answer is "none". `XL` is in `BUCKETS` and `forecastOf` in
 * `apps/web/dev/issues.ts` accepts any band key, so a `forecast/XL` label would
 * be read; that no such label exists today is a fact about this repository's
 * practice and not about what the facet can express.
 *
 * **The band rows are in `BUCKETS`'s key order and the verdict rows are in
 * `ACCURACY_ORDER`, which is not the inconsistency it looks like.** A record's
 * key order usually means nothing, which is exactly why `ACCURACY_ORDER` exists
 * as well as `VERDICT` — but `BUCKETS` is ordered by construction and `bucketFor`
 * already depends on it, walking the keys and taking the first band whose `max`
 * the figure is under. Ascending size is a property of that record rather than
 * an accident of how it was typed, so a second list restating it here would be
 * the drift `bucketFor` is written to avoid.
 */
export const USAGE_FACETS: {
  [K in UsageFacetKey]: UsageFacetSpec<UsageFacetValues[K]>;
} = {
  forecast: {
    label: "Forecast band",
    any: "Any band",
    options: (Object.keys(BUCKETS) as Bucket[]).map((band) => ({
      value: band,
      label: `${band} ${BUCKETS[band].label}`,
    })),
  },
  verdict: {
    label: "Verdict",
    any: "Any verdict",
    options: ACCURACY_ORDER.map((verdict) => ({
      value: verdict,
      label: verdict,
    })),
  },
  started: {
    label: "Work recorded",
    any: "Started or not",
    options: [
      { value: USAGE_STARTED.started, label: "Started" },
      { value: USAGE_STARTED.unstarted, label: "Not started" },
    ],
  },
};

/**
 * How the table is narrowed besides the search box: one value per facet, and
 * `ANY_FACET` for the ones nobody has touched.
 *
 * Mapped off `UsageFacetValues` rather than written out, so the fields and the
 * controls cannot drift apart. Exported because `UsageTableView`
 * (`./usage-view`) carries it up to `UsagePage` — the state belongs to the page
 * for the measured reason #272 records.
 */
export type UsageFacets = {
  [K in UsageFacetKey]: UsageFacetValues[K] | typeof ANY_FACET;
};

/**
 * One predicate per facet, keyed by the facet — exhaustive by construction.
 *
 * A `Record` over `UsageFacetKey` rather than three `if`s inside
 * `matchesFacets`, for the reason `SORTABLE` in `./usage-sort` is a record
 * rather than a list: a fourth facet added to `UsageFacetValues` does not
 * compile until it has been decided about here, where a list of checks would
 * simply have gone on passing while the new control narrowed nothing.
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
