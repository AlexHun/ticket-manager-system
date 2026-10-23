import { describe, expect, test } from "bun:test";
import path from "node:path";
import { filesUnder, trackedFiles } from "./tracked-files.ts";

const REPO_ROOT = path.resolve(import.meta.dir, "../../..");

describe("trackedFiles", () => {
  test("lists the repository's tracked files relative to the root, with / separators", () => {
    const files = trackedFiles(REPO_ROOT);
    expect(files).toContain("tools/repo-scan/src/git-env.ts");
    expect(files).toContain("package.json");
    expect(files.some((file) => file.includes("\\"))).toBe(false);
  });

  test("from a subdirectory, lists only what is under it, relative to it", () => {
    const files = trackedFiles(path.join(REPO_ROOT, "tools/repo-scan"));
    expect(files).toContain("src/git-env.ts");
    expect(files).toContain("package.json");
    expect(files.some((file) => file.startsWith("apps/"))).toBe(false);
  });

  test("never lists an ignored file", () => {
    // `node_modules` is ignored and installed in every checkout that runs this.
    const files = trackedFiles(REPO_ROOT);
    expect(files.some((file) => file.includes("node_modules/"))).toBe(false);
  });
});

describe("filesUnder", () => {
  test("keeps the files under a directory, relative to it, and nothing that only shares its prefix", () => {
    const files = [
      "apps/web/src/a.ts",
      "apps/webhooks/b.ts",
      "apps/web",
      "c.ts",
    ];
    expect(filesUnder(files, "apps/web")).toEqual(["src/a.ts"]);
  });
});
