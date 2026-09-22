// The `.ts` extension is load-bearing since #286: `joinIssues` in
// `apps/web/dev/usage.ts` imports this module to order the rows it puts on the
// wire, and the node half is loaded by Vite's native config loader, which
// resolves no extensionless relative specifier — not in the file it loads, and
// not in anything that file pulls in. `allowImportingTsExtensions` is on in
// both tsconfigs, so it costs the browser build nothing.
import {
  hasRecordedSpend,
  type IssueSpend,
  type IssueUsage,
} from "./usage-protocol.ts";

/**
 * How the Usage table's rows are ranked, and the one row it refuses to rank.
 *
 * Pure and separate from `SpendTable.tsx` for the reason `usage-charts.ts` sits
 * beside the charts: what the table *says* is an ordering over a set of rows,
 * and a component test can only ask about the three or four rows it happened to
 * render. The sink below is a property of the comparator, so it is tested as
 * one — `usage-sort.test.ts` asks it of every key in both directions.
 *
 * **An issue nobody has started sorts to the bottom unconditionally**, whatever
 * column is clicked and whichever way round it is. That is this module's whole
 * reason to exist. An empty actual is not a small one: `bucketFor(0)` is `S`,
 * so a row read as zero floats to the top of an ascending sort as the cheapest
 * work in the repository — the same lie the page refuses to tell in its cells
 * (see `NotStarted` in `SpendTable.tsx`), told in its ordering instead. There is
 * no substitution to get wrong here because there is no substitution at all: a
 * row with no `spend` is compared by whether it has one, before any figure is
 * read off it — and since #285 "whether it has one" is `hasRecordedSpend` in
 * `./usage-protocol`, the one statement of that rule, rather than a `!== null`
 * of this module's own.
 */

/**
 * The columns a reader can rank by: the issue number, and each of the four
 * figures on a row's spend.
 *
 * **A record keyed by that union rather than a list of names, so it is
 * exhaustive by construction.** A list could only be checked for *membership* —
 * `satisfies readonly ("issue" | keyof IssueSpend)[]` says every name in it is
 * real and nothing about the names left out, so a fifth figure added to
 * `IssueSpend` would quietly arrive with no way to rank by it. Keyed, the same
 * addition does not compile until it has been decided about. It also cannot
 * name `title` or `comparison` at all, which is where the two deliberate
 * exclusions below stop being a comment and start being a type.
 *
 * What is excluded is deliberate. `title` is a name nobody ranks a spend table
 * by, and it can be absent (`gh` said nothing), which would need a second sink
 * rule beside the one this module is about; `comparison` is three facts in one
 * cell rather than a figure, and the band it would rank by is already the
 * distribution chart's question.
 */
const SORTABLE: Record<"issue" | keyof IssueSpend, true> = {
  issue: true,
  out: true,
  turns: true,
  sessions: true,
  cacheRead: true,
};

export type UsageSortKey = keyof typeof SORTABLE;

/**
 * The same set, walkable — which is what `usage-sort.test.ts` asks the sink of,
 * key by key.
 *
 * A **set, not an order**: the order the table prints is `USAGE_COLUMNS` in
 * `./usage-protocol`, and nothing here should be read as a second copy of it.
 * The cast is `Object.keys` losing what the record already knows.
 */
export const USAGE_SORT_KEYS = Object.keys(SORTABLE) as readonly UsageSortKey[];

/** A column and a direction — the whole of what a header click decides. */
export interface UsageSort {
  key: UsageSortKey;
  descending: boolean;
}

/**
 * Output tokens descending — the order `joinIssues` hands the rows over in
 * (`apps/web/dev/usage.ts`), so the first render after a scan is the rows as
 * they arrived rather than a reshuffle in front of the developer.
 *
 * **It is that order rather than an order matching it** (#286). `joinIssues`
 * imports this constant and `sortIssues` below and sorts with them; there is no
 * second comparator on the node side to keep in step. Until then the server
 * ranked each row to a number of its own (`rank(b) - rank(a) || a.issue -
 * b.issue`, with a `-1` sink) and the two agreed by inspection — which is a
 * claim about the page's opening state that nothing held, since reversing
 * either one moved exactly one of the two surfaces.
 *
 * What makes the two expressible as one at all is step 3 of `sortIssues`: the
 * issue-number tie-break sits outside the direction flip, so the default here
 * is a *total* order and not merely a stable-sort artefact of whatever order
 * the rows were built in.
 */
export const DEFAULT_USAGE_SORT: UsageSort = { key: "out", descending: true };

/**
 * What clicking a header does: reverse the column that is already sorted, or
 * open a new one.
 *
 * A new column opens **descending** because every sortable column here is a
 * figure, and a figure is interesting from the top — the biggest spend, the most
 * sittings. `ModuleTable` next door opens its one *name* column ascending
 * instead; a column of words added here would need the same exception, and
 * would need to say so.
 */
export const nextSort = (current: UsageSort, key: UsageSortKey): UsageSort =>
  current.key === key
    ? { key, descending: !current.descending }
    : { key, descending: true };

/**
 * The figure a key reads off a row, or null when the row has recorded none.
 *
 * Null rather than zero, and the two are never mixed: a row that really spent
 * zero output tokens is a measurement and ranks as the cheapest work there is,
 * while a row with no spend at all has already been sunk *relative to a started
 * row* before this is called.
 *
 * **The `?.` here is not an unchecked second statement of the absence rule, and
 * this does not take the narrowed row `hasRecordedSpend` would give it** — both
 * of which it looks like at a glance, and a review read it that way. Two
 * unstarted rows reach this, because the sink above only separates a started
 * row from an unstarted one and says nothing about two of the latter. What they
 * get here is the whole of how the sunk block orders itself, and it differs by
 * column: under a figure key both sides answer null, the caller reads that as
 * equal and the issue-number tie-break orders them ascending whichever way the
 * table is pointed; under the issue key they answer real numbers and the block
 * reverses with the header, because the issue number is the one sortable value
 * an unstarted row carries. Narrowing the parameter would force the caller to
 * gate this on *both* rows being started, which collapses that second case —
 * the sunk block would stop reversing under the issue column, which
 * `usage-sort.test.ts` holds in "ranks the sunk block by the one column an
 * unstarted row carries".
 */
const figureOf = (row: IssueUsage, key: UsageSortKey): number | null =>
  key === "issue" ? row.issue : (row.spend?.[key] ?? null);

/**
 * The rows, ranked — with the issues nobody has started in a block at the end
 * whichever way the table is sorted.
 *
 * Three decisions, in the order the comparator applies them:
 *
 * 1. **The sink**, before any figure is read. A row's spend is present or it is
 *    not (`hasRecordedSpend`), and that outranks every column: it is what stops
 *    an absence being ranked as a quantity. Note what this step does *not*
 *    need — a sink value. Comparing two rows, the predicate is the whole
 *    answer; ranking each row to a number on its own needs some number to put
 *    the absent case at, which is what `joinIssues`' `-1` was before #286
 *    deleted it in favour of calling this.
 * 2. **The column**, flipped by `descending`.
 * 3. **The issue number, always ascending**, so the order is total and a
 *    re-render never reshuffles rows the sort cannot tell apart. Outside the
 *    flip on purpose, which is what lets the server sort with this comparator
 *    at all: a default that reversed the tie-break with the direction would be
 *    total only in one direction, and `joinIssues` would need its own rule for
 *    the other (#286). It is also what orders the sunk
 *    block under a *figure* column, since every row in it compares equal there.
 *    Under the issue column the block is ranked by step 2 like everything else:
 *    the issue number is the one sortable value an unstarted row carries, and a
 *    column that descended down the table and turned round at the dashes would
 *    be the header lying about what it did.
 *
 * A copy, because the rows belong to the report the page is holding and a scan
 * is a reading rather than a working set.
 */
export function sortIssues(
  issues: IssueUsage[],
  { key, descending }: UsageSort,
): IssueUsage[] {
  return [...issues].sort((a, b) => {
    const aStarted = hasRecordedSpend(a);
    if (aStarted !== hasRecordedSpend(b)) return aStarted ? -1 : 1;

    const left = figureOf(a, key);
    const right = figureOf(b, key);
    // Both null only when neither row has spend — two sunk rows, which the
    // issue number below orders.
    const order = left === null || right === null ? 0 : left - right;
    return (descending ? -order : order) || a.issue - b.issue;
  });
}
