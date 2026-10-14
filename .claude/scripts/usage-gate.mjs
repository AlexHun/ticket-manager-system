// Prints whether there is room in the usage limit for another ticket, read
// from the snapshot the user's terminal status line writes to
// ~/.claude/usage-snapshot.json on every refresh. No session can read the
// limit itself, and the first sign of running out is a 429 that stops every
// agent at once, so /chain asks this before it starts each worker.
//
// One line out, and the exit code carries the verdict:
//   0  go       the five-hour window is under the threshold
//   1  pause    at or over it; the line says when the window resets
//   2  unknown  no snapshot, an unreadable one, or one too old to trust
//
// Usage: node .claude/scripts/usage-gate.mjs [threshold-percent, default 75]
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// The status line only runs in the terminal CLI; past this age the numbers
// describe an earlier session, not the current one.
const MAX_SNAPSHOT_AGE_MS = 10 * 60 * 1000;

const threshold = Number(process.argv[2] ?? 75);
const snapshotPath = join(homedir(), ".claude", "usage-snapshot.json");

const clock = (epochSeconds) =>
  new Date(epochSeconds * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function verdict() {
  let snapshot;
  try {
    snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
  } catch {
    return [2, "unknown: no usage snapshot; the terminal status line writes one"];
  }
  const ageMinutes = Math.round((Date.now() - snapshot.at) / 60000);
  if (!(Date.now() - snapshot.at <= MAX_SNAPSHOT_AGE_MS)) {
    return [2, `unknown: the usage snapshot is ${ageMinutes} min old`];
  }
  const window = snapshot.rate_limits?.five_hour;
  if (typeof window?.used_percentage !== "number") {
    return [2, "unknown: the snapshot has no five-hour window"];
  }
  const used = Math.round(window.used_percentage);
  const resets = typeof window.resets_at === "number" ? `, resets ${clock(window.resets_at)}` : "";
  const sevenDay = snapshot.rate_limits?.seven_day?.used_percentage;
  const week = typeof sevenDay === "number" ? `, 7d ${Math.round(sevenDay)}%` : "";
  const line = `5h ${used}%${resets}${week} (snapshot ${ageMinutes} min old)`;
  return used >= threshold ? [1, `pause: ${line}`] : [0, `go: ${line}`];
}

const [code, line] = verdict();
process.stdout.write(line + "\n");
process.exit(code);
