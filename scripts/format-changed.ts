#!/usr/bin/env bun
// Runs Prettier on the files this branch changes against `origin/develop`
// (#630). The shell way, `bunx prettier --check $(git diff --name-only)`,
// works in bash only: in PowerShell the substitution reaches Prettier as one
// argument, the whole list joined, which names no file. Here the list is an
// argv array, so both shells run the same thing.
//
// The files are every one changed since the branch left `origin/develop`,
// committed or not, plus untracked ones git does not ignore; deleted files
// are left out. Prettier skips what `.prettierignore` names and, with
// `--ignore-unknown`, any file it has no parser for. Fetch first to compare
// against the develop that is on GitHub.
//
// Usage:
//   bun run format:changed           report, as `format:check` does
//   bun run format:changed --write   rewrite, as `format` does

import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { repositoryFreeEnv } from "../tools/repo-scan/src/git-env.ts";

const ROOT = path.resolve(import.meta.dir, "..");

function git(...args: string[]): string[] {
  return execFileSync("git", ["-c", "core.quotePath=false", ...args], {
    cwd: ROOT,
    env: repositoryFreeEnv(),
    encoding: "utf8",
  })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

const [base] = git("merge-base", "origin/develop", "HEAD");
const files = [
  ...new Set([
    ...git("diff", "--name-only", "--diff-filter=d", base!),
    ...git("ls-files", "--others", "--exclude-standard"),
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
const { status } = spawnSync(
  process.execPath,
  [
    prettier,
    ...(args.length > 0 ? args : ["--check"]),
    "--ignore-unknown",
    ...files,
  ],
  { cwd: ROOT, stdio: "inherit" },
);
process.exit(status ?? 1);
