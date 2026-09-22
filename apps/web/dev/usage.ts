// The branch-to-issue join behind `bun run tokens` and the dev-tools Usage page.
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
// This module is the single copy of the join. `scripts/issue-tokens.ts` prints
// it at the terminal; the dev-tools Vite plugin serves `gatherUsage` to the
// Usage page under `/__dev` (#248), which is why it lives here rather than
// under `scripts/`. Both callers take the *same rows*, forecast band and
// verdict included, rather than each scoring the scan themselves — that is
// what makes "the page and `bun run tokens` cannot disagree" a property of one
// function instead of a promise two of them keep.
//
// What it still leaves to its callers is presentation and process: no column
// widths, no colours, no `process.exit`. The one thing it reaches out of the
// filesystem for is the issue listing, and that is an optional parameter
// (see `gatherUsage`) rather than a call buried in the scan.

import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
// The same file the Vite plugin and the pages under `/__dev` import, and the
// reason the report this builds cannot drift from what the page reads. The
// bands and the verdict words come from it too: they are vocabulary both ends
// spend, not an implementation detail of the scan.
import {
  BUCKETS,
  VERDICT,
  bucketFor,
  forecastAccuracy,
  percentiles,
  recordedSpend,
  type Bucket,
  type IssueSpend,
  type IssueUsage,
  type UnattributedWork,
  type UsageReport,
  type Verdict,
} from "../src/dev/usage-protocol.ts";
// The order the rows go on the wire in, imported rather than restated (#286).
// `joinIssues` below is where that is argued, including why this is the
// browser's module and not a third one both halves read.
import { DEFAULT_USAGE_SORT, sortIssues } from "../src/dev/usage-sort.ts";
import {
  ISSUE_STATE,
  fetchIssueMetadata,
  type IssueMetadata,
} from "./issues.ts";

// Re-exported because `scripts/issue-tokens.ts` prints a band's label, counts
// how many rows came in on target and prints the quartiles, and reaching into
// the browser half's contract module from a script under `scripts/` would be a
// worse seam than this line. The words especially: the CLI comparing against a
// literal `"on target"` is how a rename in `usage-protocol.ts` would leave its
// accuracy figure reading 0/N with nothing failing.
//
// `bucketFor`, `percentiles`, `forecastAccuracy` and `recordedSpend` moved
// *into* that file in #252 and are re-sent from here unchanged. They went
// because the page's charts need them and cannot import this module — it reads
// the filesystem — and they are re-exported because this module is the join's
// public face: the CLI and this file's own tests name them here, and a move is
// not a reason to make every caller learn where the arithmetic sleeps.
//
// The last two are the ones that were genuinely duplicated. `issue-tokens.ts`
// tallied its own `hits`/`scored` and wrote its own "rows with spend" flatMap,
// beside a page that did both again — two readings of the same rows, agreeing
// until one of them changed.
export {
  BUCKETS,
  VERDICT,
  bucketFor,
  forecastAccuracy,
  percentiles,
  recordedSpend,
  type Bucket,
  type IssueSpend,
  type UnattributedWork,
  type Verdict,
};

/**
 * Environment variable that overrides where transcripts are read from.
 *
 * The seam exists so a test can point at a fixture directory: the real location
 * is derived from the working directory and the home directory, and a machine's
 * actual spend is not something an assertion can be written against.
 */
export const TRANSCRIPT_DIR_ENV = "CLAUDE_TRANSCRIPT_DIR";

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

/**
 * A reading that found nothing, for the two callers that need one before they
 * know whether the directory can be read at all.
 *
 * A function rather than a shared constant because `unattributed` is an object:
 * a single frozen-by-convention literal is one `scan.unattributed.turns++` away
 * from being poisoned for every later caller in the process. And it is here
 * rather than written out twice so that a figure added to `ScanResult` has to be
 * given a value in one place instead of arriving as an `undefined` that
 * `bun run tokens` would print in the middle of a sentence.
 */
export const emptyScan = (): ScanResult => ({
  byIssue: new Map(),
  unattributed: { turns: 0, out: 0 },
  transcripts: 0,
});

/** Read every transcript in `dir` and attribute its spend to issues. */
export function scanSpend(dir: string): ScanResult {
  const { byBranch, unattributed, transcripts } = spendByBranch(dir);
  return { byIssue: spendByIssue(byBranch), unattributed, transcripts };
}

/**
 * The rows themselves: every issue worth looking at, joined to what GitHub
 * knows.
 *
 * Exported, and the reason is the whole of R8. `gatherUsage` below is the Vite
 * plugin's entry point and reads the transcripts itself; `bun run tokens`
 * cannot use it, because it also prints a figure the wire does not carry
 * (turns that ran on `main`) and a second sweep to recover that costs seconds,
 * not milliseconds — 2-3s warm and 28s cold over the 136 transcripts on the
 * machine this was measured on. So the *scan* is the CLI's and the *join* is
 * this, shared — rather than the CLI assembling rows of its own that agree
 * with these by inspection.
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
export function joinIssues(
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
 * property of one module rather than of two callers agreeing to be careful. The
 * plugin's job is reduced to resolving the directory and serialising this; the
 * CLI shares the half that matters through `joinIssues` above.
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
 * **Nothing here throws.** A missing directory is the ordinary state of a
 * machine that has never run Claude Code in this project, and of CI; a 500 from
 * the middleware would read as the page being broken rather than as the honest
 * "there is nothing here". A `gh` that cannot answer is smaller still: it costs
 * three columns, not the page. Both are reported as warnings beside whatever
 * could be read, the way the project map surfaces what its scan could not
 * parse.
 */
export async function gatherUsage(
  dir: string,
  metadata?: IssueMetadata,
): Promise<UsageReport> {
  // Before the listing, not after: `scanMs` answers "how long did pressing
  // Scan take", and `gh` is ~2s of that against 2-5s of filesystem.
  const startedAt = Date.now();
  const listing = metadata ?? (await fetchIssueMetadata());
  const warnings: string[] = [];

  let scan = emptyScan();
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
  // Second, and separately: the transcripts can be perfectly readable while the
  // issue listing is not. The page shows every warning it is given, so the two
  // failures stack rather than masking one another.
  if (listing.warning) warnings.push(listing.warning);

  return {
    gatheredAt: new Date().toISOString(),
    scanMs: Date.now() - startedAt,
    transcriptDir: dir,
    transcripts: scan.transcripts,
    issues: joinIssues(scan.byIssue, listing),
    // Beside the rows, never among them (#253): it has no issue number, nothing
    // forecast it, and there is no band for it to land in — which is also why
    // the page draws it as a total rather than a row.
    unattributed: scan.unattributed,
    warnings,
  };
}
