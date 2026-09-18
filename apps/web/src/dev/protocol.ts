/**
 * The wire contract between the dev-only Vite middleware (`apps/web/dev/`) and
 * the pages under `/__dev` — the one file both halves import.
 *
 * It lives under `src/` rather than beside the plugin so the browser half can
 * reach it through the `@/` alias; the node half imports it with a relative
 * path (see `apps/web/dev/plugin.ts`), and `apps/web/tsconfig.node.json` lists
 * `dev` precisely so the two ends are typechecked against the same
 * declarations.
 *
 * Mostly types, and the exceptions are deliberate: a handful of records and the
 * two small functions that read them (`bucketFor`, `percentiles`). Vocabulary
 * both halves spend belongs in the file both halves import — a band's printed
 * range and the boundary that decides it are two halves of one fact, and so are
 * the median the terminal prints and the median the page marks. This file has
 * no imports of its own and must keep none: `apps/web/dev/usage.ts` reaches it
 * by relative path under Vite's native config loader, which resolves the way
 * Node does.
 *
 * None of this ships: the plugin is registered `apply: "serve"` and every
 * importer of these types sits behind `import.meta.env.DEV`.
 */

/** Paths the dev middleware answers on. Deliberately *not* under `/__dev`,
 *  which is the client-side route prefix — keeping them apart means the SPA
 *  fallback and the API can never shadow each other. */
export const DEVTOOLS_API = {
  graph: "/__devtools/graph",
  suites: "/__devtools/suites",
  /** One SSE stream carrying every suite's output and the queue's state. */
  events: "/__devtools/events",
  start: "/__devtools/start",
  cancel: "/__devtools/cancel",
  clear: "/__devtools/clear",
  /** `POST` gathers a fresh reading of the local transcripts; see below for why
   *  there is no `GET` beside it. */
  usage: "/__devtools/usage",
} as const;

/* ── The project map ─────────────────────────────────────────────────────── */

/**
 * Where a module sits in the architecture. Coarser than the directory tree on
 * purpose: this is the thing the map colours by, and a legend of thirty entries
 * is not a legend.
 */
export const LAYER = {
  entry: "entry",
  page: "page",
  component: "component",
  ui: "ui",
  lib: "lib",
  route: "route",
  server: "server",
  schema: "schema",
  contract: "contract",
  test: "test",
  e2e: "e2e",
  fixture: "fixture",
  seed: "seed",
  config: "config",
  devtools: "devtools",
} as const;

export type Layer = (typeof LAYER)[keyof typeof LAYER];

export const WORKSPACE = {
  web: "web",
  api: "api",
  core: "core",
  shared: "shared",
  e2e: "e2e",
  root: "root",
} as const;

export type Workspace = (typeof WORKSPACE)[keyof typeof WORKSPACE];

/**
 * How one module reaches another.
 *
 * `type` is worth separating from `static`: a type-only edge disappears at
 * runtime, so a cycle made of them is not a real cycle and a "heavy" dependency
 * reached only for its types costs nothing in the bundle. `dynamic` is the
 * `import()` that gives a route its own chunk.
 */
export const EDGE_KIND = {
  static: "static",
  dynamic: "dynamic",
  type: "type",
} as const;

export type EdgeKind = (typeof EDGE_KIND)[keyof typeof EDGE_KIND];

export interface ModuleNode {
  /** Repo-relative, forward slashes. Doubles as the graph key. */
  id: string;
  name: string;
  dir: string;
  workspace: Workspace;
  layer: Layer;
  /** Lines that are neither blank nor comment. */
  code: number;
  /** Lines inside a line or block comment. Tracked separately because in this
   *  codebase the comments are half the artefact. */
  comments: number;
  bytes: number;
  /** Exported symbol names, in source order. */
  exports: string[];
  /** Ids of internal modules this one imports. */
  imports: string[];
  /** Ids of internal modules that import this one. */
  importedBy: string[];
  /** Bare package specifiers, normalised to the package name. */
  externals: string[];
  /**
   * Specifiers that are real but not modules in this graph — a stylesheet, the
   * generated Prisma client. Surfaced rather than dropped so a blank
   * `imports` list never has to be taken on trust.
   */
  unresolved: string[];
  /** `Foo.test.tsx` for `Foo.tsx`, when one exists. */
  testFile: string | null;
  isTest: boolean;
  /**
   * Whether a unit test could reasonably cover it — this project's own modules,
   * excluding shadcn's vendored primitives, fixtures, seeds, config and the
   * entries. Sent per module rather than left to the page to re-derive, so the
   * ratio in `totals` and any list of untested files agree by construction.
   */
  testable: boolean;
}

export interface ModuleEdge {
  from: string;
  to: string;
  kind: EdgeKind;
}

export const GUARD = {
  admin: "requireAdmin",
  auth: "requireAuth",
  webhook: "webhook",
  none: "none",
} as const;

export type Guard = (typeof GUARD)[keyof typeof GUARD];

export interface Endpoint {
  method: string;
  /** Mount prefix + router path, already joined. */
  path: string;
  guard: Guard;
  /** Module that registers it. */
  file: string;
  /** Web modules that call it, matched by path shape. */
  callers: string[];
}

export interface RouteEntry {
  path: string;
  component: string;
  /** The page module, when the component resolves to one. Null for a route whose
   *  element comes from the router itself — a `<Navigate>` catch-all. */
  file: string | null;
  /** Reached through `lazy(() => import(...))`, so it gets its own chunk. */
  lazy: boolean;
  /** Wrapper routes it is nested inside, outermost first. */
  guards: string[];
  /** Where a redirect route sends you. */
  redirectTo: string | null;
}

export interface ExternalDep {
  name: string;
  /** Modules importing it. */
  users: string[];
  workspaces: Workspace[];
}

export interface PrismaField {
  name: string;
  type: string;
  optional: boolean;
  list: boolean;
  /** The model this field points at, for a relation field. */
  relationTo: string | null;
}

export interface PrismaModel {
  name: string;
  /** The `@@map`ped table name, when it differs. */
  table: string | null;
  fields: PrismaField[];
}

export interface WorkspaceSummary {
  workspace: Workspace;
  /** Directory the workspace lives in, repo-relative. */
  dir: string;
  modules: number;
  code: number;
  comments: number;
  /** Module count per layer, only the layers present. */
  layers: { layer: Layer; count: number }[];
}

export interface ProjectGraph {
  generatedAt: string;
  /** How long the scan took, so the page can say whether it is cheap. */
  scanMs: number;
  totals: {
    modules: number;
    code: number;
    comments: number;
    edges: number;
    externals: number;
    endpoints: number;
    routes: number;
    testFiles: number;
    /** Non-test modules with a `*.test.*` sibling, over the ones that could
     *  have one — the coverage claim the map is entitled to make. */
    testedModules: number;
    testableModules: number;
  };
  workspaces: WorkspaceSummary[];
  modules: ModuleNode[];
  edges: ModuleEdge[];
  endpoints: Endpoint[];
  routes: RouteEntry[];
  externals: ExternalDep[];
  models: PrismaModel[];
  /** Import cycles, each as the ring of ids that closes it. Runtime edges
   *  only — a ring made of `type` edges is not a cycle. */
  cycles: string[][];
  /** Modules nothing imports, minus the ones nothing is supposed to import
   *  (entries, tests, config, seeds). */
  orphans: string[];
  /** Anything the scan could not make sense of. Shown, not swallowed. */
  warnings: string[];
}

/* ── The test runner ────────────────────────────────────────────────────── */

export const SUITE_KIND = {
  unit: "unit",
  types: "types",
  e2e: "e2e",
} as const;

export type SuiteKind = (typeof SUITE_KIND)[keyof typeof SUITE_KIND];

export interface SuiteDescriptor {
  id: string;
  label: string;
  /** What it actually checks, in one line. */
  description: string;
  /** The command, verbatim, so the page can show what it is about to run. */
  command: string;
  kind: SuiteKind;
  /**
   * Needs Postgres and its own servers. The page warns before running one and
   * leaves it out of "run everything" unless asked.
   */
  heavy: boolean;
}

export const CASE_STATUS = {
  passed: "passed",
  failed: "failed",
  skipped: "skipped",
} as const;

export type CaseStatus = (typeof CASE_STATUS)[keyof typeof CASE_STATUS];

/** One test file (vitest) or one spec (playwright), as parsed out of the run. */
export interface CaseResult {
  name: string;
  status: CaseStatus;
  /** Assertions inside it, where the reporter says. */
  tests: number | null;
  durationMs: number | null;
}

export interface RunCounts {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
}

export interface RunSummary {
  /** Null for a suite whose reporter counts nothing — a typecheck. */
  files: RunCounts | null;
  tests: RunCounts | null;
  /** Compiler diagnostics, for the typecheck suite. */
  errors: number | null;
}

/**
 * What happened during one suite run.
 *
 * `line` carries the reporter's own output, ANSI already stripped — it is the
 * evidence, and the parsed counts are only a reading of it. Everything else is
 * derived and may be absent; the exit code in `end` is what decides pass/fail.
 */
export type RunEvent =
  | {
      type: "start";
      suite: string;
      command: string;
      cwd: string;
      /** Epoch ms. Carried so the page's elapsed clock is measured from when the
       *  run began rather than from when this tab started watching — the two
       *  differ every time a reload reconnects mid-run. */
      startedAt: number;
    }
  | { type: "line"; text: string; stream: "out" | "err" }
  | { type: "case"; case: CaseResult }
  | {
      type: "end";
      suite: string;
      ok: boolean;
      exitCode: number | null;
      /** Set when the run was cut short from the page. */
      cancelled: boolean;
      durationMs: number;
      summary: RunSummary;
    }
  | { type: "error"; message: string };

/**
 * A frame on the dev tools' one event stream.
 *
 * There is a single stream for the whole page rather than one per run, and the
 * runs live on the server rather than in the browser tab. That is not tidiness —
 * it is what makes a long suite survive a reload.
 *
 * The reason is concrete: starting the Playwright suite launches a second Vite
 * over the same project, which can make *this* dev server re-optimise its
 * dependencies and full-reload the page. With the child process owned by the
 * page's connection, that reload killed the run every time. Owned by the server,
 * the reloaded page reconnects, gets the backlog replayed, and carries on
 * watching. Navigating away no longer cancels anything either — only Cancel does.
 */
export type DevStreamMessage =
  /** `suite` rides in the envelope so the run events themselves stay small. */
  | { kind: "run"; suite: string; event: RunEvent }
  /** Sent on connect and whenever either changes, so a fresh page learns what is
   *  already in flight without a second request. */
  | { kind: "state"; active: string | null; queued: string[] };

/* ── Usage ──────────────────────────────────────────────────────────────── */

/**
 * Output-token bands — the vocabulary a `forecast/S|M|L` label and an actual
 * spend are both written in. `max` is exclusive.
 *
 * These are this repo's own measured per-ticket distribution over 90
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
 * these came back zero — three marks at the origin read as very cheap tickets
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
 * The Usage table's columns, left to right — the issue number excepted, which
 * is the row's identity rather than one of its columns.
 *
 * Here, in the import-free contract, for the reason `ROUTE` is in an
 * import-free `routes.ts`: two tests index a row by position, and a column
 * inserted in `UsagePage.tsx` would otherwise leave each of them asserting
 * against a neighbouring cell with nothing failing. `UsagePage.tsx` keys its
 * column definitions by these names and renders them in this order, so the
 * order the page prints and the order a test counts are one list; a name added
 * here without a definition, or a definition without a name, does not compile.
 * `tests/e2e/dev-usage.spec.ts` reaches in here the same way
 * `route-timing.spec.ts` reaches into `routes.ts`.
 *
 * Forecast sits immediately left of the actual and the bucket immediately
 * right, so the comparison the verdict states is legible without it: band aimed
 * at, tokens spent, band landed in, and only then the word.
 */
export const USAGE_COLUMNS = [
  "title",
  "forecast",
  "out",
  "bucket",
  "verdict",
  "turns",
  "sessions",
  "cacheRead",
] as const;

export type UsageColumn = (typeof USAGE_COLUMNS)[number];

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
 * listing names gets one, so a ticket nobody has started appears with its band,
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
  /** Anything that stopped the scan seeing everything. Shown, not swallowed. */
  warnings: string[];
}

/* ── Readings over the rows ───────────────────────────────────────────── */

/**
 * The verdicts in reading order: what was overestimated, what was right, what
 * was underestimated.
 *
 * Not `Object.values(VERDICT)`, whose order is the record's and means nothing.
 * This one is an axis — the two misses sit either side of the hit, so the shape
 * of the accuracy chart's columns is the shape of the error, and a reader sees
 * which way the bands are wrong before reading a single label.
 */
export const ACCURACY_ORDER = [
  VERDICT.under,
  VERDICT.onTarget,
  VERDICT.over,
] as const;

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
 * toward zero every time somebody files a ticket. The verdict is already null
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
 * A row with no spend is an absence, not a zero. `bucketFor(0)` is `S`, so
 * substituting one would file every unstarted ticket in the smallest band and
 * drag all three quartiles down with it as the backlog grows — and a
 * `forecast/L` read against that zero prints "under", which is the same bug
 * arriving at the accuracy figure by the other road.
 */
export const recordedSpend = (issues: IssueUsage[]): number[] =>
  issues.flatMap((row) => (row.spend ? [row.spend.out] : []));
