import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ISSUES_FILE_ENV, fetchIssueMetadata } from "./issues.ts";

/**
 * The `gh` half of the Usage page, and the two ways it is allowed to fail.
 *
 * The spawn itself is injected rather than performed: a unit suite that shelled
 * out to `gh` would need this machine to be authenticated, this repo to be
 * reachable, and the answer to be whatever the assertions were written against
 * — three reasons for a red run that have nothing to do with the code. What is
 * exercised for real is the file branch, because that one *is* filesystem work
 * and is the seam Playwright drives.
 */

/** One issue, in the shape `gh issue list --json …` prints. */
const ghIssue = (over: Record<string, unknown> = {}) => ({
  number: 101,
  title: "Usage page: titles, links, forecast bands and verdicts",
  state: "OPEN",
  url: "https://github.com/AlexHun/ticket-manager-system/issues/101",
  labels: [{ name: "ready-for-agent" }, { name: "forecast/M" }],
  ...over,
});

/** A lister that resolves with what `gh` would have printed. */
const listing =
  (...issues: unknown[]) =>
  () =>
    Promise.resolve(JSON.stringify(issues));

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gh-issues-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A fixture file holding what `gh` would have printed. */
function fixture(body: string): string {
  const file = join(dir, "issues.json");
  writeFileSync(file, body, "utf8");
  return file;
}

describe("fetchIssueMetadata", () => {
  it("reads titles, links and the forecast band off the listing", async () => {
    const meta = await fetchIssueMetadata({}, listing(ghIssue()));

    expect(meta.warning).toBeNull();
    expect(meta.byIssue?.get(101)).toEqual({
      title: "Usage page: titles, links, forecast bands and verdicts",
      url: "https://github.com/AlexHun/ticket-manager-system/issues/101",
      state: "OPEN",
      forecast: "M",
    });
  });

  // The band letter is the wire value, so a label the bands do not name must
  // not become one by string coincidence.
  it("reports no forecast for an issue whose labels name no band", async () => {
    const meta = await fetchIssueMetadata(
      {},
      listing(
        ghIssue({ number: 7, labels: [{ name: "bug" }] }),
        ghIssue({ number: 8, labels: [{ name: "forecast/huge" }] }),
        ghIssue({ number: 9, labels: [] }),
      ),
    );

    expect(meta.byIssue?.get(7)?.forecast).toBeNull();
    expect(meta.byIssue?.get(8)?.forecast).toBeNull();
    expect(meta.byIssue?.get(9)?.forecast).toBeNull();
  });

  it("keeps every issue the listing carries, keyed by number", async () => {
    const meta = await fetchIssueMetadata(
      {},
      listing(ghIssue(), ghIssue({ number: 102, labels: [] })),
    );

    expect([...(meta.byIssue?.keys() ?? [])]).toEqual([101, 102]);
  });

  // The degraded path, and the one the acceptance criteria are about: no `gh`,
  // no crash, and a sentence saying what is now unknown.
  it("reports gh's failure as a warning rather than throwing", async () => {
    const meta = await fetchIssueMetadata({}, () =>
      Promise.reject(new Error("spawn gh ENOENT")),
    );

    expect(meta.byIssue).toBeNull();
    expect(meta.warning).toContain("gh");
    expect(meta.warning).toContain("ENOENT");
  });

  // Node gives a timed-out child no message of its own beyond the command it
  // ran, which explains nothing to someone who pressed Scan.
  it("says how long it waited when gh is killed by the timeout", async () => {
    const meta = await fetchIssueMetadata({}, () =>
      Promise.reject(
        Object.assign(
          new Error("Command failed: gh issue list --state all --limit 500"),
          { killed: true, signal: "SIGTERM" },
        ),
      ),
    );

    expect(meta.byIssue).toBeNull();
    expect(meta.warning).toMatch(/no answer within \d+ms/);
  });

  it("treats output that is not a listing as a failure, not as no issues", async () => {
    const meta = await fetchIssueMetadata({}, () =>
      Promise.resolve("not json at all"),
    );

    expect(meta.byIssue).toBeNull();
    expect(meta.warning).toBeTruthy();
  });

  describe(ISSUES_FILE_ENV, () => {
    it("reads the file instead of spawning anything", async () => {
      const run = vi.fn(listing(ghIssue()));
      const file = fixture(JSON.stringify([ghIssue({ number: 55 })]));

      const meta = await fetchIssueMetadata({ [ISSUES_FILE_ENV]: file }, run);

      expect(run).not.toHaveBeenCalled();
      expect(meta.byIssue?.get(55)?.forecast).toBe("M");
    });

    // The seam is an override, not a preference: falling back to `gh` when the
    // file is missing would make the E2E's degraded case read live GitHub, and
    // it would pass or fail depending on whose machine it ran on.
    it("degrades rather than falling back to gh when the file is not there", async () => {
      const run = vi.fn(listing(ghIssue()));
      const missing = join(dir, "not-here.json");

      const meta = await fetchIssueMetadata(
        { [ISSUES_FILE_ENV]: missing },
        run,
      );

      expect(run).not.toHaveBeenCalled();
      expect(meta.byIssue).toBeNull();
      expect(meta.warning).toContain(missing);
    });

    it("ignores an override that is only whitespace", async () => {
      const meta = await fetchIssueMetadata(
        { [ISSUES_FILE_ENV]: "   " },
        listing(ghIssue()),
      );

      expect(meta.byIssue?.size).toBe(1);
    });
  });
});
