import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { partialCheckout } from "@ticket/repo-scan/checkout";
import { trackedFiles } from "@ticket/repo-scan/tracked-files";

/**
 * No standards file is over `LIMIT_BYTES` unless `OVERSIZED` names it (#757).
 * A worker reads every standards file its change touches in full, and that
 * text rides in every later turn: #748 read about 105 KB of standards for
 * one section, about 4 KB today. The bullet is the pre-push one in
 * `docs/standards/checks.md`.
 *
 * A file is measured with LF endings, so a CRLF checkout and CI's LF one agree
 * about a file near the limit.
 */

/** The repository root, which every tracked path is relative to. */
const REPO_ROOT = path.resolve(import.meta.dir, "../../..");

/** 25 KB (25,600 bytes), the limit #757 proposed. */
const LIMIT_BYTES = 25 * 1024;

type Oversized = { file: string; bytes: number };

/**
 * The files over the limit, each awaiting a split of its own. `bytes` is the
 * size measured 2026-11-10, LF endings, for the reader; the test does not
 * compare it. Splitting a file under the limit fails the check until its line
 * goes.
 */
const OVERSIZED: Oversized[] = [
  { file: "docs/standards/dev-tools-usage.md", bytes: 43_567 },
  { file: "docs/standards/dev-tools.md", bytes: 37_154 },
  { file: "docs/standards/testing-api.md", bytes: 36_520 },
  { file: "docs/standards/backend.md", bytes: 36_061 },
  { file: "docs/standards/frontend.md", bytes: 27_413 },
];

/** A file's size in bytes, with LF endings. */
const lfBytes = (text: string) =>
  Buffer.byteLength(text.replace(/\r\n/g, "\n"), "utf8");

/**
 * What fails: a file over the limit that the allowlist does not name, and an
 * allowlist line for a file that is not over it, or is not there at all.
 */
function sizeFailures(
  sizes: ReadonlyMap<string, number>,
  oversized: readonly Oversized[],
  limit: number,
): string[] {
  const allowed = new Set(oversized.map((o) => o.file));
  const failures: string[] = [];
  for (const [file, bytes] of sizes) {
    if (bytes > limit && !allowed.has(file)) {
      failures.push(
        `${file} is ${bytes} bytes, over the ${limit}-byte limit: split it`,
      );
    }
  }
  for (const { file } of oversized) {
    const bytes = sizes.get(file);
    if (bytes === undefined) {
      failures.push(`${file} is allowlisted but is not a standards file`);
    } else if (bytes <= limit) {
      failures.push(
        `${file} is ${bytes} bytes, under the limit: remove its allowlist line`,
      );
    }
  }
  return failures;
}

const isStandard = (file: string) => /^docs\/standards\/[^/]+\.md$/.test(file);

describe.skipIf(partialCheckout)(
  "Standards files stay under the size limit (docs/standards/checks.md)",
  () => {
    // The develop image has no `.git` and no docs, so this block skips there.
    const files = partialCheckout
      ? []
      : trackedFiles(REPO_ROOT).filter(isStandard);
    const sizes = new Map(
      files.map((file) => [
        file,
        lfBytes(readFileSync(path.join(REPO_ROOT, file), "utf8")),
      ]),
    );

    test("the walk reads the standards", () => {
      // An empty walk is a green run that checked nothing.
      expect(files).toContain("docs/standards/checks.md");
      expect(files).toContain("docs/standards/dev-tools-transcripts.md");
    });

    test("no standards file is over the limit unless allowlisted, and every allowlisted one is", () => {
      expect(sizeFailures(sizes, OVERSIZED, LIMIT_BYTES)).toEqual([]);
    });
  },
);

describe("the size check, shown what it must catch", () => {
  const LIMIT = 100;
  const sizes = new Map([
    ["docs/standards/small.md", 40],
    ["docs/standards/big.md", 150],
  ]);

  test("a file over the limit that is not allowlisted fails", () => {
    expect(sizeFailures(sizes, [], LIMIT)).toEqual([
      "docs/standards/big.md is 150 bytes, over the 100-byte limit: split it",
    ]);
  });

  test("an allowlisted file over the limit passes", () => {
    expect(
      sizeFailures(
        sizes,
        [{ file: "docs/standards/big.md", bytes: 150 }],
        LIMIT,
      ),
    ).toEqual([]);
  });

  test("an allowlist line for a file under the limit, or for no file, fails", () => {
    expect(
      sizeFailures(
        sizes,
        [
          { file: "docs/standards/big.md", bytes: 150 },
          { file: "docs/standards/small.md", bytes: 40 },
          { file: "docs/standards/gone.md", bytes: 0 },
        ],
        LIMIT,
      ),
    ).toEqual([
      "docs/standards/small.md is 40 bytes, under the limit: remove its allowlist line",
      "docs/standards/gone.md is allowlisted but is not a standards file",
    ]);
  });

  test("a CRLF file and its LF copy measure the same", () => {
    expect(lfBytes("a\r\nb\r\n")).toBe(lfBytes("a\nb\n"));
    expect(lfBytes("—\n")).toBe(4);
  });
});
