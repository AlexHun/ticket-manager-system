/**
 * The Usage page's contract: what `apps/web/dev/usage.ts` gathers, what
 * `/__dev/usage` and `bun run tokens` both say about it, and the vocabulary
 * they say it in.
 *
 * One of the three contracts `protocol.ts` split into (#284) — see
 * `./devtools-paths` for why it split and where the shared route table went.
 * Nothing here is read by a module that renders `/__dev/map` or
 * `/__dev/tests`, and nothing here reads theirs.
 *
 * Mostly types, and the exceptions are deliberate: a handful of records, the
 * four small functions that read them (`bucketFor`, `percentiles`,
 * `forecastAccuracy`, `recordedSpend`) and one predicate over a row
 * (`hasRecordedSpend`, the page's central rule rather than arithmetic).
 * Vocabulary both halves spend belongs in the file both halves import — a
 * band's printed range and the boundary that decides it are two halves of one
 * fact, and so are the median the terminal prints and the median the page
 * marks. Same for the rule: the node half ranks by it and the browser half
 * sorts, filters and dashes cells by it, so it lives where both can reach it.
 *
 * It also still holds the browser's UI copy and the shape of the table's view
 * state, which are read by the page and by both suites but by nothing in the
 * node half. That is a known leftover rather than the intended resting place:
 * #284 split the three contracts apart and left this one whole, and splitting
 * *it* further is a later ticket.
 *
 * It lives under `src/` rather than beside the plugin so the browser half can
 * reach it through the `@/` alias; the node half imports it with a relative
 * path (see `apps/web/dev/usage.ts`), and `apps/web/tsconfig.node.json` lists
 * `dev` precisely so the two ends are typechecked against the same
 * declarations. It has no imports of its own and must keep none: the node half
 * reaches it by relative path under Vite's native config loader, which resolves
 * the way Node does.
 *
 * None of this ships: the plugin is registered `apply: "serve"` and every
 * importer of these types sits behind `import.meta.env.DEV`.
 */

/**
 * Output-token bands — the vocabulary a `forecast/S|M|L` label and an actual
 * spend are both written in. `max` is exclusive.
 *
 * These are this repo's own measured per-issue distribution over 90
 * issue-numbered branches: p25 55k, median 90k, p75 154k. `XL` is the
 * open-ended top bucket and is a split signal rather than a size — nothing
 * should be forecast into it, and no `forecast/XL` label exists.
 *
 * It lives in the wire contract rather than beside the scan in
 * `apps/web/dev/usage.ts` because both ends spend it: the middleware puts a
 * letter on every row and the page prints that letter's range beside it. One
 * record, imported by both, is what stops a band's printed range drifting from
 * the boundary that decides it — they are two halves of the same fact.
 */
export const BUCKETS = {
  S: { max: 60_000, label: "<60k" },
  M: { max: 150_000, label: "60-150k" },
  L: { max: 250_000, label: "150-250k" },
  XL: { max: Infinity, label: ">250k" },
} as const;

export type Bucket = keyof typeof BUCKETS;

/**
 * The band an actual spend lands in. `max` is exclusive, so a figure sitting
 * exactly on a boundary belongs to the band above it.
 *
 * Beside `BUCKETS` rather than in the scan, for the same reason the record
 * itself is here: this is the arithmetic that turns those boundaries into a
 * letter, and since #252 both halves do it. The scan puts a letter on every
 * row; the page's distribution chart has to place a *percentile* in the same
 * bands, and a percentile is a figure no row carries. A second `find` over the
 * same record, written in the browser, is exactly the drift one record exists
 * to stop. `apps/web/dev/usage.ts` re-exports it, so the scan and
 * `bun run tokens` are unchanged.
 */
export const bucketFor = (out: number): Bucket =>
  (Object.keys(BUCKETS) as Bucket[]).find((b) => out < BUCKETS[b].max) ?? "XL";

/**
 * The quartiles of a set of output-token totals.
 *
 * Nearest-rank on the sorted values — the arithmetic `bun run tokens` has
 * always printed, and since #252 what the Usage page marks on its distribution
 * chart. One copy, for the reason `BUCKETS` is one copy: a terminal and a page
 * each computing their own median would disagree about this repository's own
 * size eventually, and nothing would fail when they did.
 *
 * An empty set reports zeroes rather than `undefined`, so a caller formatting
 * the result need not branch. But a caller deciding whether there is a
 * distribution *at all* must ask how many values it was given, not whether
 * these came back zero — three marks at the origin read as very cheap issues
 * rather than as no measurement. Both callers ask: the CLI prints "no
 * distribution to report", and the chart says the same in its own words.
 */
export function percentiles(values: number[]): {
  p25: number;
  p50: number;
  p75: number;
} {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.floor(sorted.length * q)] ?? 0;
  return { p25: at(0.25), p50: at(0.5), p75: at(0.75) };
}

/**
 * How an actual compares with the band it was forecast into.
 *
 * The values are the words themselves because `bun run tokens` prints them
 * verbatim and the page renders them verbatim — a display mapping on each side
 * is the shape that lets the terminal and the page describe the same issue
 * differently, which is the one thing this feature promises they cannot do.
 *
 * There is no fourth member for "nothing was forecast": that is the *absence*
 * of a verdict and is carried as `null` on the row. A default would score an
 * issue nobody estimated.
 */
export const VERDICT = {
  onTarget: "on target",
  over: "over",
  under: "under",
} as const;

export type Verdict = (typeof VERDICT)[keyof typeof VERDICT];

/**
 * The verdicts in reading order: what was overestimated, what was right, what
 * was underestimated.
 *
 * Not `Object.values(VERDICT)`, whose order is the record's and means nothing.
 * This one is an axis — the two misses sit either side of the hit, so the shape
 * of the accuracy chart's columns is the shape of the error, and a reader sees
 * which way the bands are wrong before reading a single label.
 *
 * It sits beside `VERDICT` rather than beside `forecastAccuracy` below because
 * it stopped being the chart's alone in #274: the verdict facet's rows read in
 * this order too, for the same reason the columns do — under, on target, over
 * is the axis the words sit on, and a select that listed them in some other
 * order would be a second opinion about what that order means.
 */
export const ACCURACY_ORDER = [
  VERDICT.under,
  VERDICT.onTarget,
  VERDICT.over,
] as const;

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
 * See `Comparison` in `SpendTable.tsx`.
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
 * inserted in `SpendTable.tsx` would otherwise leave each of them asserting
 * against a neighbouring cell with nothing failing. `SpendTable.tsx` keys its
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
 * order is: three modules spend this string — `SpendTable.tsx` renders it as
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
 * Here for the reason `USAGE_DETAIL_LABEL` is: `SpendTable.tsx` renders it,
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
 * that the search box and the toggle share. See `SpendTable.tsx`.
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

/**
 * The token every facet's "any" row carries (#274).
 *
 * Non-empty, and that is a requirement rather than a preference: the Radix
 * `Select` underneath reserves `""` for *cleared* and throws on a `SelectItem`
 * whose value is it. `ProjectMapPage` learned the same thing for its workspace
 * select and answered it the same way; this one is in the contract because
 * three selects share it and because `SpendTable.test.tsx` and `dev-usage.spec.ts`
 * both have to name the row it puts a facet at.
 *
 * It is a token rather than `null` on the wire of the state because it is what
 * a `SelectItem` is given — the mapping from "any" to "no constraint" happens
 * once, in `matchesFacets` (`./usage-facets`), rather than at each of the three
 * comparisons.
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
 * What it asks is `hasRecordedSpend` and nothing else — the predicate above,
 * which `FACET_MATCH` in `./usage-facets` calls rather than restating. It is
 * deliberately not "spent more than zero": a row that really recorded zero
 * output tokens is a measurement, and the distinction this whole page is built
 * on is that an absence is not a small quantity. See `NotStarted` in
 * `SpendTable.tsx`.
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
 * from `FACET_MATCH` (`./usage-facets`). Written as three independent lists it
 * would be three things to keep in step, which is the shape `SORTABLE` in
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
 * In the contract for the reason `USAGE_DETAIL_LABEL` and `USAGE_SEARCH_LABEL`
 * are: `UsageFilters.tsx` renders every string here, and both suites reach for
 * the controls and the rows by them while neither can import a `.tsx` module. A
 * retyped label would leave them driving a select that no longer exists, which
 * is the failure `route-timing.spec.ts` records for the user-timing mark names.
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
 * beside `VERDICT` — but `BUCKETS` is ordered by construction and `bucketFor`
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
 * controls cannot drift apart. It lives in the contract beside the specs
 * because `UsageTableView` (`./usage-view`) carries it up to `UsagePage` — the
 * state belongs to the page for the measured reason #272 records, and the shape
 * of it is something both halves of the split read.
 */
export type UsageFacets = {
  [K in UsageFacetKey]: UsageFacetValues[K] | typeof ANY_FACET;
};

/**
 * What one issue's branches actually cost, as this machine's transcripts
 * recorded it.
 *
 * The four figures travel together in one nullable object rather than as four
 * nullable fields, and that is the whole guard: since #251 a row can exist with
 * no recorded work at all, and every one of these is absent exactly when the
 * others are. Flat and nullable, a row could carry turns with no output tokens
 * — a state nothing produces and every reader would have to branch for anyway.
 *
 * These are the fields of `Spend` in `apps/web/dev/usage.ts`. They are declared
 * again rather than derived from it, and that is the direction the dependency
 * has to run: this file is the contract the browser half reads, and `usage.ts`
 * imports *it*. Fusing them would let a change made for the wire quietly retype
 * the CLI's domain figure.
 */
export interface IssueSpend {
  /**
   * Actual output tokens — the unit the `forecast/S|M|L` bands are denominated
   * in, and the column this page exists to show. See `apps/web/dev/usage.ts`
   * for why it is output rather than total.
   */
  out: number;
  turns: number;
  /** Distinct sittings. Work on one issue is often split across several. */
  sessions: number;
  /** Cache-read tokens, carried *beside* the forecast and never inside it. */
  cacheRead: number;
}

/**
 * What one issue cost, read off this machine's transcripts, beside what it was
 * forecast to cost.
 *
 * **Two sources, and which is which decides what a missing value means.** The
 * figures are actuals read off the filesystem; the title, the link and the
 * forecast band come from `gh`, which can be absent, unauthenticated, or simply
 * not know this issue. Both halves are `T | null` and in both halves `null`
 * means *unknown or nothing recorded*: never zero, never a default band, never
 * a verdict.
 *
 * **A row is no longer proof that work happened** (#251). Every open issue the
 * listing names gets one, so an issue nobody has started appears with its band,
 * an empty actual and no verdict — which is the question "what is this forecast
 * to cost?" answered before the work rather than only after it. `spend` null is
 * what says so, and it is why `bucket` is nullable beside it: there is no band
 * to land in until something has been spent, and calling that `S` would score
 * unstarted work as coming in under its forecast.
 */
export interface IssueUsage {
  /** The GitHub issue number — off the branch name for a row with spend, off
   *  the listing for one without. */
  issue: number;
  /**
   * What the transcripts recorded against this issue's branches, or null when
   * they hold nothing for it: an issue nobody has started, or one whose work
   * happened on another machine.
   */
  spend: IssueSpend | null;
  /** The issue's title, from `gh`. Null when it could not be asked. */
  title: string | null;
  /**
   * The issue on GitHub, as `gh` itself reports it rather than assembled here
   * from an owner and repo this code would have to carry a copy of. Null when
   * unknown — which is why the link and the title appear and vanish together.
   */
  url: string | null;
  /**
   * The band its `forecast/S|M|L` label names. Null both when `gh` is
   * unavailable and when the issue carries no such label: in either case
   * nothing was forecast that this row could be scored against, and the page
   * renders both as unknown.
   */
  forecast: Bucket | null;
  /**
   * The band the actual spend falls in. Derived from `spend.out` alone, so it
   * survives a `gh` that says nothing — and is null exactly when `spend` is,
   * since an issue nobody has started has landed in no band at all.
   */
  bucket: Bucket | null;
  /** `forecast` read against `bucket`. Null unless *both* are known — no
   *  forecast, or no spend to read against it, means no score. */
  verdict: Verdict | null;
}

/**
 * Whether the transcripts recorded any work at all against this issue — **the
 * page's central claim, and since #285 the one place the page states it** (R2).
 *
 * A row with no recorded spend is an *absence*, not a zero. `bucketFor(0)` is
 * `S`, so a row read as zero would be filed in the smallest band, scored
 * "under" against whatever it was forecast at, and counted in the quartiles —
 * which would put every unstarted issue in the backlog in the table claiming to
 * have beaten its estimate, and drag the accuracy figure and the distribution
 * down with it as the backlog grows.
 *
 * It asks `spend !== null` and deliberately **not** `out > 0`: a turn can
 * record no output tokens at all, so an issue really can have spent zero. That
 * is a measurement, and it ranks, bands and scores like any other figure.
 *
 * Four callers read it and none re-derives it — the table's comparator
 * (`sortIssues` in `./usage-sort`), the `started` facet (`FACET_MATCH` in
 * `./usage-facets`), the distribution's sample (`recordedSpend` below) and the
 * cell that renders the em dash (`figure` in `./SpendTable`). It was written
 * out separately in each of them until #285, with nothing holding them in step.
 *
 * It was five until #286. The node half had a ranking of its own (`rank` in
 * `apps/web/dev/usage.ts`) that branched on this to pick between a row's output
 * tokens and a sink value; `joinIssues` now sorts with `sortIssues` itself, so
 * that caller is the comparator above rather than a second one beside it.
 *
 * **One statement of the rule survives outside those five**, and it is named
 * here rather than left to be rediscovered: `figure` in
 * `scripts/issue-tokens.ts` is the terminal's own em-dash cell and takes a
 * nullable `IssueSpend` rather than a row, so it cannot call this. Consolidating
 * the terminal is slice 8 of `docs/plans/usage-page-module-seams.md`, where
 * `bun run tokens` starts calling `gatherUsage` instead of re-assembling the
 * scan. Until then this is the page's one home for the rule, not the repo's.
 *
 * **It is not a ranking's sink value, and the two must not be collapsed.**
 * This answers "is there spend"; a sink value is the *number* an absent row
 * sorts at — below every real figure, and `-1` rather than `0` because zero is
 * a real figure — which is a different question with a different answer type.
 * Ranking by this predicate instead would make every started row compare equal
 * and lose the output-token order the page opens on. Nothing in the repo holds
 * such a value any more: `dev/usage.ts`'s `UNSTARTED_RANK` was the only one and
 * #286 deleted it, because `sortIssues` asks this of *two rows* before it reads
 * any figure and so never needs a number for the absent case. A reintroduced
 * sink value would be a second ordering, not a helper.
 *
 * A type guard rather than a `boolean`, so a caller that asks the question and
 * then reads a figure off the *same* row — `sortIssues`, `recordedSpend`,
 * `figure` in `./SpendTable` — does it without a `?.` or a `!` standing beside the check as
 * a second, unverified copy of it.
 *
 * That covers a caller reading one row. It is **not** a rule that every `?.` on
 * `spend` is now a defect: `figureOf` in `./usage-sort` keeps one deliberately,
 * because it runs on two rows already known to be on the same side of the sink
 * and its null is a live answer rather than an unreached fallback. Its doc
 * comment is where that is argued.
 */
export const hasRecordedSpend = (
  row: IssueUsage,
): row is IssueUsage & { spend: IssueSpend } => row.spend !== null;

/**
 * What ran on `main`, or on no branch at all — the work that belongs to no
 * issue.
 *
 * It is a large share of everything this machine has done (28% of all turns when
 * the scan was written), and until #253 the join counted those turns and threw
 * their tokens away. That is why this is a shape rather than a number: a total
 * that quietly omits a quarter of the work reads as complete when it is not, so
 * the figure has to be reported in the same two units an issue's row is read in.
 *
 * **Turns and output tokens, and deliberately not the other two.** `sessions`
 * and `cacheRead` are on `IssueSpend` because an issue is a thing you can ask
 * "how many sittings did this take" about; `main` is not an issue and there is
 * nothing to ask it against. A field on the wire is a promise that something
 * reads it.
 *
 * **Zero here is a measurement, not an absence.** The rule it looks like it
 * breaks is `IssueSpend`'s: a row with no recorded work carries `null` and
 * renders an em dash, because `bucketFor(0)` is `S` and a zero there would be
 * banded, scored and counted in the quartiles. Nothing derives a band, a verdict
 * or a quartile from *these* two figures, so there is no score for a zero to
 * invent — it says the transcripts that were read hold no work on `main`, and
 * `transcripts` beside it says how many that was.
 */
export interface UnattributedWork {
  /** Turns that ran on `main` or with no branch recorded. */
  turns: number;
  /** Output tokens those turns spent — the same unit every issue row is read
   *  in, so the two figures are comparable without being added together. */
  out: number;
}

/**
 * One reading of the local transcripts, taken when the developer pressed Scan.
 *
 * There is no `GET` half and the middleware caches nothing: a held copy is the
 * one thing this page must not serve, since its whole claim is that the figures
 * on screen were gathered at `gatheredAt` from the directory named here. The
 * page holds the last result until the next press; the dev server holds none.
 * That is the opposite of the test runner next door, and deliberately so — a
 * run is a long-lived process worth surviving a reload, a scan is a few seconds
 * of reading that is cheaper to repeat than to invalidate (2-5s over this
 * machine's 136 transcripts, plus ~2s of `gh`).
 */
export interface UsageReport {
  /** ISO 8601, stamped when the read finished. */
  gatheredAt: string;
  /** How long the read took, so the page can say whether it is cheap. Covers
   *  the whole reading — the `gh` call as well as the filesystem sweep — since
   *  what it answers is "how long did pressing Scan take". */
  scanMs: number;
  /**
   * The directory that was read, absolute. On screen because it is the only
   * thing that distinguishes "this machine has done no work" from "the override
   * is pointed somewhere else" — and it is what a failing E2E names.
   */
  transcriptDir: string;
  /** `.jsonl` files read out of it. */
  transcripts: number;
  /**
   * One row per issue worth looking at — every issue with recorded spend, and
   * every issue the listing reports as open, whether or not anybody has started
   * it. Output tokens descending, with the issues that have spent nothing in a
   * block of their own at the end rather than interleaved at zero. Each carries
   * its forecast band, and its verdict when there is both a band and a spend to
   * read against it.
   */
  issues: IssueUsage[];
  /**
   * What ran on `main` or on no branch, as its own total (#253). Never folded
   * into `issues`: it belongs to no issue, and every figure on every row above
   * excludes it.
   */
  unattributed: UnattributedWork;
  /** Anything that stopped the scan seeing everything. Shown, not swallowed. */
  warnings: string[];
}

/* ── Readings over the rows ───────────────────────────────────────────── */

export interface AccuracyBin {
  verdict: Verdict;
  count: number;
}

export interface ForecastAccuracy {
  /** All three, always, in `ACCURACY_ORDER` — a zero is a result, and only the
   *  chart spends this. */
  bins: AccuracyBin[];
  /** Rows carrying a verdict: the denominator, and what "nothing to score"
   *  means when it is zero. */
  scored: number;
  onTarget: number;
}

/**
 * How often the band an issue was cut with matched what it actually cost.
 *
 * Here rather than beside either caller because there are two, and the figure is
 * the page's headline claim: `bun run tokens` prints `hits/scored on target` at
 * the foot of its table and the Usage page prints the same words in a card
 * corner. Those were two tallies of the same rows until #252 — the kind of pair
 * that agrees right up until somebody changes one, with nothing failing when
 * they stop.
 *
 * **Gated on the verdict, not on the forecast**, and that is the whole rule. A
 * row can carry a band and no spend to read it against — since #251 every open
 * issue gets one — and counting those as scored-and-missed would walk the figure
 * toward zero every time somebody files an issue. The verdict is already null
 * unless both halves are present (see `verdictFor`), so asking for it is asking
 * the question once.
 */
export function forecastAccuracy(issues: IssueUsage[]): ForecastAccuracy {
  const counts = new Map<Verdict, number>(ACCURACY_ORDER.map((v) => [v, 0]));
  for (const row of issues) {
    if (!row.verdict) continue;
    counts.set(row.verdict, (counts.get(row.verdict) ?? 0) + 1);
  }
  const bins = ACCURACY_ORDER.map((verdict) => ({
    verdict,
    count: counts.get(verdict) ?? 0,
  }));
  return {
    bins,
    scored: bins.reduce((sum, b) => sum + b.count, 0),
    onTarget: counts.get(VERDICT.onTarget) ?? 0,
  };
}

/**
 * The output-token totals of the rows that recorded any, in row order.
 *
 * The distribution's sample, and the one line that decides what is in it. Shared
 * for the same reason `forecastAccuracy` is: the CLI's percentiles and the
 * page's quartile marks must be quartiles *of the same set*, and both had
 * written this `flatMap` out for themselves.
 *
 * The exclusion is `hasRecordedSpend` above and is written down there: a row
 * with no recorded spend is an absence, not a zero. This is the one line that
 * decides what is in the sample, and since #285 it decides it by asking the
 * same predicate the ranking, the comparator, the facets and the cells ask
 * rather than by re-deriving the rule.
 */
export const recordedSpend = (issues: IssueUsage[]): number[] =>
  issues.flatMap((row) => (hasRecordedSpend(row) ? [row.spend.out] : []));
