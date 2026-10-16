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
const PUSH = `bun run tokens --push ${DEVELOP_URL}`;
// Long enough for a full scan on a slow day; a hung push still ends.
const TIMEOUT_MS = 10 * 60 * 1000;

const self = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(self), "../..");
const username = process.env.DEV_BASIC_AUTH_USERNAME;
const password = process.env.DEV_BASIC_AUTH_PASSWORD;

if (!username || !password) process.exit(0);

const argv = process.argv.slice(2);
const worker = argv[0] === "--worker";
const rest = worker ? argv.slice(1) : argv;
const replaced = rest[0] === "--" ? rest.slice(1) : [];

if (!worker) {
  spawn(process.execPath, [self, "--worker", ...rest], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();
  process.exit(0);
}

// Through the shell, because on Windows `bun` is often an npm `.cmd` shim,
// which Node will not start without one. The command is a constant, or the
// test's own; no input reaches it.
const command = replaced.length
  ? replaced.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)).join(" ")
  : PUSH;

const result = spawnSync(command, {
  cwd: repoRoot,
  shell: true,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
  timeout: TIMEOUT_MS,
  windowsHide: true,
});

const lines = (text) =>
  (text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

const summary = () => {
  if (result.error) return `failed: ${result.error.message}`;
  if (result.status === 0) {
    const pushed = lines(result.stdout).find((line) => line.startsWith("pushed "));
    return pushed ?? "finished without reporting a push";
  }
  const errors = lines(result.stderr);
  const pushErrors = errors.filter((line) => line.startsWith("Push"));
  const reason = pushErrors.length ? pushErrors.join("; ") : errors.at(-1);
  return `failed (exit ${result.status ?? result.signal}): ${reason ?? "no output"}`;
};

// A URL's userinfo first, then each value wherever else it appears, raw or
// percent-encoded as a URL would carry it.
const redact = (text) => {
  let out = text.replace(/\/\/[^/\s@]*@/g, "//");
  for (const secret of [username, password]) {
    for (const form of new Set([secret, encodeURIComponent(secret)])) {
      out = out.split(form).join("***");
    }
  }
  return out;
};

try {
  const dir = join(homedir(), ".claude-usage-history");
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, "push.log"), `${new Date().toISOString()} ${redact(summary())}\n`);
} catch {
  // A detached worker has no one to report a failure to.
}
