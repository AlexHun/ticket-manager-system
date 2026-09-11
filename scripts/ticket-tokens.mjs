#!/usr/bin/env node
// Forecast vs. actual token spend, per ticket.
//
// Answers "we forecast X, we spent Y" for work that happened on a branch. The
// join is `gitBranch`, which Claude Code stamps on every record it writes to
// ~/.claude/projects/<slug>/*.jsonl — measured 2026-09-11 as present on 100%
// of 28,095 turns, so nothing is lost to missing metadata. Branches here are
// named `<type>/<issue>-<slug>`, so the issue number falls out of the branch
// and the spend of every session that ran on it sums to that ticket, even when
// the ticket took several sittings (the median ticket took 2).
//
// The forecast lives on the issue as a `forecast/S|M|L` label, set when the
// ticket is cut. The buckets are this repo's own measured per-ticket
// distribution over 90 issue-numbered branches: p25 55k, median 90k, p75 154k.
//
// **Forecast in output tokens, not total.** Output is the honest unit: it runs
// at a near-constant ~745 tokens per turn (r=0.98 across 125 sessions), so it
// tracks how much work a ticket was and nothing else. Cache-read is ~100x
// larger and scales superlinearly with session length (~43k/turn at 12 turns,
// ~218k at 1343), which makes it a measure of session hygiene rather than of
// the ticket — so it is reported beside the forecast, never inside it.
//
// Two things this cannot see, both by construction:
//   - Work done on `main` with no branch (28% of all turns when this was
//     written). It belongs to no ticket, so it is counted only in the footer.
//   - Sessions from any other machine. These transcripts are local.
//
// Usage:
//   node scripts/ticket-tokens.mjs              # every attributable ticket
//   node scripts/ticket-tokens.mjs 226 232      # just these issues
//   node scripts/ticket-tokens.mjs --open       # only issues still open
//
// `gh` supplies titles and forecast labels. Without it (offline, unauthed) the
// actuals still print and the forecast columns read "-".

import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

// Output-token bands. `max` is exclusive; XL is the open-ended top bucket and
// is a split signal rather than a size — nothing should be forecast into it.
const BUCKETS = {
  S: { max: 60_000, label: "<60k" },
  M: { max: 150_000, label: "60-150k" },
  L: { max: 250_000, label: "150-250k" },
  XL: { max: Infinity, label: ">250k" },
};

const bucketFor = (out) =>
  Object.keys(BUCKETS).find((b) => out < BUCKETS[b].max) ?? "XL";

function transcriptDir() {
  const slug = process.cwd().replace(/[\\/:]/g, "-");
  return join(homedir(), ".claude", "projects", slug);
}

// Sum usage per branch. One pass over every transcript; the files are
// append-only JSONL and a partially-written last line is normal, so an
// unparseable line is skipped rather than fatal.
function spendByBranch(dir) {
  const byBranch = new Map();
  let unattributed = 0;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".jsonl"))) {
    for (const line of readFileSync(join(dir, file), "utf8").split("\n")) {
      if (!line.trim()) continue;
      let rec;
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
      const usage = rec.message?.usage;
      if (!usage) continue;
      const branch = rec.gitBranch;
      if (!branch || branch === "main") {
        unattributed++;
        continue;
      }
      const acc = byBranch.get(branch) ?? {
        turns: 0,
        out: 0,
        cacheRead: 0,
        sessions: new Set(),
      };
      acc.turns++;
      acc.out += usage.output_tokens ?? 0;
      acc.cacheRead += usage.cache_read_input_tokens ?? 0;
      acc.sessions.add(rec.sessionId);
      byBranch.set(branch, acc);
    }
  }
  return { byBranch, unattributed };
}

// Collapse branches onto the issue each one names. A ticket occasionally gets
// a second branch (a follow-up fix); both count toward the same ticket.
function spendByIssue(byBranch) {
  const byIssue = new Map();
  for (const [branch, s] of byBranch) {
    const m = branch.match(/\/(\d+)-/);
    if (!m) continue;
    const number = Number(m[1]);
    const acc = byIssue.get(number) ?? {
      turns: 0,
      out: 0,
      cacheRead: 0,
      sessions: 0,
    };
    acc.turns += s.turns;
    acc.out += s.out;
    acc.cacheRead += s.cacheRead;
    acc.sessions += s.sessions.size;
    byIssue.set(number, acc);
  }
  return byIssue;
}

// Titles and forecast labels, one `gh` call for the whole set.
function issueMetadata() {
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
    return new Map(
      JSON.parse(raw).map((i) => [
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

const fmt = (n) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1000
      ? `${Math.round(n / 1000)}k`
      : String(n);

function main() {
  const argv = process.argv.slice(2);
  const openOnly = argv.includes("--open");
  const only = new Set(argv.filter((a) => /^\d+$/.test(a)).map(Number));

  const dir = transcriptDir();
  let files;
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

  const { byBranch, unattributed } = spendByBranch(dir);
  const byIssue = spendByIssue(byBranch);
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
    if (r.forecast && BUCKETS[r.forecast]) {
      scored++;
      if (r.forecast === actual) {
        verdict = "on target";
        hits++;
      } else {
        verdict = r.out >= BUCKETS[r.forecast].max ? "over" : "under";
      }
    }
    console.log(
      [
        `#${r.number}`.padEnd(6),
        (r.forecast
          ? `${r.forecast} ${BUCKETS[r.forecast].label}`
          : "-"
        ).padEnd(10),
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

  const sorted = rows.map((r) => r.out).sort((a, b) => a - b);
  const pct = (q) => sorted[Math.floor(sorted.length * q)];
  const totalOut = rows.reduce((s, r) => s + r.out, 0);
  console.log("-".repeat(head.length));
  console.log(
    `${rows.length} tickets | output p25 ${fmt(pct(0.25))} median ${fmt(pct(0.5))} p75 ${fmt(pct(0.75))} | total ${fmt(totalOut)}`,
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
