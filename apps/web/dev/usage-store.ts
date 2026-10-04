// The usage history: every API response a scan has ever read, kept in a local
// SQLite file so an issue keeps its spend after Claude Code deletes the
// transcript it was read from (#417, `docs/prd/usage-history.md`).
//
// **One row per response, never a per-issue total.** A row is a
// `TranscriptResponse` from `./transcripts.ts` — identity, session, branch,
// timestamp, output and cache-read tokens — and nothing derived from it.
// Attribution (branch → issue, `main` → unattributed) and counting stay in
// `tallySpend`, run over these rows on every read, so a correction to either
// reaches rows whose transcript is gone (R11). Stored totals would freeze the
// rule they were summed under.
//
// **Beside them, one cursor per transcript** (#418): how far each file has been
// read, so the next scan reads only what was appended. A cursor is bookkeeping
// about the files, not a figure, so the rule above still holds.
//
// **Opened per scan, closed before the response.** A handle held across
// requests would stop a spec, or a developer, from deleting or replacing the
// file on Windows; opening is milliseconds against even a warm scan's ~60ms, so
// there is nothing worth keeping a handle for.
//
// **The runtime split is measured, and the opener absorbs it** (plan,
// 2026-10-03): Bun 1.3.13 cannot resolve `node:sqlite`, and Node cannot load
// `bun:sqlite`. The developer's dev server (`bunx --bun vite`) and
// `bun run tokens` run on Bun; vitest and the E2E's dev server (`bunx vite`,
// see `playwright.config.ts` for why it drops `--bun`) run on Node. So the
// store speaks to `SqlDatabase`, a surface both modules satisfy, and
// `openUsageStore` loads whichever one the running process has. The two are
// imported through a variable so that neither Vite's config bundler nor Bun
// tries to resolve the one its runtime cannot load.
//
// ADR-0023 records why the Usage page keeps anything at all, reversing the rule
// that it cached nothing.

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  projectSlug,
  type TranscriptCursor,
  type TranscriptCursors,
  type TranscriptResponse,
} from "./transcripts.ts";

/**
 * Environment variable that overrides where the history file lives — the third
 * seam beside `CLAUDE_TRANSCRIPT_DIR` and `GH_ISSUES_FILE`.
 *
 * The E2E points it at a gitignored path it can delete, and every unit test at
 * a temporary one: without it, a test scanning fixture transcripts would write
 * fixture spend into the developer's real history.
 */
export const HISTORY_FILE_ENV = "USAGE_HISTORY_FILE";

/**
 * Where the history file lives, as one resolvable decision — the same shape as
 * `resolveTranscriptDir`, and keyed on the same project slug.
 *
 * `~/.claude-usage-history/<slug>.sqlite`: outside the repository, so no
 * commit, CI artefact or build can contain it (R4), and outside `~/.claude`,
 * so Claude Code's own cleanup — the thing this history outlives — never
 * reaches it.
 */
export function resolveHistoryFile(
  env: Record<string, string | undefined> = process.env,
  {
    cwd = process.cwd(),
    home = homedir(),
  }: { cwd?: string; home?: string } = {},
): string {
  const override = env[HISTORY_FILE_ENV]?.trim();
  if (override) return override;
  return join(home, ".claude-usage-history", `${projectSlug(cwd)}.sqlite`);
}

/** A value either SQLite module binds to a `?` placeholder. */
export type SqlValue = string | number | null;

/** A prepared statement, as both `bun:sqlite` and `node:sqlite` shape one. */
export interface SqlStatement {
  run(...params: SqlValue[]): unknown;
  /** No row is `null` in Bun and `undefined` in Node; the store reads it with
   *  `??`, so either is no row. */
  get(...params: SqlValue[]): unknown;
  all(...params: SqlValue[]): unknown[];
}

/**
 * The narrow surface the store needs, which `bun:sqlite`'s `Database` and
 * `node:sqlite`'s `DatabaseSync` both offer as they are.
 */
export interface SqlDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
  close(): void;
}

/** What a scan does with the history, between opening and closing it. */
export interface UsageStore {
  /** How far each transcript has been read, for `readTranscripts` to resume
   *  from (#418). Empty for a fresh file, which reads everything. */
  cursors(): TranscriptCursors;
  /**
   * Store every response not already stored, and where each transcript now
   * stands, in one transaction — so a cursor never moves past rows that were
   * not kept. A response already there — the same identity, read again on a
   * later scan — is left as it was; a cursor replaces the one before it.
   */
  record(
    responses: readonly TranscriptResponse[],
    cursors?: ReadonlyMap<string, TranscriptCursor>,
  ): void;
  /** Every stored response, whether or not its transcript is still on disk. */
  responses(): TranscriptResponse[];
  /** The earliest timestamp stored, or null when nothing carrying one is. */
  since(): string | null;
  close(): void;
}

/** One statement each: `exec` is only relied on for one at a time. A history
 *  written before #418 has no `transcript` table, gains it here, and reads
 *  every transcript once more — the identity key absorbs the overlap. */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS response (
    id TEXT PRIMARY KEY,
    session TEXT,
    branch TEXT,
    at TEXT,
    out INTEGER NOT NULL,
    cache_read INTEGER NOT NULL
  )`,
  // `read_to` rather than `offset`, which is an SQL keyword.
  `CREATE TABLE IF NOT EXISTS transcript (
    path TEXT PRIMARY KEY,
    read_to INTEGER NOT NULL,
    size INTEGER NOT NULL,
    lines INTEGER NOT NULL,
    head TEXT NOT NULL
  )`,
];

/**
 * The store over an open database. Creates its tables on first use, so a fresh
 * file and a missing one are the same starting point.
 *
 * Exported for the unit tests, which hand it `node:sqlite` directly; the real
 * callers reach it through `openUsageStore`.
 */
export function usageStoreOver(db: SqlDatabase): UsageStore {
  for (const statement of SCHEMA) db.exec(statement);
  return {
    cursors() {
      const rows = db
        .prepare("SELECT path, read_to, size, lines, head FROM transcript")
        .all() as ({ path: string; read_to: number } & Omit<
        TranscriptCursor,
        "offset"
      >)[];
      return new Map(
        rows.map(({ path, read_to, size, lines, head }) => [
          path,
          { offset: read_to, size, lines, head },
        ]),
      );
    },
    record(responses, cursors = new Map()) {
      const insert = db.prepare(
        `INSERT INTO response (id, session, branch, at, out, cache_read)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO NOTHING`,
      );
      const upsertCursor = db.prepare(
        `INSERT OR REPLACE INTO transcript (path, read_to, size, lines, head)
         VALUES (?, ?, ?, ?, ?)`,
      );
      // One transaction: a first scan of this machine's transcripts is ~14k
      // rows, and SQLite commits each statement on its own otherwise.
      db.exec("BEGIN");
      try {
        for (const r of responses) {
          insert.run(r.id, r.session, r.branch, r.at, r.out, r.cacheRead);
        }
        for (const [path, cursor] of cursors) {
          upsertCursor.run(
            path,
            cursor.offset,
            cursor.size,
            cursor.lines,
            cursor.head,
          );
        }
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
    responses() {
      return db
        .prepare(
          `SELECT id, session, branch, at, out, cache_read AS cacheRead
           FROM response ORDER BY id`,
        )
        .all()
        .map((row) => ({ ...(row as TranscriptResponse) }));
    },
    since() {
      const row = db.prepare("SELECT MIN(at) AS since FROM response").get() as
        { since: string | null } | null | undefined;
      return row?.since ?? null;
    },
    close: () => db.close(),
  };
}

// Variables rather than literals, so neither runtime's resolver sees the module
// it cannot load. See the header.
const BUN_SQLITE = "bun:sqlite";
const NODE_SQLITE = "node:sqlite";

/** The SQLite module of whichever runtime this process is. */
async function openSqlite(file: string): Promise<SqlDatabase> {
  if (process.versions.bun) {
    const { Database } = (await import(
      /* @vite-ignore */ BUN_SQLITE
    )) as typeof import("bun:sqlite");
    const db = new Database(file);
    // Bun's `close` defers while any prepared statement is unfinalized, and
    // the file stays locked on Windows until the garbage collector gets to
    // them: measured (#418) as EBUSY on deleting the file straight after a
    // scan, in a Bun process — which is the developer's dev server. So this
    // keeps what it prepared and finalizes it first. `node:sqlite`'s `close`
    // needs no help, which is why the E2E (on Node) never saw it.
    const prepared: ReturnType<typeof db.prepare>[] = [];
    return {
      exec: (sql) => db.exec(sql),
      prepare(sql) {
        const statement = db.prepare(sql);
        prepared.push(statement);
        return statement;
      },
      close() {
        for (const statement of prepared) statement.finalize();
        db.close();
      },
    };
  }
  const { DatabaseSync } = (await import(
    /* @vite-ignore */ NODE_SQLITE
  )) as typeof import("node:sqlite");
  return new DatabaseSync(file);
}

/**
 * Open the history at `file`, creating it and its directory when they do not
 * exist. The caller closes it before answering.
 *
 * A file that cannot be opened throws, for now: slice 4 of
 * `docs/plans/usage-history.md` turns that into a warning.
 */
export async function openUsageStore(file: string): Promise<UsageStore> {
  mkdirSync(dirname(file), { recursive: true });
  return usageStoreOver(await openSqlite(file));
}
