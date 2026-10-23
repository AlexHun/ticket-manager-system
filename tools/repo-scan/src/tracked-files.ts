import { execFileSync } from "node:child_process";
import { repositoryFreeEnv } from "./git-env.ts";

/**
 * The files git tracks under `root`, as `/`-separated paths relative to it.
 *
 * Every check that reads the repository's own source reads this list (#567,
 * `docs/prd/one-repo-scanner.md` R5): both standards guards,
 * `validation-copy.test.ts`, `git-spawn-env.test.ts` and the doc citations.
 * So a local run checks what CI checks, and a generated or ignored directory
 * needs no exclusion written by hand. The cost is that an untracked file a
 * developer has not yet added is not read until it is, which the PRD accepts:
 * `pre-push` and CI both see committed files, and those are what ship.
 *
 * Its environment comes from `repositoryFreeEnv`, so a call from inside a git
 * hook lists `root`'s repository and not the hook's (#531).
 */
export function trackedFiles(root: string): string[] {
  return execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    env: repositoryFreeEnv(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter(Boolean);
}
