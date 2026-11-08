// Reads this machine's Claude Code transcripts and says what each issue's
// branches spent — one of the two sources `./usage.ts` joins, beside the issue
// listing in `./issues.ts`.
//
// Answers "we forecast X, we spent Y" for work that happened on a branch. The
// join is `gitBranch`, which Claude Code stamps on every record it writes to
// ~/.claude/projects/<slug>/*.jsonl — measured 2026-09-11 as present on 100%
// of 28,095 turns, so nothing is lost to missing metadata — and to each
// session's subagent transcripts at
// ~/.claude/projects/<slug>/<session>/subagents/*.jsonl, read since #431
// (1.29M output tokens across 218 files when measured, 2026-10-06). Branches
// here are named `<type>/<issue>-<slug>`, so the issue number falls out of the
// branch and the spend of every session that ran on it sums to that issue, even
// when the issue took several sittings (the median issue took 2).
//
// **Forecast in output tokens, not total.** Output is the honest unit: it runs
// at ~500 tokens per turn and follows turns at r=0.84 across issues
// (re-measured on responses in #627), so it tracks how much work an issue was
// and nothing else. A ticket is split by peak context instead, which output
// predicts poorly (`docs/agents/issue-tracker.md`). Cache-read is ~100x
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
// The 28,095 turns, the cache-read per turn and the 28% on `main` above were
// measured before #413, when a "turn" was a transcript record rather than an
// API response and a response's usage was counted once per record, so they
// want re-measuring on the corrected figures. #627 re-measured the output per
// turn.
//
// Out of `./usage.ts` since #297, which had grown to hold both the scan and the
// join. The split is the one `./issues.ts` already drew for the other source:
// this module knows the filesystem and the transcript format and nothing about
// forecasts, verdicts or the wire's row; `./usage.ts` knows those.
//
// Since #417 it is two halves rather than one sweep: `readTranscripts`
// (`./transcript-reader.ts` since #748) turns the files into one
// `TranscriptResponse` per API response, and `tallySpend` attributes and
// counts any set of them. `./usage.ts` stores the first in the usage history
// (`./usage-store.ts`) and runs the second over everything stored, so spend
// survives a deleted transcript; `scanSpend` is the two run back to back over
// what is on disk, with no history.

import { homedir } from "node:os";
import { join } from "node:path";
import type { UnattributedWork } from "../src/dev/usage-protocol.ts";
import {
  readTranscripts,
  type TranscriptResponse,
} from "./transcript-reader.ts";

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
  /**
   * The largest context among the issue's responses in the window holding
   * most of its turns (#642): the figure a ticket is cut by
   * (`docs/agents/issue-tracker.md`). Null when any of its responses has no
   * window or no context, a row stored before #642, since the window holding
   * most turns cannot then be known.
   */
  peakContext: number | null;
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
  /** `.jsonl` files actually read, subagent transcripts included (#431). Zero
   *  is the honest answer for a machine that has never run Claude Code in this
   *  project, and is not the same thing as "nobody spent anything". */
  transcripts: number;
}

/**
 * The directory name Claude Code keys a project's transcripts on: the project
 * root with every separator and the drive colon turned into `-`.
 *
 * Exported because the transcripts are not the only thing keyed on it: the
 * usage history (`./usage-store.ts`) names its file with it too — but of the
 * main worktree's root rather than of the working directory, so every worktree
 * of a clone shares one history while each keeps its own transcripts (#423).
 */
export const projectSlug = (cwd: string): string => cwd.replace(/[\\/:]/g, "-");

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
  return join(home, ".claude", "projects", projectSlug(cwd));
}

/**
 * The issue a branch names, or null for a branch that names none.
 *
 * Branches here are `<type>/<issue>-<slug>`. A branch naming no issue is not
 * attributable and is dropped — and it is not unattributed either, which means
 * `main` or no branch at all and is decided before this is asked.
 */
export function issueOfBranch(branch: string): number | null {
  const m = branch.match(/\/(\d+)-/);
  return m ? Number(m[1]) : null;
}

/** One issue's turns in one window, and the largest context among them. */
interface WindowShare {
  turns: number;
  peak: number;
}

/**
 * A branch's running total. Distinct sessions are counted, so it holds a set.
 * The peak is decided per issue, so it holds each window's share (#642), and
 * whether any response had no window or no context to share.
 */
interface BranchAccumulator extends Omit<Spend, "sessions" | "peakContext"> {
  sessions: Set<string>;
  windows: Map<string, WindowShare>;
  unknownWindow: boolean;
}

/**
 * Attribute and count a set of responses: what each issue's branches spent, and
 * what ran on `main` or on no branch.
 *
 * Every response counts once, as one turn — `readTranscripts` and the history's
 * identity key have already made each one appear once. `issueOf` is a parameter
 * for R11's sake: attribution runs over the stored rows on every read, and a
 * test changes the rule and watches stored figures follow it, including for
 * rows whose transcript is gone. Both real callers take the default.
 */
export function tallySpend(
  responses: readonly TranscriptResponse[],
  issueOf: (branch: string) => number | null = issueOfBranch,
): Omit<ScanResult, "transcripts"> {
  const byBranch = new Map<string, BranchAccumulator>();
  const unattributed: UnattributedWork = { turns: 0, out: 0 };
  for (const r of responses) {
    if (!r.branch || r.branch === "main") {
      // Totalled here rather than counted, and deliberately not given a
      // `BranchAccumulator` of its own: `sessions` and `cacheRead` are
      // questions about an issue, and `main` is not one. See
      // `UnattributedWork` in `../src/dev/usage-protocol.ts` for why the
      // shape stops at two.
      unattributed.turns++;
      unattributed.out += r.out;
      continue;
    }
    const acc = byBranch.get(r.branch) ?? {
      turns: 0,
      out: 0,
      cacheRead: 0,
      sessions: new Set<string>(),
      windows: new Map<string, WindowShare>(),
      unknownWindow: false,
    };
    acc.turns++;
    acc.out += r.out;
    acc.cacheRead += r.cacheRead;
    acc.sessions.add(r.session ?? "");
    if (r.window === null || r.context === null) {
      acc.unknownWindow = true;
    } else {
      addToWindow(acc.windows, r.window, { turns: 1, peak: r.context });
    }
    byBranch.set(r.branch, acc);
  }
  return { byIssue: spendByIssue(byBranch, issueOf), unattributed };
}

/** An issue's running total: its branches' sittings counted, their windows'
 *  shares merged. */
interface IssueAccumulator extends Omit<BranchAccumulator, "sessions"> {
  sessions: number;
}

/** Add `more` to one window's share: its turns, and its peak if larger. */
function addToWindow(
  windows: Map<string, WindowShare>,
  window: string,
  more: WindowShare,
) {
  const share = windows.get(window) ?? { turns: 0, peak: 0 };
  share.turns += more.turns;
  share.peak = Math.max(share.peak, more.peak);
  windows.set(window, share);
}

/**
 * The peak of the window holding most turns, a tie going to the larger peak so
 * the answer does not hang on the order rows were stored in. #627 measured with
 * the first file read instead, which a store has no order for.
 */
function peakOf(windows: Map<string, WindowShare>): number {
  let best: WindowShare | undefined;
  for (const share of windows.values()) {
    if (
      !best ||
      share.turns > best.turns ||
      (share.turns === best.turns && share.peak > best.peak)
    ) {
      best = share;
    }
  }
  return best?.peak ?? 0;
}

/**
 * Collapse branches onto the issue each one names. An issue occasionally gets
 * a second branch (a follow-up fix); both count toward the same issue, and so
 * do a window's turns on both. A branch naming no issue is not attributable
 * and is dropped.
 */
function spendByIssue(
  byBranch: Map<string, BranchAccumulator>,
  issueOf: (branch: string) => number | null,
): Map<number, Spend> {
  const byIssue = new Map<number, IssueAccumulator>();
  for (const [branch, s] of byBranch) {
    const number = issueOf(branch);
    if (number === null) continue;
    const acc = byIssue.get(number) ?? {
      turns: 0,
      out: 0,
      cacheRead: 0,
      sessions: 0,
      windows: new Map<string, WindowShare>(),
      unknownWindow: false,
    };
    acc.turns += s.turns;
    acc.out += s.out;
    acc.cacheRead += s.cacheRead;
    acc.sessions += s.sessions.size;
    for (const [window, share] of s.windows) {
      addToWindow(acc.windows, window, share);
    }
    acc.unknownWindow ||= s.unknownWindow;
    byIssue.set(number, acc);
  }
  return new Map(
    [...byIssue].map(([number, { windows, unknownWindow, ...spend }]) => [
      number,
      { ...spend, peakContext: unknownWindow ? null : peakOf(windows) },
    ]),
  );
}

/** Read every transcript in `dir` and attribute its spend to issues: what is on
 *  disk now, with no history behind it. */
export function scanSpend(dir: string): ScanResult {
  const { responses, transcripts } = readTranscripts(dir);
  return { ...tallySpend(responses), transcripts };
}
