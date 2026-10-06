import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gatherUsage, readStoredUsage } from "./usage.ts";
import { ISSUE_STATE, type IssueMetadata } from "./issues.ts";
import { openUsageStore } from "./usage-store.ts";
import { USAGE_WARNING_SOURCE } from "../src/dev/usage-protocol.ts";

/**
 * The stored reading (#432): what the Usage page opens on, computed from the
 * usage history alone — the rows, the trend and the listing the last scan or
 * push kept — reading no transcript, running no `gh` and writing nothing.
 *
 * Its own file because of the mock below: `readTranscripts` is replaced for
 * the whole module, so the claim "reads no transcript" is a throw rather than
 * an absence of warnings. Scans in here set `scanning` to let it through.
 */

const { gate } = vi.hoisted(() => ({ gate: { scanning: false } }));

vi.mock("./transcripts.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./transcripts.ts")>();
  return {
    ...actual,
    readTranscripts: (...args: Parameters<typeof actual.readTranscripts>) => {
      if (!gate.scanning)
        throw new Error("the stored reading read a transcript");
      return actual.readTranscripts(...args);
    },
  };
});

/** A lister that fails the test if anything asks `gh`. */
const noGh = vi.fn(async (): Promise<string> => {
  throw new Error("the stored reading ran gh");
});

const LISTING: IssueMetadata = {
  byIssue: new Map([
    [
      101,
      {
        title: "Issue 101",
        url: "https://github.com/o/r/issues/101",
        state: ISSUE_STATE.open,
        forecast: "M",
      },
    ],
    [
      300,
      {
        title: "Nobody has started this",
        url: "https://github.com/o/r/issues/300",
        state: ISSUE_STATE.open,
        forecast: "L",
      },
    ],
  ]),
  warning: null,
};

const turn = (branch: string, out: number, id: string, at: string) =>
  JSON.stringify({
    sessionId: "s",
    gitBranch: branch,
    timestamp: at,
    message: { id, usage: { output_tokens: out, cache_read_input_tokens: 7 } },
  });

let dir: string;
let transcripts: string;
let history: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "usage-stored-"));
  transcripts = join(dir, "transcripts");
  history = join(dir, "history.sqlite");
  gate.scanning = false;
  noGh.mockClear();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** One scan of a transcript on `#101` and one on `main`, into `history`. */
async function scanOnce(listing: IssueMetadata = LISTING) {
  rmSync(transcripts, { recursive: true, force: true });
  mkdirSync(transcripts, { recursive: true });
  writeFileSync(
    join(transcripts, "s.jsonl"),
    [
      turn("feat/101-a", 4200, "m1", "2026-09-02T09:00:00.000Z"),
      turn("main", 800, "m2", "2026-09-02T09:05:00.000Z"),
    ].join("\n") + "\n",
    "utf8",
  );
  gate.scanning = true;
  try {
    return await gatherUsage(
      transcripts,
      listing,
      history,
      () => new Date("2026-10-06T12:00:00.000Z"),
    );
  } finally {
    gate.scanning = false;
  }
}

const open = (issuesFile: string | null = null) =>
  readStoredUsage(transcripts, history, issuesFile, {
    run: noGh,
    now: () => new Date("2026-10-06T13:00:00.000Z"),
  });

describe("readStoredUsage", () => {
  it("reports what the last scan reported for the same rows, without a transcript or gh", async () => {
    const scan = await scanOnce();

    const stored = await open();

    expect(stored).not.toBeNull();
    expect(stored!.issues).toEqual(scan.issues);
    expect(stored!.unattributed).toEqual(scan.unattributed);
    expect(stored!.trend).toEqual(scan.trend);
    expect(stored!.historySince).toBe(scan.historySince);
    expect(stored!.warnings).toEqual([]);
    // Stamped when it was opened, and saying it read no transcript.
    expect(stored!.gatheredAt).toBe("2026-10-06T13:00:00.000Z");
    expect(stored!.transcripts).toBeNull();
    expect(stored!.transcriptDir).toBe(transcripts);
    expect(noGh).not.toHaveBeenCalled();
  });

  it("writes nothing: the history is byte-identical afterwards", async () => {
    await scanOnce();
    const before = readFileSync(history);

    await open();

    expect(readFileSync(history).equals(before)).toBe(true);
  });

  it("is null when no history exists, and creates none", async () => {
    expect(await open()).toBeNull();
    expect(existsSync(history)).toBe(false);
  });

  it("is null when no history is configured", async () => {
    expect(
      await readStoredUsage(transcripts, null, null, { run: noGh }),
    ).toBeNull();
  });

  it("is null when the history holds no rows", async () => {
    (await openUsageStore(history)).close();

    expect(await open()).toBeNull();
  });

  it("repeats the warning the last scan's listing carried", async () => {
    const warning = "`gh` could not list this repository's issues: offline";
    const scan = await scanOnce({ byIssue: null, warning });

    const stored = await open();

    expect(stored!.issues).toEqual(scan.issues);
    expect(stored!.warnings).toEqual([
      { source: USAGE_WARNING_SOURCE.listing, message: warning },
    ]);
  });

  // Railway's develop (#428): a push rewrites `GH_ISSUES_FILE` without a scan,
  // so the file is newer than anything the history kept.
  it("reads the listing GH_ISSUES_FILE names over the one the history kept", async () => {
    await scanOnce();
    const file = join(dir, "issues.json");
    writeFileSync(
      file,
      JSON.stringify([
        {
          number: 101,
          title: "Renamed since the scan",
          state: "OPEN",
          url: "https://github.com/o/r/issues/101",
          labels: [{ name: "forecast/S" }],
        },
      ]),
      "utf8",
    );

    const stored = await open(file);

    expect(stored!.issues.map((row) => [row.issue, row.title])).toEqual([
      [101, "Renamed since the scan"],
    ]);
    expect(stored!.issues[0]).toMatchObject({
      forecast: "S",
      verdict: "on target",
    });
    expect(noGh).not.toHaveBeenCalled();
  });

  it("says no listing is kept when the history predates one", async () => {
    await scanOnce();
    // As a history written before #432 reads: no `listing` table at all.
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(history);
    db.exec("DROP TABLE listing");
    db.close();

    const stored = await open();

    expect(stored!.issues).toMatchObject([
      { issue: 101, title: null, forecast: null, spend: { out: 4200 } },
    ]);
    expect(stored!.warnings).toHaveLength(1);
    expect(stored!.warnings[0]).toMatchObject({
      source: USAGE_WARNING_SOURCE.listing,
    });
    expect(stored!.warnings[0]!.message).toMatch(/press Scan/i);
  });
});
