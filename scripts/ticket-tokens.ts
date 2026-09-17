#!/usr/bin/env bun
// Forecast vs. actual token spend, per ticket.
//
// The join, the buckets, the verdicts and the percentile maths live in
// `apps/web/dev/usage.ts`, and the `gh` call in `apps/web/dev/issues.ts` — both
// shared with the dev-tools Usage page, so the terminal and the page cannot
// disagree about what a ticket cost or whether it came in on target. Read those
// files for what the numbers mean and why output tokens are the unit. This one
// decides argv, column widths and the exit code, and nothing else.
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
// actuals still print and the forecast columns read "-".

import { readdirSync } from "node:fs";
import { fetchIssueMetadata } from "../apps/web/dev/issues.ts";
import {
  BUCKETS,
  joinIssues,
  percentiles,
  resolveTranscriptDir,
  scanSpend,
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
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    console.error(`No transcripts at ${dir} — run this from the repo root.`);
    process.exit(1);
  }
  if (!files.some((f) => f.endsWith(".jsonl"))) {
    console.error(`No .jsonl transcripts in ${dir}.`);
    process.exit(1);
  }

  const { byIssue, unattributed } = scanSpend(dir);
  const meta = await fetchIssueMetadata();
  // The warning names what is now unknown; every figure below is unaffected.
  if (meta.warning) console.error(`${meta.warning}\n`);

  // The same rows, in the same order, that the Usage page renders.
  let rows = joinIssues(byIssue, meta);
  if (only.size) rows = rows.filter((r) => only.has(r.issue));
  // The issue's state is the one thing the page has no column for, so it comes
  // off the listing rather than off the row.
  if (openOnly) {
    rows = rows.filter((r) => meta.byIssue?.get(r.issue)?.state === "OPEN");
  }

  if (!rows.length) {
    console.log("No attributable tickets matched.");
    return;
  }

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

  let hits = 0;
  let scored = 0;
  for (const r of rows) {
    if (r.forecast) {
      scored++;
      if (r.verdict === "on target") hits++;
    }
    console.log(
      [
        `#${r.issue}`.padEnd(6),
        (r.forecast
          ? `${r.forecast} ${BUCKETS[r.forecast].label}`
          : "-"
        ).padEnd(10),
        fmt(r.out).padStart(7),
        r.bucket.padEnd(6),
        (r.verdict ?? "-").padEnd(9),
        String(r.turns).padStart(6),
        String(r.sessions).padStart(5),
        fmt(r.cacheRead).padStart(7),
        (r.title ?? "").slice(0, 44),
      ].join(" "),
    );
  }

  const { p25, p50, p75 } = percentiles(rows.map((r) => r.out));
  const totalOut = rows.reduce((s, r) => s + r.out, 0);
  console.log("-".repeat(head.length));
  console.log(
    `${rows.length} tickets | output p25 ${fmt(p25)} median ${fmt(p50)} p75 ${fmt(p75)} | total ${fmt(totalOut)}`,
  );
  if (scored) {
    console.log(
      `forecast accuracy: ${hits}/${scored} on target (${Math.round((hits / scored) * 100)}%)`,
    );
  }
  console.log(
    `unattributed: ${unattributed} turns ran on main or with no branch and belong to no ticket.`,
  );
}

await main();
