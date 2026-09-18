#!/usr/bin/env bun
// Forecast vs. actual token spend, per ticket.
//
// The join, the buckets, the verdicts and the percentile maths live in
// `apps/web/dev/usage.ts`, and the `gh` call in `apps/web/dev/issues.ts` — both
// shared with the dev-tools Usage page, so the terminal and the page cannot
// disagree about what a ticket cost or whether it came in on target. Read those
// files for what the numbers mean and why output tokens are the unit. This one
// decides argv and column widths, and nothing else.
//
// It scans the transcripts itself rather than calling `gatherUsage`, and that
// is not a second copy of the join: `joinIssues` builds the rows both sides
// show. The scan is here because this command reports one figure the page's
// wire shape does not carry — the turns that ran on `main` — and reading the
// directory a second time to recover it costs seconds, not milliseconds: 2-3s
// warm and 28s cold, over this machine's 136 transcripts.
//
// Run by Bun, not Node: the shared module is TypeScript (the dev-tools half is,
// and must be), and relying on Node's type stripping would be an undeclared
// version floor on a repo with no `engines` field. Every other script here is
// Bun already.
//
// Usage:
//   bun run tokens              # every attributable ticket
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

import { readdirSync } from "node:fs";
import { ISSUE_STATE, fetchIssueMetadata } from "../apps/web/dev/issues.ts";
import {
  BUCKETS,
  forecastAccuracy,
  joinIssues,
  percentiles,
  recordedSpend,
  resolveTranscriptDir,
  scanSpend,
  type IssueSpend,
  type Spend,
} from "../apps/web/dev/usage.ts";

const fmt = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1000
      ? `${Math.round(n / 1000)}k`
      : String(n);

async function main() {
  const argv = process.argv.slice(2);
  const openOnly = argv.includes("--open");
  const only = new Set(argv.filter((a) => /^\d+$/.test(a)).map(Number));

  const dir = resolveTranscriptDir();
  // Warned rather than fatal, and that changed with #251: the issue listing on
  // its own is enough to report what is forecast and not yet started, which is
  // exactly what the page shows in this state. Exiting here would make R8 —
  // "the page and `bun run tokens` never report different figures for the same
  // issue" — false on any machine whose transcripts cannot be read, which is
  // the ordinary state of a fresh clone and of CI. An unreadable directory
  // costs the actuals, not the command.
  let scan = { byIssue: new Map<number, Spend>(), unattributed: 0 };
  try {
    const files = readdirSync(dir);
    if (files.some((f) => f.endsWith(".jsonl"))) scan = scanSpend(dir);
    else console.error(`No .jsonl transcripts in ${dir}.\n`);
  } catch {
    console.error(`No transcripts at ${dir} — run this from the repo root.\n`);
  }
  const { byIssue, unattributed } = scan;

  const meta = await fetchIssueMetadata();
  // The warning names what is now unknown; every figure below is unaffected.
  if (meta.warning) console.error(`${meta.warning}\n`);

  // The same rows, in the same order, that the Usage page renders.
  let rows = joinIssues(byIssue, meta);
  if (only.size) rows = rows.filter((r) => only.has(r.issue));
  // The issue's state is the one thing the page has no column for, so it comes
  // off the listing rather than off the row.
  if (openOnly) {
    rows = rows.filter(
      (r) => meta.byIssue?.get(r.issue)?.state === ISSUE_STATE.open,
    );
  }

  if (!rows.length) {
    console.log("No attributable tickets matched.");
    return;
  }

  /** An empty cell, for a row there is no work to report on. Never a zero: the
   *  page's rule, for the same reason — `bucketFor(0)` is `S`, so zeroes would
   *  have every unstarted ticket printing as comfortably under its band. */
  const EMPTY = "-";

  /** One figure off a row's spend, or `EMPTY` when there is none. The branch
   *  said once, the way `figure` says it once on the page. */
  const figure = (
    spend: IssueSpend | null,
    pick: (s: IssueSpend) => number,
    format: (n: number) => string = String,
  ) => (spend ? format(pick(spend)) : EMPTY);

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
        figure(r.spend, (s) => s.out, fmt).padStart(7),
        (r.bucket ?? EMPTY).padEnd(6),
        (r.verdict ?? EMPTY).padEnd(9),
        figure(r.spend, (s) => s.turns).padStart(6),
        figure(r.spend, (s) => s.sessions).padStart(5),
        figure(r.spend, (s) => s.cacheRead, fmt).padStart(7),
        (r.title ?? "").slice(0, 44),
      ].join(" "),
    );
  }

  // The spend rows only, through the shared rule (#252). An issue nobody has
  // started is not a zero-token measurement of how big this repo's tickets are,
  // and letting it into the percentiles would drag the very bands this table
  // exists to re-check — the same exclusion the page's distribution chart makes,
  // which is why it is one function rather than two flatMaps.
  const spent = recordedSpend(rows);
  console.log("-".repeat(head.length));
  // The quartiles are dropped rather than printed as zeroes when nothing in the
  // selection has spend — `bun run tokens --open` on a machine with no matching
  // transcripts is exactly that case, and `percentiles([])` answers 0/0/0,
  // which reads as a measurement of very cheap tickets rather than as no
  // measurement at all. The same rule `EMPTY` carries in the rows above.
  if (spent.length) {
    const { p25, p50, p75 } = percentiles(spent);
    const totalOut = spent.reduce((sum, out) => sum + out, 0);
    console.log(
      `${rows.length} tickets, ${spent.length} with recorded spend | output p25 ${fmt(p25)} median ${fmt(p50)} p75 ${fmt(p75)} | total ${fmt(totalOut)}`,
    );
  } else {
    console.log(
      `${rows.length} tickets, none with recorded spend — no distribution to report.`,
    );
  }
  if (scored) {
    console.log(
      `forecast accuracy: ${onTarget}/${scored} on target (${Math.round((onTarget / scored) * 100)}%)`,
    );
  }
  console.log(
    `unattributed: ${unattributed} turns ran on main or with no branch and belong to no ticket.`,
  );
}

await main();
