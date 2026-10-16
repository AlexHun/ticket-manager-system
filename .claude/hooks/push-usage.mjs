// SessionEnd hook: send this laptop's usage history to Railway's develop
// server (#557), which has no transcripts of its own and shows only what is
// pushed to it (DEPLOYMENT.md §7). Without it the push waited for someone to
// remember `bun run tokens --push`.
//
// settings.json is committed, so the hook runs in every clone and session; one
// without both Basic Auth variables exits here having done nothing. With them,
// it starts a detached copy of itself as the worker and returns at once, so
// ending a session never waits on the scan and upload, and the hook's timeout
// never cuts a push short.
//
// The worker runs the push and appends one line to
// ~/.claude-usage-history/push.log: the time, then the push's own summary or
// its error. Nobody is watching when a session ends, so that line is the only
// place a failed push shows. The credentials come only from the environment
// and are redacted from the line, in a URL or anywhere else.
//
// The command after `--` replaces the push, for the test: the real one scans
// every transcript and reaches the network.
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEVELOP_URL = "https://web-ticket-manager-develop.up.railway.app";
const PUSH_COMMAND = `bun run tokens --push ${DEVELOP_URL}`;
// Long enough for a full scan on a slow day; a hung push is then killed.
const TIMEOUT_MS = 10 * 60 * 1000;
// A server's error page lands on the reason line whole; this keeps it a line.
const MAX_REASON = 500;

const self = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(self), "../..");
const username = process.env.DEV_BASIC_AUTH_USERNAME;
const password = process.env.DEV_BASIC_AUTH_PASSWORD;

if (!username || !password) process.exit(0);

const argv = process.argv.slice(2);
const worker = argv[0] === "--worker";
const hookArgs = worker ? argv.slice(1) : argv;
const standIn = hookArgs[0] === "--" ? hookArgs.slice(1) : [];

if (!worker) {
  spawn(process.execPath, [self, "--worker", ...hookArgs], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();
  process.exit(0);
}

// Through the shell, because on Windows `bun` is often an npm `.cmd` shim,
// which Node will not start without one. The command is a constant, or the
// test's own; no input reaches it.
const command = standIn.length
  ? standIn.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)).join(" ")
  : PUSH_COMMAND;

const lines = (text) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

const summary = ({ error, timedOut, status, signal, stdout, stderr }) => {
  if (error) return `failed: ${error.message}`;
  if (timedOut) return `failed: timed out after ${TIMEOUT_MS / 60000} minutes`;
  if (status === 0) {
    // The wording `push()` in scripts/issue-tokens.ts prints.
    const pushed = lines(stdout).find((line) => line.startsWith("pushed "));
    return pushed ?? "finished without reporting a push";
  }
  const errors = lines(stderr);
  const pushErrors = errors.filter((line) => line.startsWith("Push"));
  const reason = pushErrors.length ? pushErrors.join("; ") : errors.at(-1);
  const shown =
    reason && reason.length > MAX_REASON ? `${reason.slice(0, MAX_REASON)}…` : reason;
  return `failed (exit ${status ?? signal}): ${shown ?? "no output"}`;
};

// A URL's userinfo first, then each value wherever else it appears: raw,
// percent-encoded as a URL carries it, and as the Basic Auth header's base64.
// A short value also blanks the same letters inside other words; a garbled
// line is the price of never writing a credential.
const redact = (text) => {
  let out = text.replace(/\/\/[^/\s@]*@/g, "//");
  const forms = new Set([
    username,
    password,
    encodeURIComponent(username),
    encodeURIComponent(password),
    Buffer.from(`${username}:${password}`).toString("base64"),
  ]);
  for (const form of [...forms].sort((a, b) => b.length - a.length)) {
    out = out.split(form).join("***");
  }
  return out;
};

// Once: a command that fails to start can report both `error` and `close`.
let recorded = false;
const record = (outcome) => {
  if (recorded) return;
  recorded = true;
  try {
    const dir = join(homedir(), ".claude-usage-history");
    mkdirSync(dir, { recursive: true });
    appendFileSync(
      join(dir, "push.log"),
      `${new Date().toISOString()} ${redact(summary(outcome))}\n`,
    );
  } catch {
    // A detached worker has no one to report a failure to.
  }
};

// The whole tree, not just the shell: on Windows killing `cmd.exe` leaves the
// `bun` it started running, so the timeout would end nothing.
const killTree = (pid) => {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
  } else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
};

const child = spawn(command, {
  cwd: repoRoot,
  shell: true,
  windowsHide: true,
  // Its own process group off Windows, so `killTree` can signal all of it.
  detached: process.platform !== "win32",
});
let stdout = "";
let stderr = "";
let timedOut = false;
child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
const timer = setTimeout(() => {
  timedOut = true;
  killTree(child.pid);
}, TIMEOUT_MS);
child.on("error", (error) => {
  clearTimeout(timer);
  record({ error, stdout, stderr });
});
child.on("close", (status, signal) => {
  clearTimeout(timer);
  record({ timedOut, status, signal, stdout, stderr });
});
