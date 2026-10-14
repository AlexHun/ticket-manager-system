// SessionStart hook, on resume and after compaction: prints where the work
// stands, so CLAUDE.md's "resume from the repo, not from memory" starts from
// the repo's facts rather than from the summary. Plain stdout on SessionStart
// is added to Claude's context. The branch, the uncommitted files and the
// branch's PR with its checks are the three things that rule asks for.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const run = (cmd, args, cwd) => {
  try {
    return execFileSync(cmd, args, {
      cwd,
      encoding: "utf8",
      timeout: 8000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trimEnd();
  } catch {
    return null;
  }
};

let input = {};
try {
  input = JSON.parse(readFileSync(0, "utf8").replace(/^﻿/, ""));
} catch {
  // Print the state even when the input is unreadable.
}
const cwd = input.cwd ?? process.cwd();

const branch = run("git", ["branch", "--show-current"], cwd);
const status = run("git", ["status", "--short"], cwd);
const pr = run(
  "gh",
  [
    "pr",
    "view",
    "--json",
    "number,state,title,url,statusCheckRollup",
    "--jq",
    '"#\\(.number) \\(.state) \\(.title) \\(.url)\\n" + ([.statusCheckRollup[] | "  \\(.name): \\(.conclusion // .status)"] | join("\\n"))',
  ],
  cwd,
);

process.stdout.write(
  [
    `Session ${input.source ?? "resumed"}: state read from the repo, not from memory.`,
    `Branch: ${branch ?? "unknown"}`,
    `Uncommitted: ${status ? `\n${status}` : "none"}`,
    `PR: ${pr ?? "none for this branch"}`,
    "Tell the user where things stand before the next action.",
  ].join("\n") + "\n",
);
