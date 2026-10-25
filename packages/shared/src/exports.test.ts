import { describe, expect, test } from "bun:test";
import changelogEntriesData from "./changelog-entries.json" with { type: "json" };
import * as shared from "./index";

/**
 * The package's runtime exports, recorded before the single file was split by
 * domain (#579, `docs/prd/split-shared.md` R2): every name, its `typeof`, and
 * its value serialised, so a move that drops an export, renames one, or lets
 * an `export *` clash silently shadow one fails here. Every value the package
 * exports is plain JSON, which is what makes the value comparable at all.
 *
 * A function is recorded by its arity, not its source: Bun hands back the
 * transpiled text, which a Bun upgrade could change without a line here
 * moving. Type-only exports leave nothing at runtime; a dropped one fails
 * typecheck at its callers.
 *
 * Changing an export on purpose updates the snapshot in the same commit:
 * `bun test --update-snapshots` from this package.
 */

/** The exports read from `changelog-entries.json`, which CI's `bump-version`
 *  job rewrites on every push to `develop`: a snapshot of their values would
 *  go red on the next bump, so they are recorded by where they come from and
 *  checked against the file. */
const FROM_CHANGELOG_FILE = new Set([
  "CHANGELOG_ENTRIES",
  "CHANGELOG_LATEST_VERSION",
]);

const record = (name: string, value: unknown) => {
  if (FROM_CHANGELOG_FILE.has(name)) {
    return { typeof: typeof value, value: "changelog-entries.json" };
  }
  if (typeof value === "function") {
    return { typeof: "function", length: value.length };
  }
  return { typeof: typeof value, value };
};

describe("the package's exports", () => {
  test("are the names, kinds and values recorded before the split", () => {
    const exports = Object.fromEntries(
      Object.keys(shared)
        .sort()
        .map((name) => [
          name,
          record(name, shared[name as keyof typeof shared]),
        ]),
    );
    expect(exports).toMatchSnapshot();
  });

  test("read the changelog entries from changelog-entries.json", () => {
    expect(shared.CHANGELOG_ENTRIES).toEqual(changelogEntriesData);
    const versions = changelogEntriesData.map((entry) => entry.version);
    expect(shared.CHANGELOG_LATEST_VERSION).toBe(
      versions.sort(shared.compareVersions).at(-1) ?? null,
    );
  });
});
