// The one incremental reader of this machine's Claude Code transcripts (#748):
// which files there are, where a read resumes, how bytes become numbered lines,
// what makes two records one API response, and how a response's copies fold.
//
// Two readers used to restate these rules, the Usage scan here and the Sessions
// reader (`./sessions.ts`), and their resume rules had drifted: the scan hashed
// a file's first kilobyte, the Sessions reader checked the 64 bytes its cursor
// sits behind and the file's modification time. This module keeps the second,
// which tells a replaced transcript from a grown one sooner, since a
// transcript's first records are much alike from one session to the next. The
// Usage scan reads through `readTranscripts`; the Sessions reader still keeps
// its own copy of the resume rule until it moves onto `readAppended`.
//
// It knows the filesystem and the record format, and nothing about issues,
// branches or forecasts: attributing and counting responses is `tallySpend` in
// `./transcripts.ts`.

import {
  closeSync,
  openSync,
  readSync,
  readdirSync,
  statSync,
  type Dirent,
} from "node:fs";
import { join } from "node:path";

/** A record's token counts. The first two are read only into a response's
 *  context (#642). */
export interface TranscriptUsage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
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
    usage?: TranscriptUsage;
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
   * What makes two records the same response, so it is stored and counted once
   * (`identityOf`). Prefixed by which of its three sources it is, so the three
   * namespaces cannot collide.
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
  /**
   * How full the window was at this response (#642): its input, cache-creation,
   * cache-read and output tokens added together (`contextOf`). Null on a row
   * the history stored before #642, which reads as unknown, never as zero.
   */
  context: number | null;
  /**
   * The transcript file the response was read from, as `listTranscripts` names
   * it: the window it ran in (#642). A session's subagents share its
   * `sessionId`, so the session cannot say which window. Null on a row the
   * history stored before #642.
   */
  window: string | null;
}

/** The counts a response is folded on. */
type Counts = Pick<TranscriptResponse, "out" | "cacheRead" | "context">;

/** What one response's usage says its window held: the four counts added
 *  together (#642, ADR-0023). */
const contextOf = (usage: TranscriptUsage) =>
  (usage.input_tokens ?? 0) +
  (usage.cache_creation_input_tokens ?? 0) +
  (usage.cache_read_input_tokens ?? 0) +
  (usage.output_tokens ?? 0);

/** The counts one record carries for its response, as every reader that
 *  collapses a response folds them — `readTranscripts` here and the Sessions
 *  reader (`./sessions.ts`). */
export const countsOf = (usage: TranscriptUsage): Counts => ({
  out: usage.output_tokens ?? 0,
  cacheRead: usage.cache_read_input_tokens ?? 0,
  context: contextOf(usage),
});

/**
 * Two copies of one response's counts folded into one: the larger of each,
 * since a subagent transcript writes a partial count on a response's first
 * record and the final one on its last (#431). An unknown context gives way to
 * a known one (#642). The one rule every reader that collapses a response
 * uses — `readTranscripts` here, and the Sessions reader (`./sessions.ts`,
 * `./session-groups.ts`), whose totals must equal these (R7).
 */
export const largerCounts = (a: Counts, b: Counts) => ({
  out: Math.max(a.out, b.out),
  cacheRead: Math.max(a.cacheRead, b.cacheRead),
  context:
    a.context === null
      ? b.context
      : b.context === null
        ? a.context
        : Math.max(a.context, b.context),
});

/** Whether `next` holds a count larger than `before`'s, so folding it in
 *  changes the response. */
export const raisesCounts = (before: Counts, next: Counts) =>
  next.out > before.out ||
  next.cacheRead > before.cacheRead ||
  (next.context ?? 0) > (before.context ?? 0);

/**
 * The key a record's response is counted once under (`TranscriptResponse.id`):
 * its `message.id`, which every record of one response carries (#413), then
 * its `uuid`, then `file` (as `listTranscripts` names it) and its one-based
 * `line`. Exported for the Sessions reader (`./sessions.ts`, #593), which
 * credits each response to the card whose file holds it and must count the
 * same responses this does (R7).
 */
export const identityOf = (
  rec: Pick<TranscriptRecord, "uuid" | "message">,
  file: string,
  line: number,
) =>
  rec.message?.id
    ? `message:${rec.message.id}`
    : rec.uuid
      ? `uuid:${rec.uuid}`
      : `line:${file}:${line}`;

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
export function listTranscripts(dir: string): string[] {
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

/**
 * How many bytes before a cursor a resumed read checks are still there. A file
 * that no longer holds them at that offset was replaced rather than grown, and
 * is read from the top.
 */
export const ANCHOR_BYTES = 64;

/**
 * How far one transcript has been read (#418), so the next read can start
 * there rather than at the top of a file that only ever grows.
 *
 * `offset` is the byte just past the last newline read: a trailing line with no
 * newline yet is left in front of it, so a line Claude Code was still writing is
 * read whole on a later read rather than skipped for good. `lines` counts the
 * lines before `offset`, so a record keyed on its line number (`identityOf`)
 * keeps that number when reading resumes. `size` and `mtimeMs` are the file's
 * when it was read: both unchanged, the file is not opened. `anchor` is the
 * `ANCHOR_BYTES` (or fewer) ending at `offset`, in hex so the usage history
 * can store it as text.
 */
export interface TranscriptCursor {
  offset: number;
  size: number;
  mtimeMs: number;
  lines: number;
  anchor: string;
}

/** Cursors keyed on each transcript's full path. */
export type TranscriptCursors = Map<string, TranscriptCursor>;

/** One complete line of a transcript, with its one-based number in the file. */
export interface TranscriptLine {
  text: string;
  number: number;
}

/** What `readAppended` read of one transcript. */
export interface AppendedLines {
  /** Whether the read began at the top of the file: there was no cursor, or
   *  the file no longer holds the cursor's anchor. A reader that keeps
   *  anything per file starts it again. */
  fromTop: boolean;
  /** The complete lines read, numbered from the top of the file however far
   *  in this read began. */
  lines: TranscriptLine[];
  /** The unterminated last line, or `""`: its number is `cursor.lines + 1`,
   *  and it is read again next time, since the cursor stays in front of it. */
  trailing: string;
  /** Where the file now stands, for the next read to start from. */
  cursor: TranscriptCursor;
}

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

const NEWLINE = 0x0a;

/**
 * The lines appended to the transcript at `path` since `cursor`, or null when
 * its size and modification time are both the cursor's and nothing was read.
 *
 * A file that has grown, or been touched, is read from `cursor.offset` when the
 * `ANCHOR_BYTES` before that offset are still the cursor's anchor, and from the
 * top otherwise: shorter than the offset, or different bytes there, it is a
 * different file under the same name. A rewrite that keeps those bytes and the
 * length up to them resumes at an offset that may fall mid-line, a limit
 * accepted because Claude Code only ever appends.
 */
export function readAppended(
  path: string,
  cursor?: TranscriptCursor,
): AppendedLines | null {
  const st = statSync(path);
  if (cursor && cursor.size === st.size && cursor.mtimeMs === st.mtimeMs) {
    return null;
  }
  const fd = openSync(path, "r");
  try {
    let base = 0;
    let skip = 0;
    let firstLine = 0;
    let bytes: Buffer | null = null;
    if (cursor && st.size >= cursor.offset) {
      const anchor = Buffer.from(cursor.anchor, "hex");
      const from = cursor.offset - anchor.length;
      const read = readRange(fd, from, st.size - from);
      if (read.subarray(0, anchor.length).equals(anchor)) {
        bytes = read;
        base = from;
        skip = anchor.length;
        firstLine = cursor.lines;
      }
    }
    const fromTop = bytes === null;
    bytes ??= readRange(fd, 0, st.size);

    const body = bytes.subarray(skip);
    // Split on the byte, not on decoded text: `\n` never occurs inside a
    // UTF-8 sequence, so this is a character boundary as well as a line one.
    const complete = body.lastIndexOf(NEWLINE) + 1;
    const pieces = body.subarray(0, complete).toString("utf8").split("\n");
    // Every piece but the last ended in a newline; the last is empty.
    pieces.pop();
    const end = skip + complete;
    return {
      fromTop,
      lines: pieces.map((text, i) => ({ text, number: firstLine + i + 1 })),
      trailing: body.subarray(complete).toString("utf8"),
      cursor: {
        offset: base + end,
        size: base + bytes.length,
        mtimeMs: st.mtimeMs,
        lines: firstLine + pieces.length,
        anchor: bytes
          .subarray(Math.max(0, end - ANCHOR_BYTES), end)
          .toString("hex"),
      },
    };
  } finally {
    closeSync(fd);
  }
}

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
 * Every API response in `dir`, each once — its top-level transcripts and its
 * sessions' subagent transcripts alike (`listTranscripts`, #431), since a
 * subagent's records carry the branch it ran on just as its parent's do and a
 * response id found in both is still one response. The files are append-only
 * JSONL and a partially-written last line is normal, so an unparseable line is
 * skipped rather than fatal.
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
 * **With `cursors`, only what was written since** (#418, `readAppended`).
 * Whatever a read from the top re-reads, the history's identity key has
 * already stored and absorbs — for a record keyed on its id or uuid; one keyed
 * on its file and line collides with whatever the replaced file held on that
 * line and is stored only once.
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
    const prior = cursors?.get(path);
    const read = readAppended(path, prior);
    if (!read) {
      next.set(path, prior!);
      continue;
    }
    const take = (text: string, number: number) => {
      if (!text.trim()) return;
      let rec: TranscriptRecord;
      try {
        rec = JSON.parse(text) as TranscriptRecord;
      } catch {
        return;
      }
      const usage = rec?.message?.usage;
      if (!usage) return;
      const id = identityOf(rec, file, number);
      const counts = countsOf(usage);
      const kept = seen.get(id);
      if (kept) {
        // A later block of a response already kept: only its counts can say
        // more, and in a subagent transcript the first block's are partial.
        Object.assign(kept, largerCounts(kept, counts));
        return;
      }
      const response: TranscriptResponse = {
        id,
        session: rec.sessionId ?? null,
        branch: rec.gitBranch ?? null,
        at: rec.timestamp ?? null,
        ...counts,
        window: file,
      };
      seen.set(id, response);
      responses.push(response);
    };
    for (const line of read.lines) take(line.text, line.number);
    take(read.trailing, read.cursor.lines + 1);
    next.set(path, read.cursor);
  }
  return { responses, transcripts: files.length, cursors: next };
}
