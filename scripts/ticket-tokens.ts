#!/usr/bin/env bun
// Forecast vs. actual token spend, per ticket.
//
// The join, the buckets and the percentile maths live in `apps/web/dev/usage.ts`
// — shared with the dev-tools Usage page, so the terminal and the page cannot
// disagree about what a ticket cost. Read that file for what the numbers mean
// and why output tokens are the unit. This one only asks `gh` for titles and
// forecast labels, and prints the table.
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
import { execFileSync } from "node:child_process";
import {
  BUCKETS,
  bucketFor,
  percentiles,
  resolveTranscriptDir,
  scanSpend,
} from "../apps/web/dev/usage.ts";

interface IssueMeta {
  title: string;
  state: string;
  forecast: string | null;
}

// Titles and forecast labels, one `gh` call for the whole set.
function issueMetadata(): Map<number, IssueMeta> | null {
  try {
    const raw = execFileSync(
      "gh",
      [
        "issue",
        "list",
        "--state",
        "all",
        "--limit",
        "500",
        "--json",
        "number,title,labels,state",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const issues = JSON.parse(raw) as {
      number: number;
      title: string;
      state: string;
      labels: { name: string }[];
    }[];
    return new Map(
      issues.map((i) => [
        i.number,
        {
          title: i.title,
          state: i.state,
          forecast:
            i.labels
              .map((l) => l.name)
              .find((n) => n.startsWith("forecast/"))
              ?.slice("forecast/".length) ?? null,
        },
      ]),
    );
  } catch {
    return null;
  }
}

const fmt = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1000
      ? `${Math.round(n / 1000)}k`
      : String(n);

function main() {
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
  const meta = issueMetadata();
  if (!meta) console.error("gh unavailable — forecast columns read '-'.\n");

  let rows = [...byIssue.entries()].map(([number, s]) => ({
    number,
    ...s,
    ...(meta?.get(number) ?? { title: "", state: "", forecast: null }),
  }));
  if (only.size) rows = rows.filter((r) => only.has(r.number));
  if (openOnly) rows = rows.filter((r) => r.state === "OPEN");
  rows.sort((a, b) => b.out - a.out);

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
    const actual = bucketFor(r.out);
    let verdict = "-";
    const forecast =
      r.forecast && r.forecast in BUCKETS
        ? (r.forecast as keyof typeof BUCKETS)
        : null;
    if (forecast) {
      scored++;
      if (forecast === actual) {
        verdict = "on target";
        hits++;
      } else {
        verdict = r.out >= BUCKETS[forecast].max ? "over" : "under";
      }
    }
    console.log(
      [
        `#${r.number}`.padEnd(6),
        (forecast ? `${forecast} ${BUCKETS[forecast].label}` : "-").padEnd(10),
        fmt(r.out).padStart(7),
        actual.padEnd(6),
        verdict.padEnd(9),
        String(r.turns).padStart(6),
        String(r.sessions).padStart(5),
        fmt(r.cacheRead).padStart(7),
        r.title.slice(0, 44),
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

main();
