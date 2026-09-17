// The branch-to-issue join behind `bun run tokens` and the dev-tools Usage page.
//
// Answers "we forecast X, we spent Y" for work that happened on a branch. The
// join is `gitBranch`, which Claude Code stamps on every record it writes to
// ~/.claude/projects/<slug>/*.jsonl — measured 2026-09-11 as present on 100%
// of 28,095 turns, so nothing is lost to missing metadata. Branches here are
// named `<type>/<issue>-<slug>`, so the issue number falls out of the branch
// and the spend of every session that ran on it sums to that ticket, even when
// the ticket took several sittings (the median ticket took 2).
//
// **Forecast in output tokens, not total.** Output is the honest unit: it runs
// at a near-constant ~745 tokens per turn (r=0.98 across 125 sessions), so it
// tracks how much work a ticket was and nothing else. Cache-read is ~100x
// larger and scales superlinearly with session length (~43k/turn at 12 turns,
// ~218k at 1343), which makes it a measure of session hygiene rather than of
// the ticket — so it is carried beside the forecast, never inside it.
//
// Two things this cannot see, both by construction:
//   - Work done on `main` with no branch (28% of all turns when this was
//     written). It belongs to no ticket, so it is only counted (`unattributed`).
//   - Sessions from any other machine. These transcripts are local.
//
// This module is the single copy of the join. `scripts/ticket-tokens.ts` prints
// it at the terminal; the dev-tools Vite plugin serves `gatherUsage` to the
// Usage page under `/__dev` (#248), which is why it lives here rather than
// under `scripts/`. It reads the filesystem and nothing else — no `gh`, no
// terminal formatting, no process exit — so both callers can decide those for
// themselves.

import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
// Type-only, so nothing of the protocol reaches this module at runtime — it is
// the same file the Vite plugin and the pages under `/__dev` import, and the
// reason the report this builds cannot drift from what the page reads.
import type { UsageReport } from "../src/dev/protocol.ts";

/**
 * Environment variable that overrides where transcripts are read from.
 *
 * The seam exists so a test can point at a fixture directory: the real location
 * is derived from the working directory and the home directory, and a machine's
 * actual spend is not something an assertion can be written against.
 */
export const TRANSCRIPT_DIR_ENV = "CLAUDE_TRANSCRIPT_DIR";

/**
 * Output-token bands. `max` is exclusive; XL is the open-ended top bucket and
 * is a split signal rather than a size — nothing should be forecast into it.
 *
 * These are this repo's own measured per-ticket distribution over 90
 * issue-numbered branches: p25 55k, median 90k, p75 154k.
 */
export const BUCKETS = {
  S: { max: 60_000, label: "<60k" },
  M: { max: 150_000, label: "60-150k" },
  L: { max: 250_000, label: "150-250k" },
  XL: { max: Infinity, label: ">250k" },
} as const;

export type Bucket = keyof typeof BUCKETS;

export const bucketFor = (out: number): Bucket =>
  (Object.keys(BUCKETS) as Bucket[]).find((b) => out < BUCKETS[b].max) ?? "XL";

/** What one branch, or one issue, cost. `sessions` counts distinct sittings. */
export interface Spend {
  turns: number;
  out: number;
  cacheRead: number;
  sessions: number;
}

export interface ScanResult {
  byIssue: Map<number, Spend>;
  /** Turns that ran on `main` or with no branch, and so belong to no issue. */
  unattributed: number;
  /** `.jsonl` files actually read. Zero is the honest answer for a machine that
   *  has never run Claude Code in this project, and is not the same thing as
   *  "nobody spent anything". */
  transcripts: number;
}

/**
 * Where the transcripts live, as one resolvable decision.
 *
 * `env` and the cwd/home pair are parameters rather than reads of `process` so
 * this stays a pure function; the defaults are what both callers want.
 */
export function resolveTranscriptDir(
  env: Record<string, string | undefined> = process.env,
  {
    cwd = process.cwd(),
    home = homedir(),
  }: { cwd?: string; home?: string } = {},
): string {
  const override = env[TRANSCRIPT_DIR_ENV]?.trim();
  if (override) return override;
  return join(home, ".claude", "projects", cwd.replace(/[\\/:]/g, "-"));
}

/**
 * The fields this reads off a transcript record; everything else is ignored.
 *
 * Optional throughout because that is genuinely what a JSONL line offers —
 * there is no vendor type for a Claude Code transcript record to adapt from, so
 * [conventions.md](../../../docs/standards/conventions.md)'s "take the library's
 * type by name" has nothing to take. The failure mode it warns about still
 * applies: if Claude Code renames `output_tokens`, every `?? 0` below turns into
 * a confident zero and every ticket reads as bucket `S`. Nothing here can catch
 * that, so the check is the `unattributed` and total figures in the output — a
 * total that collapses to near-zero is the rename, not a quiet month.
 */
interface TranscriptRecord {
  sessionId?: string;
  gitBranch?: string;
  message?: {
    usage?: { output_tokens?: number; cache_read_input_tokens?: number };
  };
}

/** A branch's running total. Distinct sessions are counted, so it holds a set. */
interface BranchAccumulator extends Omit<Spend, "sessions"> {
  sessions: Set<string>;
}

/**
 * Sum usage per branch. One pass over every transcript; the files are
 * append-only JSONL and a partially-written last line is normal, so an
 * unparseable line is skipped rather than fatal.
 */
function spendByBranch(dir: string): {
  byBranch: Map<string, BranchAccumulator>;
  unattributed: number;
  transcripts: number;
} {
  const byBranch = new Map<string, BranchAccumulator>();
  let unattributed = 0;
  const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  for (const file of files) {
    for (const line of readFileSync(join(dir, file), "utf8").split("\n")) {
      if (!line.trim()) continue;
      let rec: TranscriptRecord;
      try {
        rec = JSON.parse(line) as TranscriptRecord;
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
        sessions: new Set<string>(),
      };
      acc.turns++;
      acc.out += usage.output_tokens ?? 0;
      acc.cacheRead += usage.cache_read_input_tokens ?? 0;
      acc.sessions.add(rec.sessionId ?? "");
      byBranch.set(branch, acc);
    }
  }
  return { byBranch, unattributed, transcripts: files.length };
}

/**
 * Collapse branches onto the issue each one names. A ticket occasionally gets
 * a second branch (a follow-up fix); both count toward the same ticket. A
 * branch naming no issue is not attributable and is dropped.
 */
function spendByIssue(
  byBranch: Map<string, BranchAccumulator>,
): Map<number, Spend> {
  const byIssue = new Map<number, Spend>();
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

/** Read every transcript in `dir` and attribute its spend to issues. */
export function scanSpend(dir: string): ScanResult {
  const { byBranch, unattributed, transcripts } = spendByBranch(dir);
  return { byIssue: spendByIssue(byBranch), unattributed, transcripts };
}

/**
 * One reading of `dir`, in the shape the wire carries.
 *
 * The composition lives here rather than in the plugin so that R8 — the page
 * and `bun run tokens` never report different figures for the same issue — is a
 * property of one module rather than of two callers agreeing to be careful. The
 * plugin's job is reduced to resolving the directory and serialising this.
 *
 * **Nothing here throws.** A missing directory is the ordinary state of a
 * machine that has never run Claude Code in this project, and of CI; a 500 from
 * the middleware would read as the page being broken rather than as the honest
 * "there is nothing here". So the failure is reported as a warning beside an
 * empty table, the way the project map surfaces what its scan could not parse.
 */
export function gatherUsage(dir: string): UsageReport {
  const startedAt = Date.now();
  const warnings: string[] = [];

  let scan: ScanResult = {
    byIssue: new Map(),
    unattributed: 0,
    transcripts: 0,
  };
  try {
    scan = scanSpend(dir);
  } catch (err) {
    warnings.push(
      `Could not read ${dir}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (warnings.length === 0 && scan.transcripts === 0) {
    warnings.push(`No .jsonl transcripts in ${dir}.`);
  }

  const issues = [...scan.byIssue.entries()]
    .map(([issue, spend]) => ({ issue, ...spend }))
    // Spend descending is the order the question is asked in. The tie-break on
    // the issue number is what makes two scans of an unchanged directory agree:
    // `Array.prototype.sort` is stable, but `Map` iteration order is insertion
    // order, which is the order the filesystem happened to hand the files over.
    .sort((a, b) => b.out - a.out || a.issue - b.issue);

  return {
    gatheredAt: new Date().toISOString(),
    scanMs: Date.now() - startedAt,
    transcriptDir: dir,
    transcripts: scan.transcripts,
    issues,
    warnings,
  };
}

/**
 * The quartiles of a set of output-token totals.
 *
 * Nearest-rank on the sorted values — the same arithmetic the CLI has always
 * printed, kept here so the page and the terminal cannot disagree. An empty set
 * reports zeroes rather than `undefined`, so a caller formatting the result does
 * not have to branch.
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
