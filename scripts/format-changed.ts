#!/usr/bin/env bun
// Runs Prettier on the files this branch changes against `origin/develop`
// (#630). The shell way, `bunx prettier --check $(git diff --name-only)`,
// finds no file from PowerShell on this machine: `bun` and `bunx` resolve to
// npm's `.ps1` shims, which pass the substituted list on as one argument, the
// whole list joined. Here the list is an argv array, so both shells run the
// same thing.
//
// The files are every one changed since the branch left `origin/develop`,
// committed or not, plus untracked ones git does not ignore; deleted files
// are left out. Prettier skips what `.prettierignore` names and, with
// `--ignore-unknown`, any file it has no parser for. Fetch first to compare
// against the develop that is on GitHub. `scripts/` has no test runner
// (`docs/standards/dev-tools-usage.md`), so change it and check it by hand.
//
// Usage:
//   bun run format:changed           report, as `format:check` does
//   bun run format:changed --write   rewrite, as `format` does
// Any other argument is passed to Prettier beside `--check`.

import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { repositoryFreeEnv } from "../tools/repo-scan/src/git-env.ts";

const ROOT = path.resolve(import.meta.dir, "..");

/** The NUL-separated entries a git command prints, so no path is mangled. */
function git(...args: string[]): string[] {
  return execFileSync("git", args, {
    cwd: ROOT,
    env: repositoryFreeEnv(),
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
}

let base: string;
try {
  base = execFileSync("git", ["merge-base", "origin/develop", "HEAD"], {
    cwd: ROOT,
    env: repositoryFreeEnv(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
} catch {
  console.error(
    "format:changed: no merge base with origin/develop; run `git fetch origin` first",
  );
  process.exit(1);
}
const files = [
  ...new Set([
    ...git("diff", "-z", "--name-only", "--diff-filter=d", base),
    ...git("ls-files", "-z", "--others", "--exclude-standard"),
  ]),
];
if (files.length === 0) {
  console.log("format:changed: no file changed against origin/develop");
  process.exit(0);
}

const args = process.argv.slice(2);
const prettier = createRequire(import.meta.url).resolve(
  "prettier/bin/prettier.cjs",
);
const { status, error } = spawnSync(
  process.execPath,
  [
    prettier,
    ...(args.includes("--write") ? args : ["--check", ...args]),
    "--ignore-unknown",
    ...files,
  ],
  { cwd: ROOT, stdio: "inherit" },
);
// A list past Windows' command-line limit fails to start, with no output.
if (error) console.error(`format:changed: ${error.message}`);
process.exit(status ?? 1);
