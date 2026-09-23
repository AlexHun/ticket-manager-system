// Reads this machine's Claude Code transcripts and says what each issue's
// branches spent — one of the two sources `./usage.ts` joins, beside the issue
// listing in `./issues.ts`.
//
// Answers "we forecast X, we spent Y" for work that happened on a branch. The
// join is `gitBranch`, which Claude Code stamps on every record it writes to
// ~/.claude/projects/<slug>/*.jsonl — measured 2026-09-11 as present on 100%
// of 28,095 turns, so nothing is lost to missing metadata. Branches here are
// named `<type>/<issue>-<slug>`, so the issue number falls out of the branch
// and the spend of every session that ran on it sums to that issue, even when
// the issue took several sittings (the median issue took 2).
//
// **Forecast in output tokens, not total.** Output is the honest unit: it runs
// at a near-constant ~745 tokens per turn (r=0.98 across 125 sessions), so it
// tracks how much work an issue was and nothing else. Cache-read is ~100x
// larger and scales superlinearly with session length (~43k/turn at 12 turns,
// ~218k at 1343), which makes it a measure of session hygiene rather than of
// the issue — so it is carried beside the forecast, never inside it.
//
// Two things this cannot attribute, both by construction:
//   - Work done on `main` or with no branch (28% of all turns when this was
//     written). It belongs to no issue, so it is totalled on its own
//     (`unattributed`) rather than folded into one — in turns *and* output
//     tokens since #253, because a figure that omits a quarter of the work
//     reads as complete when it is not.
//   - Sessions from any other machine. These transcripts are local.
//
// Out of `./usage.ts` since #297, which had grown to hold both the scan and the
// join. The split is the one `./issues.ts` already drew for the other source:
// this module knows the filesystem and the transcript format and nothing about
// forecasts, verdicts or the wire's row; `./usage.ts` knows those and reads
// this through `scanSpend` alone.

import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { UnattributedWork } from "../src/dev/usage-protocol.ts";

/**
 * Environment variable that overrides where transcripts are read from.
 *
 * The seam exists so a test can point at a fixture directory: the real location
 * is derived from the working directory and the home directory, and a machine's
 * actual spend is not something an assertion can be written against.
 */
export const TRANSCRIPT_DIR_ENV = "CLAUDE_TRANSCRIPT_DIR";

/** What one branch, or one issue, cost. `sessions` counts distinct sittings. */
export interface Spend {
  turns: number;
  out: number;
  cacheRead: number;
  sessions: number;
}

export interface ScanResult {
  byIssue: Map<number, Spend>;
  /**
   * What ran on `main` or with no branch, and so belongs to no issue — turns
   * and the output tokens they spent.
   *
   * A total rather than a count since #253. The tokens were being accumulated
   * nowhere and discarded, which is why this is a change to what the scan holds
   * and not only to what its callers print.
   */
  unattributed: UnattributedWork;
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
 * a confident zero and every issue reads as bucket `S`. Nothing here can catch
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
  unattributed: UnattributedWork;
  transcripts: number;
} {
  const byBranch = new Map<string, BranchAccumulator>();
  const unattributed: UnattributedWork = { turns: 0, out: 0 };
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
        // Totalled here rather than counted, and deliberately not given a
        // `BranchAccumulator` of its own: `sessions` and `cacheRead` are
        // questions about an issue, and `main` is not one. See
        // `UnattributedWork` in `../src/dev/usage-protocol.ts` for why the
        // shape stops at two.
        unattributed.turns++;
        unattributed.out += usage.output_tokens ?? 0;
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
 * Collapse branches onto the issue each one names. An issue occasionally gets
 * a second branch (a follow-up fix); both count toward the same issue. A
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
