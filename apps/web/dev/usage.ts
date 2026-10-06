// The join behind `bun run tokens` and the dev-tools Usage page: what each
// issue's branches spent, beside what GitHub says it was forecast to cost.
//
// The two sources are their own modules — `./transcripts.ts` reads the spend
// off this machine's Claude Code transcripts, `./issues.ts` reads the listing
// off `gh` — and this one joins them into the wire's rows (#297). Why the
// figure is output tokens, and what the scan cannot attribute, is argued at the
// top of `./transcripts.ts`, beside the code that decides it. Since #417 the
// spend is tallied over the usage history (`./usage-store.ts`) rather than over
// the files alone, so an issue keeps it after its transcript is deleted.
//
// This module is the single copy of the join, and since #290 both callers reach
// it through one door. `gatherUsage` returns the whole reading — the rows, the
// unattributed total, the timing and the warnings — and that is what the
// dev-tools Vite plugin serialises to the Usage page under `/__dev` (#248) and
// what `scripts/issue-tokens.ts` formats at the terminal. Neither re-assembles a
// scan of its own, so "the page and `bun run tokens` cannot disagree" is a
// property of one function rather than a promise two of them keep.
//
// The terminal used to import nine pieces of this file and do the assembling
// itself, which is why this module also carried a ten-symbol block re-exporting
// `usage-protocol.ts`'s vocabulary on its behalf. Both are gone: a caller that
// wants a band label, the quartiles or the accuracy tally imports the contract
// modules directly, the way every browser-side module already did.
//
// What it still leaves to its callers is presentation and process: no column
// widths, no colours, no `process.exit`. The one thing it reaches out of the
// filesystem for is the issue listing, and that is an optional parameter
// (see `gatherUsage`) rather than a call buried in the scan.

// The same file the Vite plugin and the pages under `/__dev` import, and the
// reason the report this builds cannot drift from what the page reads. The
// bands and the verdict words come from it too: they are vocabulary both ends
// spend, not an implementation detail of the scan.
import {
  BUCKETS,
  USAGE_WARNING_SOURCE,
  VERDICT,
  type Bucket,
  type IssueUsage,
  type TrendPoint,
  type UsageReport,
  type UsageWarning,
  type Verdict,
} from "../src/dev/usage-protocol.ts";
import { bucketFor, trendPointFor } from "../src/dev/usage-readings.ts";
// The order the rows go on the wire in, imported rather than restated (#286).
// `joinIssues` below is where that is argued, including why this is the
// browser's module and not a third one both halves read.
import { DEFAULT_USAGE_SORT, sortIssues } from "../src/dev/usage-sort.ts";
import {
  ISSUE_STATE,
  fetchIssueMetadata,
  type IssueMetadata,
} from "./issues.ts";
import {
  readTranscripts,
  tallySpend,
  type Spend,
  type TranscriptRead,
} from "./transcripts.ts";
import { openUsageStore, type UsageStore } from "./usage-store.ts";

/**
 * A forecast band read against what was actually spent.
 *
 * Null in, null out, and that is the rule rather than a convenience: an issue
 * carrying no `forecast/S|M|L` label was never estimated, so there is nothing
 * to be on target with. Defaulting it to *anything* — "on target", the median
 * band, `S` — would put a score on work nobody predicted and quietly move the
 * accuracy figure the whole page exists to report.
 *
 * `over` and `under` are decided against the forecast band's own boundary
 * rather than against `bucketFor(out)`, which is the same answer said once:
 * landing in a higher band *is* spending at or past that band's exclusive max.
 */
export function verdictFor(
  forecast: Bucket | null,
  out: number,
): Verdict | null {
  if (!forecast) return null;
  if (forecast === bucketFor(out)) return VERDICT.onTarget;
  return out >= BUCKETS[forecast].max ? VERDICT.over : VERDICT.under;
}

/**
 * A read that found nothing, for `gatherUsage` below to start from before it
 * knows whether the directory can be read at all.
 *
 * A function rather than a shared constant because `responses` is an array: a
 * single frozen-by-convention literal is one `push` away from being poisoned
 * for every later caller in the process.
 *
 * Not exported since #290. `bun run tokens` used to need one too, because it ran
 * its own scan and had to have something to print when the read failed; it calls
 * `gatherUsage` now, so there is one caller and the "found nothing" reading is
 * this module's own business rather than a shape two surfaces agree on.
 */
const emptyRead = (): TranscriptRead => ({
  responses: [],
  transcripts: 0,
  cursors: new Map(),
});

/**
 * The rows themselves: every issue worth looking at, joined to what GitHub
 * knows.
 *
 * **Module-private since #290, and that is the slice's point.** It was exported
 * for one caller: `bun run tokens` ran its own scan and joined the rows itself,
 * because the wire carried no total for the turns that ran on `main` and a
 * second sweep to recover one costs seconds, not milliseconds — 2-3s warm and
 * 28s cold over the 136 transcripts this was measured on. #253 put that total on
 * the wire and #289 tagged the warnings by source, which between them left the
 * terminal nothing it still had to assemble. So the scan, the join and the
 * warnings are all `gatherUsage`'s now, and R8 — the page and the terminal never
 * report different figures — stops depending on two callers running the same
 * steps in the same order.
 *
 * **Two sources of rows, not one** (#251, R4). The transcripts contribute every
 * issue they recorded work against; the listing contributes every issue it
 * reports as **open**, whether or not anything has been spent on it. So an
 * issue nobody has started appears with its band and an empty actual, which is
 * the forecast asked about *before* the work rather than only after it — and
 * the forecast-coverage gap the PRD's second metric is about becomes a row you
 * can see rather than an absence you have to know to look for.
 *
 * Open is the line, deliberately. A closed issue with no recorded spend was
 * finished somewhere this scan cannot reach — another machine, or before these
 * transcripts began — so a row for it would report the limits of the scan as a
 * fact about the work. A closed issue that *does* have spend keeps its row:
 * closed decides only whether an empty row is worth drawing.
 *
 * **The order is `DEFAULT_USAGE_SORT` and nothing else** (#286) — spend
 * descending, the unstarted issues in a block of their own at the end, and the
 * issue number breaking every tie upward. All three belong to `sortIssues` in
 * `../src/dev/usage-sort.ts`; this function no longer states any of them, it
 * passes the rows through the comparator the table's headers drive at the
 * setting they open on.
 *
 * That third property is why the rows do not move between two readings of an
 * unchanged directory: `Array.prototype.sort` is stable, but `Map` iteration
 * order is insertion order — the order the filesystem happened to hand the
 * files over — so a total order is the only thing that makes the two agree. It
 * is also what orders the trailing block, every row of which ranks the same.
 *
 * This used to rank each row to a number of its own — its output tokens, or a
 * `-1` sink for a row with no spend — and land on the same order the table
 * opens on by agreeing with it in prose. Two expressions of one claim, and the
 * guardrail spec measured what that cost: reversing either moved exactly one of
 * the two surfaces, so the property "the first render after a scan is the order
 * the server sent" was held by nothing but inspection. Now there is only one of
 * them to reverse, and doing so moves both.
 *
 * The direction of the dependency is deliberate: the browser half is the pure
 * one, and this module already reaches across for the bands, the verdict words
 * and the arithmetic. A third module holding an ordering both imported
 * would be a seam with one caller on each side and no reader of its own.
 */
function joinIssues(
  byIssue: Map<number, Spend>,
  metadata: IssueMetadata,
): IssueUsage[] {
  const numbers = new Set(byIssue.keys());
  for (const [issue, meta] of metadata.byIssue ?? []) {
    if (meta.state === ISSUE_STATE.open) numbers.add(issue);
  }

  const rows = [...numbers].map((issue) => {
    // `?? null` rather than a branch on `metadata.byIssue`: an issue the
    // listing does not mention is unknown in exactly the way every issue is
    // unknown when there is no listing, and both render the same.
    const meta = metadata.byIssue?.get(issue) ?? null;
    const forecast = meta?.forecast ?? null;
    const spend = byIssue.get(issue) ?? null;
    return {
      issue,
      spend,
      title: meta?.title ?? null,
      url: meta?.url ?? null,
      forecast,
      // Both null together, and not merely because there is no arithmetic to
      // do: `bucketFor(0)` is `S` and `verdictFor("L", 0)` is "under", so a
      // row defaulted to zero would score every unstarted issue as having
      // come in comfortably under budget.
      bucket: spend ? bucketFor(spend.out) : null,
      verdict: spend ? verdictFor(forecast, spend.out) : null,
    };
  });

  return sortIssues(rows, DEFAULT_USAGE_SORT);
}

/**
 * One reading of `dir`, joined to what GitHub knows, in the shape the wire
 * carries.
 *
 * The composition lives here rather than in the plugin so that R8 — the page
 * and `bun run tokens` never report different figures for the same issue — is a
 * property of one module rather than of two callers agreeing to be careful.
 * Since #290 it is the *only* entry point either of them has: the plugin
 * resolves the directory and serialises this, and the terminal resolves the
 * directory and formats this. Everything below the two of them — the scan, the
 * join, the ordering and the two ways a source can fail — happens once.
 *
 * **The listing is optional, and that it has a default is the point.** Written
 * as a bare `fetchIssueMetadata()` inside, a test would shell out to `gh` and
 * no caller could substitute a fixture; taken as a required argument, every
 * caller would decide separately where metadata comes from, which is the
 * divergence this module exists to prevent. Optional-with-a-fallback is both:
 * the plugin cannot get it wrong, and tests pass their own. It is a `??` rather
 * than a parameter default only because fetching one is asynchronous — see
 * `listIssues` in `./issues.ts` for why it has to be.
 *
 * **The history is optional too, and both real callers pass it** (#417). With
 * `historyFile`, every response this read found is stored in the SQLite file
 * it names (`./usage-store.ts`) and the figures are tallied over *everything
 * stored*, so an issue keeps its spend after its transcript is deleted (R1),
 * and the page and the terminal still agree because both pass the same file
 * (R3). Since #418 the store also says how far each transcript was read, so a
 * scan reads only what was written since the last one and an unchanged
 * directory is mostly skipped. Without it, every transcript is read whole, the
 * figures are what is on disk now and `historySince` is null — which is what
 * the unit tests about the join want, and why they need no file of their own.
 * With it, each scan also writes the trend's point for its local calendar day
 * (#419) — replacing that day's earlier point — and the report carries every
 * stored point. `now` is the clock that point and `gatheredAt` are stamped
 * with, a parameter so the tests can move a day, which Playwright cannot.
 *
 * **No source that cannot be read makes this throw.** A missing directory is the ordinary state of a
 * machine that has never run Claude Code in this project, and of CI; a 500 from
 * the middleware would read as the page being broken rather than as the honest
 * "there is nothing here". A `gh` that cannot answer is smaller still: it costs
 * three columns, not the page. Both are reported as warnings beside whatever
 * could be read, the way the project map surfaces what its scan could not
 * parse. Since #420 so is a history that cannot be read: the scan reports the
 * transcripts on disk alone, beside a warning of the history's own, and never
 * writes over the file. A deleted one needs nothing — the store creates a
 * fresh file and this scan fills it from what is on disk.
 *
 * **Each warning names its source** (#289). They were bare strings, so the only
 * way to tell an unreadable directory from an unavailable listing was to match
 * on the sentence — a contract nobody declared and any re-wording breaks.
 * `USAGE_WARNING_SOURCE` is what a caller branches on instead, and it is what
 * lets `bun run tokens` word its own diagnostics off this same scan rather than
 * re-assembling one. What the page displays is unchanged: `message` is the
 * string it used to be handed, rendered as it always was.
 */
export async function gatherUsage(
  dir: string,
  metadata?: IssueMetadata,
  historyFile?: string,
  now: () => Date = () => new Date(),
  { pushedHistory = false }: GatherOptions = {},
): Promise<UsageReport> {
  // Before the listing, not after: `scanMs` answers "how long did pressing
  // Scan take", and `gh` is ~2s of that against 2-5s of filesystem.
  const startedAt = Date.now();
  const listing = metadata ?? (await fetchIssueMetadata());
  if (historyFile === undefined) {
    return reportFrom(dir, listing, startedAt, null, now, pushedHistory);
  }

  let failure: unknown;
  try {
    // Opened before the read rather than after it (#418): its cursors say where
    // each transcript's unread bytes begin. Closed before the response, so
    // nothing holds the file between presses (see the store).
    const store = await openUsageStore(historyFile).catch((err: unknown) => {
      throw new HistoryFailure(err);
    });
    try {
      return reportFrom(dir, listing, startedAt, store, now, pushedHistory);
    } finally {
      fromHistory(() => store.close());
    }
  } catch (err) {
    // Only the store's own calls are the history's to answer for. Anything
    // else is a bug in the scan, and reporting it as a damaged history would
    // send the developer to delete the one file that holds pruned spend.
    if (!(err instanceof HistoryFailure)) throw err;
    failure = err.cause;
  }

  // The history failed — on opening, or part-way through a scan. The reading is
  // then the transcripts on disk alone, read whole: the cursors that would have
  // skipped the bytes already read are in the file that failed. Closed first,
  // so the developer can act on what the warning says.
  const report = reportFrom(dir, listing, startedAt, null, now, pushedHistory);
  report.warnings.push({
    source: USAGE_WARNING_SOURCE.history,
    message: historyWarning(historyFile, failure),
  });
  return report;
}

/** How the server calling `gatherUsage` is set up. */
export interface GatherOptions {
  /**
   * The history is fed by pushes (#428, `PUSHED_HISTORY_ENV` in
   * `./usage-push.ts`): a missing or empty transcript directory beside stored
   * rows is then no warning. The plugin sets it from the environment;
   * `bun run tokens` never does.
   */
  pushedHistory?: boolean;
}

/** A store call that failed, told apart from a failure anywhere else in a
 *  scan so that only the first becomes the history's warning. */
class HistoryFailure extends Error {
  constructor(cause: unknown) {
    super("usage history", { cause });
  }
}

/** Run one call on the store, marking whatever it throws as the history's. */
function fromHistory<T>(call: () => T): T {
  try {
    return call();
  } catch (err) {
    throw new HistoryFailure(err);
  }
}

/**
 * What the page says when the history could not be read (#420).
 *
 * It says what to do because nothing else will. Nothing replaces the file — a
 * damaged history fails on its first statement, before anything is written —
 * so it stays as it was until the developer moves or deletes it: replacing it
 * silently would throw away the spend of every transcript Claude Code has
 * already pruned, which is the one thing the history exists to keep. "Scan
 * again" comes first because a file another scan still holds (the dev server
 * and `bun run tokens` at once, past the store's busy timeout) fails the same
 * way and is not damaged at all.
 */
const historyWarning = (file: string, err: unknown) =>
  `Could not read the usage history at ${file}: ` +
  `${err instanceof Error ? err.message : String(err)}. ` +
  "These figures are the transcripts on disk alone, and nothing replaces the " +
  "file. Scan again in case another scan held it; if it still fails, move it " +
  "aside or delete it to start a new history, which the next scan rebuilds " +
  "from the transcripts still on disk.";

/** `gatherUsage` once the listing is in hand and the history, if any, is open. */
function reportFrom(
  dir: string,
  listing: IssueMetadata,
  startedAt: number,
  store: UsageStore | null,
  now: () => Date,
  pushedHistory: boolean,
): UsageReport {
  const warnings: UsageWarning[] = [];

  // Outside the `try` below, which is about the transcripts: a history that
  // fails here is the history's warning, raised by `gatherUsage`. Every store
  // call in this function goes through `fromHistory` for the same reason.
  const cursors = store ? fromHistory(() => store.cursors()) : undefined;
  let read = emptyRead();
  /* The transcripts' warning, if any, and whether it says only that there are
     none here — a missing directory or an empty one. That kind is dropped below
     on a server whose history is fed by pushes, once it holds rows (#428): it
     is the ordinary state of Railway's develop server, which has no
     transcripts of its own, and its figures are the history's. Everywhere else
     it stays, since on a laptop it is the hint that the scan ran from the wrong
     directory. A directory that exists and cannot be read always warns. */
  let transcriptWarning: UsageWarning | null = null;
  let transcriptsAbsent = false;
  try {
    read = readTranscripts(dir, cursors);
    // Inside the `try`, so "there is nothing in it" is only asked of a directory
    // that was actually read. It used to be a `warnings.length === 0` guard
    // below, which said the same thing by counting what this function had pushed
    // so far — true only while the transcripts were the first source to report,
    // and quietly wrong the moment a second one went in ahead of them.
    if (read.transcripts === 0) {
      transcriptsAbsent = true;
      transcriptWarning = {
        source: USAGE_WARNING_SOURCE.transcripts,
        message: `No .jsonl transcripts in ${dir}.`,
      };
    }
  } catch (err) {
    transcriptsAbsent =
      (err as NodeJS.ErrnoException | null)?.code === "ENOENT";
    transcriptWarning = {
      source: USAGE_WARNING_SOURCE.transcripts,
      message: `Could not read ${dir}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  // Second, and separately: the transcripts can be perfectly readable while the
  // issue listing is not. The page shows every warning it is given, so the two
  // failures stack rather than masking one another — and since #289 they are
  // told apart by `source` rather than by how each one is worded.
  if (listing.warning) {
    warnings.push({
      source: USAGE_WARNING_SOURCE.listing,
      message: listing.warning,
    });
  }

  // Stored, then read back whole: the tally below runs over every response the
  // history holds, including those whose transcript is gone and those an
  // earlier scan read and this one skipped. A read that failed moves no cursor.
  let responses = read.responses;
  let historySince: string | null = null;
  if (store) {
    fromHistory(() => store.record(read.responses, read.cursors));
    responses = fromHistory(() => store.responses());
    historySince = fromHistory(() => store.since());
  }
  // First among the warnings, where it has always been.
  const pushedAndHeld =
    pushedHistory &&
    transcriptsAbsent &&
    store !== null &&
    responses.length > 0;
  if (transcriptWarning && !pushedAndHeld) {
    warnings.unshift(transcriptWarning);
  }
  const { byIssue, unattributed } = tallySpend(responses);
  const issues = joinIssues(byIssue, listing);

  // Today's trend point, from the very rows the page's panels are drawn from
  // (#419), so the two cannot disagree. The same instant stamps the reading,
  // which makes the point's `at` and `gatheredAt` one moment.
  const at = now();
  let trend: TrendPoint[] = [];
  if (store) {
    // Computed outside `fromHistory`: a fault in the arithmetic is not the
    // history's.
    const point = trendPointFor(issues, at);
    fromHistory(() => store.recordPoint(point));
    trend = fromHistory(() => store.trend());
  }

  return {
    gatheredAt: at.toISOString(),
    scanMs: Date.now() - startedAt,
    transcriptDir: dir,
    transcripts: read.transcripts,
    historySince,
    trend,
    issues,
    // Beside the rows, never among them (#253): it has no issue number, nothing
    // forecast it, and there is no band for it to land in — which is also why
    // the page draws it as a total rather than a row.
    unattributed,
    warnings,
  };
}
