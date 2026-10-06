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
// Every turn count, per-turn rate and share of turns above was measured before
// #413, when a "turn" was a transcript record rather than an API response and a
// response's usage was counted once per record, so they want re-measuring on
// the corrected figures — a separate decision from the fix itself.
//
// Out of `./usage.ts` since #297, which had grown to hold both the scan and the
// join. The split is the one `./issues.ts` already drew for the other source:
// this module knows the filesystem and the transcript format and nothing about
// forecasts, verdicts or the wire's row; `./usage.ts` knows those.
//
// Since #417 it is two halves rather than one sweep: `readTranscripts` turns the
// files into one `TranscriptResponse` per API response, and `tallySpend`
// attributes and counts any set of them. `./usage.ts` stores the first in the
// usage history (`./usage-store.ts`) and runs the second over everything
// stored, so spend survives a deleted transcript; `scanSpend` is the two run
// back to back over what is on disk, with no history.

import { createHash } from "node:crypto";
import {
  closeSync,
  openSync,
  readSync,
  readdirSync,
  statSync,
  type Dirent,
} from "node:fs";
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
  uuid?: string;
  timestamp?: string;
  message?: {
    id?: string;
    usage?: { output_tokens?: number; cache_read_input_tokens?: number };
  };
}

/**
 * One API response, as read off a transcript: the unit the scan counts, and
 * since #417 the unit the usage history stores (`./usage-store.ts`).
 *
 * **Raw facts, not conclusions.** It holds the branch rather than the issue the
 * branch names, and its own tokens rather than a share of anybody's total, so
 * attributing and counting stay code that runs over these on every read
 * (`tallySpend`). That is what lets a correction like #413's or #253's reach a
 * response whose transcript Claude Code has since deleted (R11): the stored row
 * is re-read under the new rule rather than frozen under the old one.
 */
export interface TranscriptResponse {
  /**
   * What makes two records the same response, so it is stored and counted once.
   * The response's `message.id` when it has one — every record of one response
   * carries it (#413) — then the record's own `uuid`, then the file name and
   * line number. Prefixed by which of the three it is, so the three namespaces
   * cannot collide.
   *
   * The E2E fixtures carry neither an id nor a uuid, which is why the third
   * exists: without it, a record with no id would have no identity at all and
   * could not be told from itself on the next scan.
   */
  id: string;
  /** `sessionId`, or null when the record carries none. */
  session: string | null;
  /** `gitBranch`, or null when the record carries none. */
  branch: string | null;
  /** The record's ISO 8601 `timestamp`, or null when it carries none. */
  at: string | null;
  /** `output_tokens`. */
  out: number;
  /** `cache_read_input_tokens`. */
  cacheRead: number;
}

/**
 * How far one transcript has been read (#418), so the next scan can start
 * there rather than at the top of a file that only ever grows.
 *
 * `offset` is the byte just past the last newline read: a trailing line with no
 * newline yet is left in front of it, so a line Claude Code was still writing is
 * read whole on a later scan rather than skipped for good. `lines` counts the
 * lines before `offset`, so a record keyed on its line number (`identityOf`)
 * keeps that number when reading resumes. `size` is the file's length when it
 * was read, and `head` a hash of its first bytes up to `offset` — between them
 * they say whether the file is the same one grown, or a different one.
 */
export interface TranscriptCursor {
  offset: number;
  size: number;
  lines: number;
  head: string;
}

/** Cursors keyed on each transcript's full path. */
export type TranscriptCursors = Map<string, TranscriptCursor>;

/** What one read of a transcript directory found. */
export interface TranscriptRead {
  /** Every response, each once — see `readTranscripts`. */
  responses: TranscriptResponse[];
  /** `.jsonl` files in the directory and its sessions' `subagents/` (#431),
   *  whether or not anything new was read from them. Zero is the honest answer
   *  for a machine that has never run Claude Code in this project. */
  transcripts: number;
  /** Where every one of those files now stands, for the next read to start
   *  from. */
  cursors: TranscriptCursors;
}

/**
 * How many leading bytes `head` hashes. Enough that two different sessions
 * cannot share it — the first record carries the session's id and a
 * timestamp — and few enough that checking it costs one small read per changed
 * file.
 */
const HEAD_BYTES = 1024;

/** `length` bytes of an open file from `position`, however many reads it takes. */
function readRange(fd: number, position: number, length: number): Buffer {
  const buf = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const n = readSync(fd, buf, done, length - done, position + done);
    if (n === 0) break;
    done += n;
  }
  return buf.subarray(0, done);
}

const headOf = (fd: number, offset: number) =>
  createHash("sha1")
    .update(readRange(fd, 0, Math.min(offset, HEAD_BYTES)))
    .digest("hex");

/** Where Claude Code puts a session's subagent transcripts, under the
 *  session's own directory (#431). */
const SUBAGENTS_DIR = "subagents";

/**
 * Every transcript under `dir`, as a path relative to it written with `/`: the
 * top-level `<session>.jsonl` files, and each session's
 * `<session>/subagents/*.jsonl` (#431). Nothing else — not a subagent's
 * `.meta.json`, and no other directory a session keeps (`tool-results/`), nor
 * anything nested below `subagents/`.
 *
 * Relative rather than bare because a record with no id is keyed on this name
 * (`identityOf`), and a subagent file may share its base name with another
 * session's; the top-level names are unchanged, so rows a history stored
 * before #431 keep their keys.
 */
function listTranscripts(dir: string): string[] {
  const isTranscript = (d: Dirent) => d.isFile() && d.name.endsWith(".jsonl");
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (isTranscript(entry)) {
      files.push(entry.name);
    } else if (entry.isDirectory()) {
      let inner: Dirent[];
      try {
        inner = readdirSync(join(dir, entry.name, SUBAGENTS_DIR), {
          withFileTypes: true,
        });
      } catch {
        // Most sessions ran no subagent and have no such directory.
        continue;
      }
      for (const sub of inner) {
        if (isTranscript(sub)) {
          files.push(`${entry.name}/${SUBAGENTS_DIR}/${sub.name}`);
        }
      }
    }
  }
  return files;
}

const identityOf = (rec: TranscriptRecord, file: string, line: number) =>
  rec.message?.id
    ? `message:${rec.message.id}`
    : rec.uuid
      ? `uuid:${rec.uuid}`
      : `line:${file}:${line}`;

/**
 * Every API response in `dir`, each once — its top-level transcripts and its
 * sessions' subagent transcripts alike (`listTranscripts`, #431), since a
 * subagent's records carry the branch it ran on just as its parent's do and a
 * response id found in both is still one response. One pass over every
 * transcript; the files are append-only JSONL and a partially-written last line
 * is normal, so an unparseable line is skipped rather than fatal.
 *
 * **One API response is one turn, however many records it was written as**
 * (#413). Claude Code writes a response as one record per content block — the
 * text, each `tool_use` — and every one of them carries the response's
 * `message.id` and a copy of its `usage`. Measured 2026-10-03 over 167
 * transcripts: 27,311 records with usage were 14,181 responses, none of the
 * 8,894 multi-record responses differed between their records in
 * `output_tokens` (nor, re-measured the same day over 8,903 of them, in
 * `cache_read_input_tokens`), and summing every record inflated output 2.32x
 * overall and 1.00x-3.89x per issue. So a response is kept once, under its
 * first record's session, branch and timestamp, and the rest are folded into
 * it.
 *
 * **Folded, taking the largest counts, because subagent records disagree**
 * (#431). Those 167 transcripts were all top-level. In subagent transcripts,
 * measured 2026-10-07, 1,705 of 2,855 multi-record responses carried a partial
 * `output_tokens` on their first record and the final count on their last —
 * 177k against 1.41M summed over 3,645 responses — and the last was always the
 * largest. Top-level records still never differed, so taking the maximum
 * changes nothing there. A record with no `message.id` has nothing to
 * collapse on and is kept once per record, as all of them were before — a
 * format change that drops the id then over-counts rather than reading as zero
 * spend.
 *
 * **With `cursors`, only what was written since** (#418). Claude Code's
 * transcripts only grow, so a file is read from where the last scan stopped, and
 * one whose size has not changed is not opened at all. A file shorter than its
 * cursor, or whose first bytes no longer hash to the cursor's `head`, is a
 * different file under the same name and is read from the top; whatever that
 * re-reads, the history's identity key has already stored and absorbs. A file
 * replaced by another of exactly the same length is not noticed until it grows —
 * a cost of skipping by size, which is what makes an unchanged directory cheap.
 * Two more limits, both accepted because Claude Code only ever appends: `head`
 * covers the first `HEAD_BYTES`, so a rewrite that keeps them resumes at an
 * offset that may fall mid-line; and "absorbs the overlap" holds for a record
 * keyed on its id or uuid, while one keyed on its file and line collides with
 * whatever the replaced file held on that line and is stored only once.
 *
 * The unterminated tail after the last newline is parsed like any other line but
 * left in front of the cursor: half-written, it fails to parse and is read again
 * once finished; complete, it counts now and is absorbed by its identity when it
 * is read again. Either way it counts once.
 *
 * So the dedup above is per read: a response's second block, appended after a
 * scan stored its first, is new bytes here and is recognised by the store,
 * which raises the stored counts if this block's are larger.
 */
export function readTranscripts(
  dir: string,
  cursors?: ReadonlyMap<string, TranscriptCursor>,
): TranscriptRead {
  const responses: TranscriptResponse[] = [];
  const seen = new Map<string, TranscriptResponse>();
  const next: TranscriptCursors = new Map();
  const files = listTranscripts(dir);
  for (const file of files) {
    const path = join(dir, ...file.split("/"));
    const size = statSync(path).size;
    const prior = cursors?.get(path);
    if (prior && prior.size === size) {
      next.set(path, prior);
      continue;
    }
    const fd = openSync(path, "r");
    try {
      const resume =
        prior && size >= prior.offset && headOf(fd, prior.offset) === prior.head
          ? prior
          : undefined;
      const from = resume?.offset ?? 0;
      const firstLine = resume?.lines ?? 0;
      const bytes = readRange(fd, from, size - from);
      // Split on the byte, not on decoded text: `\n` never occurs inside a
      // UTF-8 sequence, so this is a character boundary as well as a line one.
      const complete = bytes.lastIndexOf(0x0a) + 1;
      const lines = bytes.toString("utf8").split("\n");
      lines.forEach((line, index) => {
        if (!line.trim()) return;
        let rec: TranscriptRecord;
        try {
          rec = JSON.parse(line) as TranscriptRecord;
        } catch {
          return;
        }
        const usage = rec.message?.usage;
        if (!usage) return;
        // One-based, as an editor numbers the line a developer would go and
        // read, and counted from the top of the file however far in this read
        // began.
        const id = identityOf(rec, file, firstLine + index + 1);
        const out = usage.output_tokens ?? 0;
        const cacheRead = usage.cache_read_input_tokens ?? 0;
        const kept = seen.get(id);
        if (kept) {
          // A later block of a response already kept: only its counts can say
          // more, and in a subagent transcript the first block's are partial.
          kept.out = Math.max(kept.out, out);
          kept.cacheRead = Math.max(kept.cacheRead, cacheRead);
          return;
        }
        const response: TranscriptResponse = {
          id,
          session: rec.sessionId ?? null,
          branch: rec.gitBranch ?? null,
          at: rec.timestamp ?? null,
          out,
          cacheRead,
        };
        seen.set(id, response);
        responses.push(response);
      });
      const offset = from + complete;
      next.set(path, {
        offset,
        size,
        // Every piece but the tail ended in a newline.
        lines: firstLine + lines.length - 1,
        head: headOf(fd, offset),
      });
    } finally {
      closeSync(fd);
    }
  }
  return { responses, transcripts: files.length, cursors: next };
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

/** A branch's running total. Distinct sessions are counted, so it holds a set. */
interface BranchAccumulator extends Omit<Spend, "sessions"> {
  sessions: Set<string>;
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
    };
    acc.turns++;
    acc.out += r.out;
    acc.cacheRead += r.cacheRead;
    acc.sessions.add(r.session ?? "");
    byBranch.set(r.branch, acc);
  }
  return { byIssue: spendByIssue(byBranch, issueOf), unattributed };
}

/**
 * Collapse branches onto the issue each one names. An issue occasionally gets
 * a second branch (a follow-up fix); both count toward the same issue. A
 * branch naming no issue is not attributable and is dropped.
 */
function spendByIssue(
  byBranch: Map<string, BranchAccumulator>,
  issueOf: (branch: string) => number | null,
): Map<number, Spend> {
  const byIssue = new Map<number, Spend>();
  for (const [branch, s] of byBranch) {
    const number = issueOf(branch);
    if (number === null) continue;
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

/** Read every transcript in `dir` and attribute its spend to issues: what is on
 *  disk now, with no history behind it. */
export function scanSpend(dir: string): ScanResult {
  const { responses, transcripts } = readTranscripts(dir);
  return { ...tallySpend(responses), transcripts };
}
