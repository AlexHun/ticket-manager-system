// Waits on a PR's CI checks and always comes back inside one tool call. The
// E2E job runs 11-18 minutes and a foreground tool call stops at 10, so
// `gh pr checks --watch` timed out on every worker's first watch in the
// scripted-model chain (#654-#658), each one costing a stop and a re-watch,
// and `gh run watch` printed 242 KB of repeated status into the session.
//
// One line out, and the exit code carries the verdict:
//   0  green    every check passed or was skipped
//   1  red      a check failed; the line names each one and its link. Or
//               the head commit skips CI (below)
//   2  pending  still running when the budget ran out: run it again
//
// "no checks reported" right after a push, and a run cancelled because a
// newer push superseded it, are both waited through as pending, unless the
// head commit's message carries a tag that skips CI: GitHub honours one
// anywhere in the message, and #669's first commit, which only mentioned a
// `[skip ci]` bump, sat on "no checks reported" for 18 minutes. That is red.
//
// The default budget, 170 seconds, sits under the 180 seconds after which a
// subagent's foreground call is moved to the background (#756). Backgrounded,
// the script never woke #746's worker, which wrote its own polling loop
// instead and spent about 5.8M cache-read tokens on it (retro of 2026-11-08).
// Every `gh` call is cut off at GH_TIMEOUT_MS, and the loop polls only while a
// poll and its call both end inside the budget, so a stalled `gh` costs a
// `pending` rather than the limit. A main session can pass a longer budget,
// such as 540, under the 10-minute call limit.
//
// Usage: node .claude/scripts/wait-checks.mjs <pr> [budget-seconds, default 170]
import { spawnSync } from "node:child_process";

const POLL_MS = 30 * 1000;
const GH_TIMEOUT_MS = 8 * 1000;

// GitHub's skip tags, plus the `skip-checks: true` trailer.
const SKIP_CI = /\[(?:skip ci|ci skip|no ci|skip actions|actions skip)\]|^skip-checks: ?true$/im;

const pr = process.argv[2];
const budgetMs = Number(process.argv[3] ?? 170) * 1000;

/** The PR's checks, or null when `gh` ran past GH_TIMEOUT_MS. */
function readChecks() {
  const { stdout, stderr, error } = spawnSync(
    "gh",
    ["pr", "checks", pr, "--json", "name,bucket,link"],
    { encoding: "utf8", timeout: GH_TIMEOUT_MS },
  );
  if (error?.code === "ETIMEDOUT") return null;
  try {
    return JSON.parse(stdout);
  } catch {
    // gh prints nothing on stdout and "no checks reported" on stderr until
    // the run registers.
    if (/no checks reported/i.test(stderr ?? "")) return [];
    throw new Error((stderr ?? "").trim() || `gh pr checks ${pr} printed no JSON`);
  }
}

/** The skip tag in the PR's head commit message, or null. */
function headSkipTag() {
  const { stdout } = spawnSync("gh", ["pr", "view", pr, "--json", "commits"], {
    encoding: "utf8",
    timeout: GH_TIMEOUT_MS,
  });
  try {
    const head = JSON.parse(stdout).commits.at(-1);
    return SKIP_CI.exec(`${head.messageHeadline}\n${head.messageBody}`)?.[0] ?? null;
  } catch {
    return null;
  }
}

function verdict(checks) {
  if (checks === null) return [2, `pending: gh pr checks ran past ${GH_TIMEOUT_MS / 1000}s`];
  const failed = checks.filter((check) => check.bucket === "fail");
  if (failed.length > 0) {
    return [1, `red: ${failed.map((check) => `${check.name} ${check.link}`).join(", ")}`];
  }
  const waiting = checks.filter((check) => check.bucket === "pending" || check.bucket === "cancel");
  if (checks.length === 0 || waiting.length > 0) {
    const names = waiting.map((check) => check.name).join(", ");
    return [2, checks.length === 0 ? "pending: no checks reported yet" : `pending: ${names}`];
  }
  return [0, `green: ${checks.length} checks`];
}

if (!/^\d+$/.test(pr ?? "") || !(budgetMs > 0)) {
  process.stdout.write("usage: node .claude/scripts/wait-checks.mjs <pr> [budget-seconds]\n");
  process.exit(2);
}

const deadline = Date.now() + budgetMs;
let result = verdict(readChecks());
const skipTag = result[1] === "pending: no checks reported yet" ? headSkipTag() : null;
if (skipTag !== null) {
  result = [1, `red: the head commit's message carries ${skipTag}, so CI never runs; push a commit without it`];
}
while (result[0] === 2 && Date.now() + POLL_MS + GH_TIMEOUT_MS < deadline) {
  await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  result = verdict(readChecks());
}
process.stdout.write(result[1] + "\n");
process.exit(result[0]);
