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
// **And one trend point per local calendar day** (#419): that day's quartiles
// and accuracy tally, with the band edges in force. The one answer kept, because
// a day that has passed cannot be asked again — the labels `gh` reported and the
// bands the code held are gone by the next one. It stores spend and a tally,
// never a row's verdict. ADR-0023's #419 section draws that line.
//
// **And the issue listing the last scan read** (#432): `gh`'s answer, or why
// there was none. An input like the rows, not an answer — it is what lets the
// page open on a reading computed from the store alone, with no `gh` call,
// that names the same titles and bands the last scan did.
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

import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { REPO_ROOT, childEnv } from "./child-env.ts";
import {
  projectSlug,
  type TranscriptCursor,
  type TranscriptCursors,
  type TranscriptResponse,
} from "./transcripts.ts";
import type { TrendPoint } from "../src/dev/usage-protocol.ts";

const execFileAsync = promisify(execFile);

/**
 * Environment variable that overrides where the history file lives — the third
 * seam beside `CLAUDE_TRANSCRIPT_DIR` and `GH_ISSUES_FILE`.
 *
 * The E2E points it at a gitignored path it can delete, and every unit test at
 * a temporary one: without it, a test scanning fixture transcripts would write
 * fixture spend into the developer's real history.
 */
export const HISTORY_FILE_ENV = "USAGE_HISTORY_FILE";

/** A ceiling on a `git rev-parse` that normally answers in milliseconds, so a
 *  hung one cannot hold a scan up. Not a measured figure. */
const GIT_TIMEOUT_MS = 5_000;

/**
 * The environment a `git` asked about `cwd` runs in: `childEnv`'s, because
 * anything spawned from the dev server sanitises first, minus `GIT_DIR` and its
 * siblings — inherited from a git hook they would make git answer for the
 * hook's repository rather than for `cwd`'s. Exported so the tests' own `git`
 * calls build their throwaway clone under the same rule.
 */
export function gitEnv(): NodeJS.ProcessEnv {
  const env = childEnv(REPO_ROOT);
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR"]) {
    delete env[key];
  }
  return env;
}

/**
 * The main worktree's root for whatever checkout `cwd` is in: the parent of
 * `git rev-parse --git-common-dir`, which every linked worktree of a clone
 * shares. `null` when git cannot answer — not installed, older than 2.31 (no
 * `--path-format`), or `cwd` is outside any checkout or does not exist.
 *
 * Asynchronous because a spawn under `dev/` is (frontend.md).
 */
async function mainWorktreeRoot(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd, env: gitEnv(), encoding: "utf8", timeout: GIT_TIMEOUT_MS },
    );
    const commonDir = stdout.trim();
    return commonDir ? dirname(commonDir) : null;
  } catch {
    return null;
  }
}

/**
 * Where the history file lives, as one resolvable decision — the same shape as
 * `resolveTranscriptDir`, with one difference in the key.
 *
 * `~/.claude-usage-history/<slug>.sqlite`: outside the repository, so no
 * commit, CI artefact or build can contain it (R4), and outside `~/.claude`,
 * so Claude Code's own cleanup — the thing this history outlives — never
 * reaches it.
 *
 * **The slug is the main worktree's root, not `cwd`'s** (#423). Every worktree
 * of a clone shares one history, so spend scanned in one shows from all of
 * them, and a deleted worktree does not take the only reader of its spend with
 * it. The transcripts stay keyed on `cwd`, because that is where Claude Code
 * writes them. From the main worktree the two slugs are the same string, so its
 * file kept its name. Outside a checkout, or when git cannot answer, it falls
 * back to `cwd`'s slug rather than throwing. Separate clones still have one
 * history each.
 *
 * A file keyed on a linked worktree before #423 is not merged in: the history
 * shipped (#417) the same day, and no such file existed on the one machine that
 * had scanned with it, so a merge would be code with nothing to read.
 */
export async function resolveHistoryFile(
  env: Record<string, string | undefined> = process.env,
  {
    cwd = process.cwd(),
    home = homedir(),
  }: { cwd?: string; home?: string } = {},
): Promise<string> {
  const override = env[HISTORY_FILE_ENV]?.trim();
  if (override) return override;
  const root = (await mainWorktreeRoot(cwd)) ?? cwd;
  return join(home, ".claude-usage-history", `${projectSlug(root)}.sqlite`);
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

/**
 * The issue listing as the last scan read it (#432): `gh`'s JSON in the shape
 * `toGhListing` in `./issues.ts` writes, or null with the warning that said why
 * it could not be read. Kept raw, so the store knows nothing of the format.
 */
export interface StoredListing {
  issues: string | null;
  warning: string | null;
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
  /** How many responses are stored — what a push (#428) compares either side
   *  of `record` to say how many it added. */
  count(): number;
  /** The earliest timestamp stored, or null when nothing carrying one is. */
  since(): string | null;
  /** Write a day's trend point (#419), replacing any point already stored for
   *  that day — the last scan of a day is the one the trend keeps. */
  recordPoint(point: TrendPoint): void;
  /** Every stored trend point, oldest day first. */
  trend(): TrendPoint[];
  /** Keep the listing this scan read, replacing the last one (#432). */
  recordListing(listing: StoredListing): void;
  /** The listing the last scan kept, or null when none has — a history
   *  written before #432, until its next scan. */
  listing(): StoredListing | null;
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
  // #419: one row per local calendar day, keyed on it so a later scan that day
  // replaces the point. The band edges are columns of their own rather than
  // read from `BUCKETS` on the way out: they are what was in force that day.
  `CREATE TABLE IF NOT EXISTS trend_point (
    day TEXT PRIMARY KEY,
    at TEXT NOT NULL,
    measured INTEGER NOT NULL,
    p25 INTEGER NOT NULL,
    median INTEGER NOT NULL,
    p75 INTEGER NOT NULL,
    scored INTEGER NOT NULL,
    on_target INTEGER NOT NULL,
    edge_s INTEGER NOT NULL,
    edge_m INTEGER NOT NULL,
    edge_l INTEGER NOT NULL
  )`,
  // #432: one row, the last scan's listing. `id = 1` so a scan replaces it.
  `CREATE TABLE IF NOT EXISTS listing (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    issues TEXT,
    warning TEXT
  )`,
];

/** A `trend_point` row as SQLite hands it back. */
interface TrendRow {
  day: string;
  at: string;
  measured: number;
  p25: number;
  median: number;
  p75: number;
  scored: number;
  on_target: number;
  edge_s: number;
  edge_m: number;
  edge_l: number;
}

/**
 * The store over an open database. Creates its tables on first use, so a fresh
 * file and a missing one are the same starting point.
 *
 * Exported for the unit tests, which hand it `node:sqlite` directly; the real
 * callers reach it through `openUsageStore`.
 *
 * `readOnly` skips the schema (#432): the stored reading opens the file read
 * only, so it cannot create a table, and a history missing one answers as
 * though that table were empty.
 */
export function usageStoreOver(
  db: SqlDatabase,
  { readOnly = false }: { readOnly?: boolean } = {},
): UsageStore {
  // The dev server and `bun run tokens` can scan at the same moment. Without a
  // timeout the second fails at once with "database is locked", which reads as
  // a damaged history (#420); five seconds outlasts any scan's writes.
  db.exec("PRAGMA busy_timeout = 5000");
  if (!readOnly) for (const statement of SCHEMA) db.exec(statement);
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
    count() {
      const row = db.prepare("SELECT COUNT(*) AS n FROM response").get() as
        { n: number } | null | undefined;
      return Number(row?.n ?? 0);
    },
    since() {
      const row = db.prepare("SELECT MIN(at) AS since FROM response").get() as
        { since: string | null } | null | undefined;
      return row?.since ?? null;
    },
    recordPoint(p) {
      db.prepare(
        `INSERT OR REPLACE INTO trend_point
           (day, at, measured, p25, median, p75, scored, on_target,
            edge_s, edge_m, edge_l)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        p.day,
        p.at,
        p.measured,
        p.p25,
        p.median,
        p.p75,
        p.scored,
        p.onTarget,
        p.edges.S,
        p.edges.M,
        p.edges.L,
      );
    },
    trend() {
      const rows = db
        .prepare(
          `SELECT day, at, measured, p25, median, p75, scored, on_target,
                  edge_s, edge_m, edge_l
           FROM trend_point ORDER BY day`,
        )
        .all() as TrendRow[];
      return rows.map((r) => ({
        day: r.day,
        at: r.at,
        measured: r.measured,
        p25: r.p25,
        median: r.median,
        p75: r.p75,
        scored: r.scored,
        onTarget: r.on_target,
        edges: { S: r.edge_s, M: r.edge_m, L: r.edge_l },
      }));
    },
    recordListing({ issues, warning }) {
      db.prepare(
        "INSERT OR REPLACE INTO listing (id, issues, warning) VALUES (1, ?, ?)",
      ).run(issues, warning);
    },
    listing() {
      // Asked first because a read-only open created no table: a history no
      // scan has touched since #432 has none, which is "nothing kept".
      const table = db
        .prepare(
          "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'listing'",
        )
        .get();
      if (!table) return null;
      const row = db
        .prepare("SELECT issues, warning FROM listing WHERE id = 1")
        .get() as StoredListing | null | undefined;
      return row ? { issues: row.issues, warning: row.warning } : null;
    },
    close: () => db.close(),
  };
}

// Variables rather than literals, so neither runtime's resolver sees the module
// it cannot load. See the header.
const BUN_SQLITE = "bun:sqlite";
const NODE_SQLITE = "node:sqlite";

/** The SQLite module of whichever runtime this process is. */
async function openSqlite(
  file: string,
  readOnly: boolean,
): Promise<SqlDatabase> {
  if (process.versions.bun) {
    const { Database } = (await import(
      /* @vite-ignore */ BUN_SQLITE
    )) as typeof import("bun:sqlite");
    // Options only when read only: measured on Bun 1.3.13, `{ readonly: false }`
    // throws SQLITE_MISUSE, since an options object drops the default
    // read-write-create flags.
    const db = readOnly
      ? new Database(file, { readonly: true })
      : new Database(file);
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
  return new DatabaseSync(file, { readOnly });
}

/**
 * Open the history at `file`, creating it and its directory when they do not
 * exist. The caller closes it before answering.
 *
 * A file that cannot be opened throws, and `gatherUsage` turns that into a
 * warning (#420). Opening a damaged file succeeds and the first statement fails
 * ("file is not a database"), so the handle is closed before rethrowing: left
 * to the garbage collector it keeps the file locked on Windows, and the
 * developer could not delete the very file the warning tells them to delete.
 * Nothing is written to it on the way — the schema's first `CREATE` fails
 * before any write — so a damaged history is never overwritten.
 *
 * `readOnly` is the stored reading's (#432): SQLite opens the file read only,
 * so any write throws rather than landing, nothing is created, and a missing
 * file throws too — the caller checks for one first.
 */
export async function openUsageStore(
  file: string,
  { readOnly = false }: { readOnly?: boolean } = {},
): Promise<UsageStore> {
  if (!readOnly) mkdirSync(dirname(file), { recursive: true });
  const db = await openSqlite(file, readOnly);
  try {
    return usageStoreOver(db, { readOnly });
  } catch (err) {
    db.close();
    throw err;
  }
}
