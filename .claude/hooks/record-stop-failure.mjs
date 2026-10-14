// StopFailure hook: a turn ended on an API error, most often the usage limit.
// The hook cannot prevent or resume anything; it records where the work stood
// so the next session resumes from a known state rather than guessing. Each
// stop appends one JSON line to ~/.claude/stop-failures.jsonl: the hook input
// as received, plus the branch and the uncommitted files at that moment.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const git = (args, cwd) => {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 3000 }).trim();
  } catch {
    return null;
  }
};

let input = {};
try {
  input = JSON.parse(readFileSync(0, "utf8").replace(/^﻿/, ""));
} catch {
  // Record the stop even when the input is unreadable.
}
const cwd = input.cwd ?? process.cwd();

const entry = {
  at: new Date().toISOString(),
  input,
  branch: git(["branch", "--show-current"], cwd),
  status: git(["status", "--porcelain"], cwd)?.split("\n").filter(Boolean) ?? null,
};

try {
  appendFileSync(join(homedir(), ".claude", "stop-failures.jsonl"), JSON.stringify(entry) + "\n");
} catch {
  // An observational hook has no one to report a failure to.
}
