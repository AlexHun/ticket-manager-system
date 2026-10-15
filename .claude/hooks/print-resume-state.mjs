// SessionStart hook, on resume and after compaction: prints where the work
// stands, so CLAUDE.md's "resume from the repo, not from memory" starts from
// the repo's facts rather than from the summary. Plain stdout on SessionStart
// is added to Claude's context. The branch, the uncommitted files and the
// branch's PR with its checks are the three things that rule asks for.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// A failure returns null unless the caller maps its stderr: `gh pr view` says
// why there, which tells a branch with no PR apart from gh being offline or
// signed out.
const run = (cmd, args, cwd, onError = () => null) => {
  try {
    return execFileSync(cmd, args, {
      cwd,
      encoding: "utf8",
      timeout: 8000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trimEnd();
  } catch (error) {
    return onError(String(error.stderr ?? ""));
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
    // A check run carries name/conclusion/status, with conclusion "" while it
    // is pending; a commit status carries context/state.
    "--jq",
    '"#\\(.number) \\(.state) \\(.title) \\(.url)\\n" + ([.statusCheckRollup[] | "  \\(.name // .context): \\(if (.conclusion // "") != "" then .conclusion else (.state // .status) end)"] | join("\\n"))',
  ],
  cwd,
  (stderr) =>
    /no pull requests found/i.test(stderr)
      ? "none for this branch"
      : `unavailable (gh failed: ${stderr.trim().split("\n")[0] || "timed out"})`,
);

process.stdout.write(
  [
    `Session ${input.source ?? "resumed"}: state read from the repo, not from memory.`,
    `Branch: ${branch ?? "unknown"}`,
    `Uncommitted: ${status === null ? "unknown" : status ? `\n${status}` : "none"}`,
    `PR: ${pr}`,
    "Tell the user where things stand before the next action.",
  ].join("\n") + "\n",
);
