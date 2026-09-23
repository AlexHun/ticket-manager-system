#!/usr/bin/env bun
// Forecast vs. actual token spend, per issue.
//
// One call does the reading: `gatherUsage(dir, meta)` in `apps/web/dev/usage.ts`
// returns the rows, the unattributed total, the timing and the warnings, and the
// dev-tools Usage page is served that same report. So the terminal and the page
// cannot disagree about what an issue cost or whether it came in on target —
// not because two code paths are kept in step, but because there is one. Read
// that file and `apps/web/dev/issues.ts` for what the numbers mean and why
// output tokens are the unit. This one decides argv and column widths.
//
// **It used to re-assemble the scan itself**, importing nine pieces of that
// module, and the header here argued that it had to: this command words its own
// diagnostics at the terminal rather than handing a page a warning string, and
// `--open` filters on the issue *state*, which no row carries. Both are still
// true, and #290 established that neither is a reason to run different code —
// they are facts about the *interface*, so the interface changed:
//
//   - #253 put the unattributed total on the wire and #289 tagged each warning
//     with the source that failed, so a caller can word its own sentence for a
//     source without matching on the prose of the one it was handed. That is
//     what the loop over `report.warnings` below does, and it is the whole
//     reason this command can call `gatherUsage` and still sound like a
//     terminal.
//   - The state stays **off** the row, and `--open` reads it off the listing
//     this command already holds. See `ISSUE_STATE` at the filter below.
//
// Run by Bun, not Node: the shared modules are TypeScript (the dev-tools half
// is, and must be), and relying on Node's type stripping would be an undeclared
// version floor on a repo with no `engines` field. Every other script here is
// Bun already.
//
// Usage:
//   bun run tokens              # every attributable issue
//   bun run tokens 226 232      # just these issues
//   bun run tokens --open       # only issues still open
//
// `gh` supplies titles and forecast labels. Without it (offline, unauthed) the
// actuals still print, the forecast columns read "-" and the title is blank.
//
// Since #251 the rows are not only what was spent: every *open* issue prints
// too, with its band and no figures, so what is forecast and not yet started
// reads beside what it cost. Those rows are excluded from the percentiles and
// from the accuracy figure — an issue nobody has worked on is neither a
// measurement of the distribution nor a forecast that has been tested.

import { ISSUE_STATE, fetchIssueMetadata } from "../apps/web/dev/issues.ts";
import {
  TRANSCRIPT_DIR_ENV,
  gatherUsage,
  resolveTranscriptDir,
} from "../apps/web/dev/usage.ts";
// Reached directly rather than through `apps/web/dev/usage.ts`, which used to
// re-export this vocabulary on this file's behalf (#290). The contract module is
// import-free and has no filesystem in it, so a script under `scripts/` reads it
// as cheaply as the browser does — and a forwarding block whose only reader was
// this import is a seam with nothing on the other side of it.
import {
  BUCKETS,
  USAGE_WARNING_SOURCE,
  forecastAccuracy,
  hasRecordedSpend,
  percentiles,
  recordedSpend,
  type IssueSpend,
  type IssueUsage,
  type UsageReport,
  type UsageWarning,
} from "../apps/web/src/dev/usage-protocol.ts";

const fmt = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1000
      ? `${Math.round(n / 1000)}k`
      : String(n);

/**
 * The diagnostic this command prints for a source that could not be read.
 *
 * The transcripts get a sentence of this command's own, because the advice is
 * this command's own — and it branches on **why the directory is the directory**
 * rather than on how the read failed. Unresolvable and empty take the same
 * advice, which is `USAGE_WARNING_SOURCE`'s two-values-not-three shape (#289)
 * holding up: a terminal that wanted to tell those two apart could only do it by
 * matching the sentence it was handed, which is the contract that shape exists
 * to remove. What does change the advice is the override: with
 * `CLAUDE_TRANSCRIPT_DIR` unset the directory is derived from the working
 * directory, so "run this from the repo root" is the fix; with it set, the cwd
 * is not consulted at all and that sentence would send the developer to correct
 * something the run never read. Naming the variable is the whole of the fix
 * there, so that is all it says.
 *
 * The directory comes off the report rather than from the local `dir`. They are
 * the same string today because this command passes one in, and reading it back
 * from the reading it is describing is what keeps them the same string.
 *
 * The listing's message is passed through, and that is not the same thing as
 * printing a page's string: it is `fetchIssueMetadata`'s own account of what it
 * could not read, it already names the file or the `gh` failure and says what it
 * costs ("titles, links and forecast bands read as unknown"), and there is no
 * terminal-specific advice to add. Re-wording it here would be a second copy of
 * a sentence with nothing new in it.
 */
const diagnostic = (warning: UsageWarning, report: UsageReport) => {
  if (warning.source !== USAGE_WARNING_SOURCE.transcripts) {
    return warning.message;
  }
  const at = `No transcripts at ${report.transcriptDir}`;
  return process.env[TRANSCRIPT_DIR_ENV]?.trim()
    ? `${at}, which ${TRANSCRIPT_DIR_ENV} names.`
    : `${at} — run this from the repo root.`;
};

async function main() {
  const argv = process.argv.slice(2);
  const openOnly = argv.includes("--open");
  const only = new Set(argv.filter((a) => /^\d+$/.test(a)).map(Number));

  const dir = resolveTranscriptDir();
  // The listing is fetched here rather than left to `gatherUsage`'s own default,
  // for the one thing it holds that the report does not: `--open` needs the
  // issue's state. Passing it in is what the parameter is for — the Vite plugin
  // omits it, the tests supply fixtures — and it costs no extra call, since
  // `gatherUsage` would have made exactly this one.
  const meta = await fetchIssueMetadata();
  const report = await gatherUsage(dir, meta);

  // Warned rather than fatal, and both sources are warnings for the same reason:
  // an unreadable transcript directory is the ordinary state of a fresh clone
  // and of CI, and it costs the actuals rather than the command — the listing
  // alone is enough to report what is forecast and not yet started, which is
  // exactly what the page shows in that state. A `gh` that cannot answer is
  // smaller still: three columns. Exiting on either would make R8 — "the page
  // and `bun run tokens` never report different figures" — false on any machine
  // where one source is unavailable.
  //
  // Every warning is printed, and they stack: the directory can be unreadable
  // while `gh` answers perfectly, and the reverse (#289). Nothing here counts
  // them or stops at the first.
  for (const warning of report.warnings) {
    console.error(`${diagnostic(warning, report)}\n`);
  }

  // The same rows, in the same order, that the Usage page renders — because they
  // are the same rows, off the same report.
  let rows = report.issues;
  if (only.size) rows = rows.filter((r) => only.has(r.issue));
  // The issue's state is the one thing the page has no column for, so it comes
  // off the listing rather than off the row — and #290 decided it stays that
  // way. `IssueUsage` is the wire, and #253's rule is that a field on the wire
  // is a promise something reads it; after this slice the only reader would be
  // this line. It would also be a field the row set already implies, since an
  // issue with no spend earns a row only because the listing called it open.
  // What this costs is a `Map` lookup against a listing this command is holding
  // anyway in order to pass it above, which is a cheaper thing to keep than a
  // column the page must carry and can never show.
  if (openOnly) {
    rows = rows.filter(
      (r) => meta.byIssue?.get(r.issue)?.state === ISSUE_STATE.open,
    );
  }

  if (!rows.length) {
    console.log("No attributable issues matched.");
    return;
  }

  /** An empty cell, for a row there is no work to report on. Never a zero: the
   *  page's rule, for the same reason — `bucketFor(0)` is `S`, so zeroes would
   *  have every unstarted issue printing as comfortably under its band. */
  const EMPTY = "-";

  /**
   * One figure off a row's spend, or `EMPTY` when there is none.
   *
   * Takes the **row** and asks `hasRecordedSpend` (#285), rather than taking a
   * nullable `IssueSpend` and branching on it. That predicate is the page's
   * central rule written once, and this was the last copy of it left anywhere —
   * kept only because this file could not reach a row while it was assembling
   * its own. It can now, so it does: the type guard narrows `row.spend`, and the
   * `pick` below reads it with no `?.` or `!` standing beside the check as a
   * second, unverified copy.
   */
  const figure = (
    row: IssueUsage,
    pick: (s: IssueSpend) => number,
    format: (n: number) => string = String,
  ) => (hasRecordedSpend(row) ? format(pick(row.spend)) : EMPTY);

  const head = [
    "issue".padEnd(6),
    "forecast".padEnd(10),
    "actual".padStart(7),
    "bucket".padEnd(6),
    "verdict".padEnd(9),
    "turns".padStart(6),
    "sess".padStart(5),
    "cache".padStart(7),
    "title",
  ].join(" ");
  console.log(head);
  console.log("-".repeat(head.length));

  // Tallied by `forecastAccuracy` rather than here (#252). It is gated on the
  // verdict rather than on the forecast — since #251 a row can carry a band and
  // no spend to read it against, and counting those as scored-and-missed would
  // drive the figure toward zero as the backlog grows — and the reason it is not
  // four lines of local arithmetic is that the Usage page prints this same
  // fraction in a card corner. Two tallies of the same rows agree until one of
  // them changes, and nothing fails when they stop.
  const { scored, onTarget } = forecastAccuracy(rows);

  for (const r of rows) {
    console.log(
      [
        `#${r.issue}`.padEnd(6),
        (r.forecast
          ? `${r.forecast} ${BUCKETS[r.forecast].label}`
          : EMPTY
        ).padEnd(10),
        figure(r, (s) => s.out, fmt).padStart(7),
        (r.bucket ?? EMPTY).padEnd(6),
        (r.verdict ?? EMPTY).padEnd(9),
        figure(r, (s) => s.turns).padStart(6),
        figure(r, (s) => s.sessions).padStart(5),
        figure(r, (s) => s.cacheRead, fmt).padStart(7),
        (r.title ?? "").slice(0, 44),
      ].join(" "),
    );
  }

  // The spend rows only, through the shared rule (#252). An issue nobody has
  // started is not a zero-token measurement of how big this repo's issues are,
  // and letting it into the percentiles would drag the very bands this table
  // exists to re-check — the same exclusion the page's distribution chart makes,
  // which is why it is one function rather than two flatMaps.
  const spent = recordedSpend(rows);
  console.log("-".repeat(head.length));
  // The quartiles are dropped rather than printed as zeroes when nothing in the
  // selection has spend — `bun run tokens --open` on a machine with no matching
  // transcripts is exactly that case, and `percentiles([])` answers 0/0/0,
  // which reads as a measurement of very cheap issues rather than as no
  // measurement at all. The same rule `EMPTY` carries in the rows above.
  if (spent.length) {
    const { p25, p50, p75 } = percentiles(spent);
    const totalOut = spent.reduce((sum, out) => sum + out, 0);
    console.log(
      `${rows.length} issues, ${spent.length} with recorded spend | output p25 ${fmt(p25)} median ${fmt(p50)} p75 ${fmt(p75)} | total ${fmt(totalOut)}`,
    );
  } else {
    console.log(
      `${rows.length} issues, none with recorded spend — no distribution to report.`,
    );
  }
  if (scored) {
    console.log(
      `forecast accuracy: ${onTarget}/${scored} on target (${Math.round((onTarget / scored) * 100)}%)`,
    );
  }
  // The last line, and since #253 it carries the tokens as well as the turns —
  // the scan used to count these turns and discard their output, so this said
  // how much work happened off-issue and never what it cost. The figures are the
  // report's, which is what the Usage page is served, so R8 holds for the one
  // total that is not a row.
  const { unattributed } = report;
  const turns = `${unattributed.turns} ${unattributed.turns === 1 ? "turn" : "turns"}`;
  console.log(
    `unattributed: ${turns} and ${fmt(unattributed.out)} output tokens ran on main or with no branch, belonging to no issue.`,
  );
}

await main();
