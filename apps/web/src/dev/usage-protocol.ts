/**
 * The Usage page's wire: what `apps/web/dev/usage.ts` gathers and what
 * `/__dev/usage` and `bun run tokens` both read — the row, the report, the
 * warnings, and the band and verdict words a row is written in.
 *
 * One of four modules the Usage contract is, since #297. The arithmetic over
 * these rows is `./usage-readings`, the table's column order and the strings
 * both suites reach for are `./usage-copy`, and the facet vocabulary sits with
 * its predicates in `./usage-facets`. They split by reader: this and
 * `./usage-readings` are what the node half imports, the other two it never
 * does. `BUCKETS` and `VERDICT` are here rather than beside the arithmetic
 * because a row's own fields are typed in them — beside `bucketFor`, the wire
 * would import the module that imports it.
 *
 * It lives under `src/` so the browser half reaches it through the `@/` alias;
 * the node half imports it by relative path, and `apps/web/tsconfig.node.json`
 * lists `dev` so both ends are typechecked against the same declarations. It
 * has no imports of its own and must keep none — Vite's native config loader
 * resolves the way Node does. None of this ships: the plugin is registered
 * `apply: "serve"` and every importer sits behind `import.meta.env.DEV`.
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
 * `apps/web/dev/transcripts.ts` because both ends spend it: the middleware
 * puts a letter on every row and the page prints that letter's range beside
 * it. One record, imported by both, is what stops a band's printed range
 * drifting from the boundary that decides it — they are two halves of the
 * same fact.
 */
export const BUCKETS = {
  S: { max: 60_000, label: "<60k" },
  M: { max: 150_000, label: "60-150k" },
  L: { max: 250_000, label: "150-250k" },
  XL: { max: Infinity, label: ">250k" },
} as const;

export type Bucket = keyof typeof BUCKETS;

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
 * What one issue's branches actually cost, as this machine's transcripts
 * recorded it.
 *
 * The four figures travel together in one nullable object rather than as four
 * nullable fields, and that is the whole guard: since #251 a row can exist with
 * no recorded work at all, and every one of these is absent exactly when the
 * others are. Flat and nullable, a row could carry turns with no output tokens
 * — a state nothing produces and every reader would have to branch for anyway.
 *
 * These are the fields of `Spend` in `apps/web/dev/transcripts.ts`. They are
 * declared again rather than derived from it, and that is the direction the
 * dependency has to run: this file is the contract the browser half reads, and
 * `transcripts.ts` imports *it*. Fusing them would let a change made for the
 * wire quietly retype the CLI's domain figure.
 */
export interface IssueSpend {
  /**
   * Actual output tokens — the unit the `forecast/S|M|L` bands are denominated
   * in, and the column this page exists to show. See
   * `apps/web/dev/transcripts.ts` for why it is output rather than total.
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
 * The band edges a forecast is cut against: each closed band's exclusive
 * `max`, from `BUCKETS`. `XL` has none — it is open-ended.
 *
 * A record rather than a re-read of `BUCKETS` because a trend point carries the
 * edges that were in force on its day (R7): when the bands move, the old points
 * keep the old edges, and the chart shows the move.
 */
export type BandEdges = Record<Exclude<Bucket, "XL">, number>;

/**
 * One local calendar day's reading of the population, for the Usage page's
 * trend (#419, R6).
 *
 * **The one figure the usage history keeps that is an answer rather than a
 * response**, and only because a day that has passed cannot be asked again:
 * the forecast labels `gh` reported and the bands the code held that day are
 * gone by the next one. What it keeps is spend — the quartiles of output
 * tokens and the accuracy tally — and never a row's verdict: every verdict on
 * the page is still judged against today's bands. ADR-0023's #419 section is
 * where that line is drawn.
 *
 * Computed by `trendPointFor` in `./usage-readings` from the same rows, with
 * the same `recordedSpend`, `percentiles` and `forecastAccuracy`, as the
 * page's distribution and accuracy panels — so today's point and the panels
 * above it cannot disagree.
 */
export interface TrendPoint {
  /** The local calendar day, `YYYY-MM-DD`. One point per day: the last scan of
   *  a day replaces that day's point. */
  day: string;
  /** ISO 8601 stamp of the scan that wrote it. */
  at: string;
  /** Issues with recorded spend — the quartiles' sample. Zero means there were
   *  no quartiles to take, and the three below are then not a measurement. */
  measured: number;
  p25: number;
  median: number;
  p75: number;
  /** Issues carrying a verdict — the accuracy figure's denominator. Zero means
   *  nothing could be scored, which is not 0%. */
  scored: number;
  onTarget: number;
  /** The band edges in force when the point was written. */
  edges: BandEdges;
}

/**
 * Which source of the scan a warning came from.
 *
 * The scan reads two sources and they fail independently — the transcript
 * directory can be unreadable while `gh` answers perfectly, and the reverse.
 * (Since #420 there is a third, the history; see the end of this comment.)
 * Each is a warning beside whatever could be read, so a caller that wants to
 * treat one differently from the other has to be able to tell them apart.
 *
 * Before #289 it could not: `warnings` was a flat `string[]` and the only way
 * to branch was to match on the prose, which is a contract nobody declared and
 * every re-wording breaks. That is also what kept `bun run tokens` from calling
 * `gatherUsage` at all — it words its diagnostics differently, and a list of
 * finished sentences gives it nothing to re-word. #290 spent this: the terminal
 * calls `gatherUsage` now and branches here, printing its own sentence for
 * `transcripts` and passing `listing`'s message through.
 *
 * Not a value per way to fail: "could not read the directory" and "the directory
 * holds no transcripts" are one source failing in two ways, and nothing on
 * either surface treats them differently — both mean there are no figures and
 * the message says which. A third value for that would be a distinction with no
 * reader, and #290 is where that was tested rather than assumed: the terminal's
 * two sentences for those two failures became one, because the advice it has to
 * give ("run this from the repo root") is the same advice for both.
 *
 * **The third value is a third source, not a third way to fail** (#420). The
 * usage history (`dev/usage-store.ts`) is a different file that fails on its
 * own — a damaged history beside readable transcripts and a working `gh` — and
 * its advice is its own: move or delete the file. So it has a reader, and
 * `bun run tokens` words its own sentence for it as it does for `transcripts`.
 */
export const USAGE_WARNING_SOURCE = {
  /** The transcript directory — unreadable, or holding no `.jsonl` files. */
  transcripts: "transcripts",
  /** The `gh issue list` the title, link and forecast columns come from. */
  listing: "listing",
  /** The usage history file, which could not be opened or read (#420). The
   *  figures are then the transcripts on disk alone. */
  history: "history",
} as const;

export type UsageWarningSource =
  (typeof USAGE_WARNING_SOURCE)[keyof typeof USAGE_WARNING_SOURCE];

/**
 * Something the scan could not see, and which source it could not see it from.
 *
 * `message` is the whole of what either surface displays, already worded for a
 * reader — the page renders it unchanged and the em-dash cells beside it say
 * nothing more. `source` is for the caller, not the reader: it is what lets a
 * surface decide *whether* to show a warning, or word its own, without parsing
 * the sentence it was handed.
 */
export interface UsageWarning {
  source: UsageWarningSource;
  message: string;
}

/**
 * One reading: a scan, taken when the developer pressed Scan, or the stored
 * reading the page opens on.
 *
 * **Two halves since #432.** `POST /__devtools/usage` is the scan: it reads the
 * transcripts and `gh`, stores what it read and the day's trend point, and
 * answers with this. `GET` is the stored reading: the same report computed
 * from what the history already holds — its rows, its trend and the listing
 * the last scan or push used — reading no transcript, running no `gh` and
 * writing nothing (`readStoredUsage` in `apps/web/dev/usage.ts`), or null when
 * there is no history or it holds no rows. Until #432 there was no `GET`, and
 * the page opened empty on every visit; once a laptop's pushes fed Railway's
 * develop (#428), the figures were already stored, and a phone that discards
 * background tabs had to press Scan to see figures that had not changed. The
 * stored reading is computed per request from inputs — nothing derived is
 * persisted for it, so the rule below stands. Measured 2026-10-06 against this
 * machine's history on Bun, as the dev server runs: 14,352 rows, 114 issues,
 * 32-45ms an open over seven runs — the price of tallying every stored row on
 * every read, and cheap enough to pay on each visit.
 *
 * A scan is still a few seconds of reading the first time (2-5s over this
 * machine's 136 transcripts when first measured, plus ~2s of `gh`). Since #418
 * only the first scan into a history costs that: a later one reads only what
 * was appended since — measured 2026-10-04 over 168 transcripts, ~60ms against
 * ~2.2s before, `gh` aside.
 *
 * **What the dev server keeps is the responses it read, never a reading's
 * answer** — one daily trend point aside —
 * (#417, ADR-0023). This said "the middleware caches nothing" until the
 * transcripts it reads turned out to be deleted after 30 days, taking every
 * older issue's spend with them. So each scan stores every API response it
 * read in a local SQLite file, and the figures are tallied over everything
 * stored. Nothing *derived* is kept — not a row, not a total, not a report — so
 * every reading is still computed afresh at `gatheredAt`, by today's counting
 * and attribution rules — the stored reading included. The one exception is
 * `trend` (#419): a past day's quartiles and accuracy, which no later reading
 * can recompute — see `TrendPoint`. Since #432 each scan also keeps the issue
 * listing it read, which is an input like the rows rather than an answer.
 */
export interface UsageReport {
  /** ISO 8601, stamped when the read finished — for a stored reading, the
   *  history's stamp of when rows last arrived, by a scan or a push, which is
   *  the moment its figures describe. */
  gatheredAt: string;
  /** How long the read took, so the page can say whether it is cheap. Covers
   *  the whole reading — the `gh` call as well as the filesystem sweep — since
   *  what it answers is "how long did pressing Scan take". For a stored
   *  reading, how long opening the page's figures took. */
  scanMs: number;
  /**
   * The directory that was read, absolute. On screen because it is the only
   * thing that distinguishes "this machine has done no work" from "the override
   * is pointed somewhere else" — and it is what a failing E2E names.
   */
  transcriptDir: string;
  /** `.jsonl` files in it — since #418 including those a scan skipped because
   *  nothing had been appended to them since the last one. Null for a stored
   *  reading (#432), which reads no transcript and so counts none — and which
   *  is how the page tells the two kinds of reading apart. */
  transcripts: number | null;
  /**
   * The earliest timestamp the stored history covers (ISO 8601), or null when
   * there is none — nothing stored yet, or a reading taken without a history.
   *
   * On screen because history starts when the store was first written, not
   * when the work did (R8): an issue with no spend before this date reads as
   * "not recorded", not as zero.
   */
  historySince: string | null;
  /**
   * One point per local calendar day on which a scan was taken, oldest first,
   * today's written by this scan (#419). Empty for a reading taken without a
   * history, which has nowhere to keep one.
   */
  trend: TrendPoint[];
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
  /**
   * Anything that stopped the scan seeing everything. Shown, not swallowed.
   *
   * The sources fail independently, so these **stack** rather than mask one
   * another: an unreadable directory and an unavailable listing are two entries,
   * not one, and a damaged history is a third (#420). Each names its `source`,
   * so a surface branches on that rather than on the wording of `message` (#289).
   */
  warnings: UsageWarning[];
}
