import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import {
  issueOfBranch,
  readTranscripts,
  resolveTranscriptDir,
  tallySpend,
  type TranscriptResponse,
} from "./transcripts.ts";
import {
  HISTORY_FILE_ENV,
  openUsageStore,
  resolveHistoryFile,
  usageStoreOver,
  type SqlDatabase,
} from "./usage-store.ts";
import type { TrendPoint } from "../src/dev/usage-protocol.ts";

/**
 * The usage history (#417), under vitest — which runs on Node, so the store is
 * handed `node:sqlite` here, where the dev server and `bun run tokens` open
 * `bun:sqlite`. The adapter between them is `SqlDatabase`; what these tests hold
 * is the store's behaviour over it.
 */

const response = (
  overrides: Partial<TranscriptResponse> = {},
): TranscriptResponse => ({
  id: "message:m1",
  session: "s",
  branch: "feat/7-a",
  at: "2026-09-02T09:00:00.000Z",
  out: 1000,
  cacheRead: 10,
  ...overrides,
});

/**
 * `node:sqlite`, imported the way `openUsageStore` imports it: through a
 * variable. A static import passed on a Windows dev machine (Node 24.11) and
 * failed on CI (run 37187612546), where Vite's import analysis refused it with
 * "Cannot bundle built-in module". `node:sqlite` exists only under the `node:`
 * prefix, and a specifier Vite never sees is one it cannot refuse.
 */
const NODE_SQLITE = "node:sqlite";
const { DatabaseSync } = (await import(
  /* @vite-ignore */ NODE_SQLITE
)) as typeof import("node:sqlite");

/** `node:sqlite`'s `DatabaseSync` is the surface as it is, with no adapter. */
const memoryStore = () =>
  usageStoreOver(new DatabaseSync(":memory:") satisfies SqlDatabase);

const execFileAsync = promisify(execFile);

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "usage-store-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("resolveHistoryFile", () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileAsync(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@t", ...args],
      { cwd },
    );

  /** A clone with one linked worktree beside its main one — the shape
   *  `isolation: "worktree"` gives an agent. */
  async function cloneWithWorktree() {
    const main = join(dir, "main");
    const linked = join(dir, "linked");
    mkdirSync(main);
    await git(main, "init", "-q");
    await git(main, "commit", "-q", "--allow-empty", "-m", "root");
    await git(main, "worktree", "add", "-q", "-b", "side", linked);
    return { main, linked };
  }

  it("is one file for every worktree of a clone, keyed on the main worktree's root (#423)", async () => {
    const { main, linked } = await cloneWithWorktree();
    const home = join(dir, "home");

    const fromMain = await resolveHistoryFile({}, { cwd: main, home });
    const fromLinked = await resolveHistoryFile({}, { cwd: linked, home });

    expect(fromLinked).toBe(fromMain);
    expect(dirname(fromMain)).toBe(join(home, ".claude-usage-history"));
    // Keyed on the main root, not the linked one — and the transcripts stay
    // keyed on each worktree's own path, which is where Claude Code writes them.
    expect(fromMain).toMatch(/-main\.sqlite$/);
    expect(resolveTranscriptDir({}, { cwd: linked, home })).not.toBe(
      resolveTranscriptDir({}, { cwd: main, home }),
    );
  });

  it("names the same file from a directory inside a worktree", async () => {
    const { main, linked } = await cloneWithWorktree();
    const inside = join(linked, "apps");
    mkdirSync(inside);

    expect(await resolveHistoryFile({}, { cwd: inside, home: dir })).toBe(
      await resolveHistoryFile({}, { cwd: main, home: dir }),
    );
  });

  it("falls back to the working directory's slug when git cannot answer", async () => {
    // A directory that does not exist: the spawn fails, which stands in for no
    // git on PATH and for a directory outside any checkout alike.
    const file = await resolveHistoryFile(
      {},
      { cwd: "C:\\work\\repo", home: "/home/dev" },
    );

    expect(file).toBe(
      join("/home/dev", ".claude-usage-history", "C--work-repo.sqlite"),
    );
  });

  it("honours the override, which is how the E2E and the unit tests keep off the real file", async () => {
    expect(
      await resolveHistoryFile({ [HISTORY_FILE_ENV]: " /tmp/h.sqlite " }, {}),
    ).toBe("/tmp/h.sqlite");
  });
});

describe("the store", () => {
  it("keeps every response it is given, and gives them back", () => {
    const store = memoryStore();
    const rows = [
      response(),
      response({ id: "uuid:u2", branch: null, session: null, at: null }),
    ];

    store.record(rows);

    expect(store.responses()).toEqual(
      [...rows].sort((a, b) => a.id.localeCompare(b.id)),
    );
  });

  it("stores a response once however many scans read it", () => {
    const store = memoryStore();

    store.record([response()]);
    store.record([response()]);
    store.record([response(), response({ id: "message:m2" })]);

    expect(store.responses().map((r) => r.id)).toEqual([
      "message:m1",
      "message:m2",
    ]);
  });

  it("names the earliest timestamp it holds, and none while it holds nothing", () => {
    const store = memoryStore();
    expect(store.since()).toBeNull();

    store.record([
      response({ id: "a", at: "2026-09-05T00:00:00.000Z" }),
      response({ id: "b", at: null }),
      response({ id: "c", at: "2026-09-02T09:00:00.000Z" }),
    ]);

    expect(store.since()).toBe("2026-09-02T09:00:00.000Z");
  });

  // #418: how far each transcript has been read, so the next scan starts there.
  it("remembers each transcript's cursor, the latest one winning", () => {
    const store = memoryStore();
    expect(store.cursors().size).toBe(0);
    const cursor = { offset: 10, size: 12, lines: 1, head: "h1" };

    store.record([response()], new Map([["/t/a.jsonl", cursor]]));
    store.record(
      [],
      new Map([["/t/a.jsonl", { ...cursor, offset: 40, size: 40, lines: 3 }]]),
    );

    expect(store.cursors()).toEqual(
      new Map([["/t/a.jsonl", { offset: 40, size: 40, lines: 3, head: "h1" }]]),
    );
    expect(store.responses()).toHaveLength(1);
  });

  // #419: one trend point per day, the day's last write winning.
  it("keeps one trend point per day, replacing that day's point and leaving the others", () => {
    const store = memoryStore();
    expect(store.trend()).toEqual([]);
    const point = (day: string, median: number): TrendPoint => ({
      day,
      at: `${day}T10:00:00.000Z`,
      measured: 3,
      p25: 1000,
      median,
      p75: 9000,
      scored: 2,
      onTarget: 1,
      edges: { S: 60_000, M: 150_000, L: 250_000 },
    });

    store.recordPoint(point("2026-10-04", 2000));
    store.recordPoint(point("2026-10-03", 1500));
    store.recordPoint({
      ...point("2026-10-04", 5000),
      edges: { S: 50_000, M: 120_000, L: 200_000 },
    });

    expect(store.trend()).toEqual([
      point("2026-10-03", 1500),
      {
        ...point("2026-10-04", 5000),
        edges: { S: 50_000, M: 120_000, L: 200_000 },
      },
    ]);
  });

  it("leaves nothing open once closed, so the file can be deleted (Windows locks)", async () => {
    const file = join(dir, "nested", "history.sqlite");
    const store = await openUsageStore(file);
    store.record([response()]);
    store.close();

    rmSync(file);

    expect(existsSync(file)).toBe(false);
  });
});

describe("history outlives its transcripts (R1, R11)", () => {
  /** One scan's worth of the store: open, record what is on disk, read
   *  everything stored, close — the order `gatherUsage` keeps. */
  const scanInto = async (transcripts: string, file: string) => {
    const store = await openUsageStore(file);
    try {
      store.record(readTranscripts(transcripts).responses);
      return store.responses();
    } finally {
      store.close();
    }
  };

  it("re-attributes and re-counts stored rows whose transcript is gone", async () => {
    const transcripts = join(dir, "transcripts");
    mkdirSync(transcripts);
    const file = join(dir, "history.sqlite");
    writeFileSync(
      join(transcripts, "s.jsonl"),
      [
        {
          sessionId: "s",
          gitBranch: "feat/7-a",
          message: {
            usage: { output_tokens: 4000, cache_read_input_tokens: 9 },
          },
        },
        {
          sessionId: "s",
          gitBranch: "main",
          message: { usage: { output_tokens: 500 } },
        },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n"),
      "utf8",
    );
    await scanInto(transcripts, file);
    rmSync(join(transcripts, "s.jsonl"));

    const stored = await scanInto(transcripts, file);

    // Today's rules, over rows no transcript backs any more.
    const today = tallySpend(stored);
    expect(today.byIssue.get(7)).toEqual({
      turns: 1,
      out: 4000,
      cacheRead: 9,
      sessions: 1,
    });
    expect(today.unattributed).toEqual({ turns: 1, out: 500 });

    // A changed attribution rule moves the stored figures with it: nothing was
    // summed under the old rule and frozen.
    const renumbered = tallySpend(stored, (branch) => {
      const issue = issueOfBranch(branch);
      return issue === null ? null : issue + 1000;
    });
    expect(renumbered.byIssue.has(7)).toBe(false);
    expect(renumbered.byIssue.get(1007)?.out).toBe(4000);

    // So does a changed counting rule: these are rows, not totals.
    const halved = tallySpend(stored.map((r) => ({ ...r, out: r.out / 2 })));
    expect(halved.byIssue.get(7)?.out).toBe(2000);
    expect(halved.unattributed.out).toBe(250);
  });
});
