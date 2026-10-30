import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { partialCheckout } from "@ticket/repo-scan/checkout";
import { REPO_ROOT } from "./test/run-hook";

// `.claude/hooks/push-usage.mjs` is the SessionEnd hook that sends this
// laptop's usage history to develop (#557). It is run here as settings.json
// runs it, under `node`, except that the command after `--` stands in for
// `bun run tokens --push <url>`: a fake that prints what the real one prints,
// so no case scans transcripts or reaches the network. Home is a temporary
// directory, so the log it writes is this test's, not the developer's.
// `runHook` is not used for the run itself: it is synchronous and passes no
// environment, and these cases set credentials and start hooks side by side.
const HOOK = path.join(REPO_ROOT, ".claude/hooks/push-usage.mjs");
const USER = "pushuser";
const PASS = "s3cret-pass";

let home: string;
let fake: string;
let marker: string;
const logFile = () => path.join(home, ".claude-usage-history", "push.log");

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "push-usage-"));
  marker = path.join(home, "ran");
  fake = path.join(home, "fake-tokens.mjs");
  writeFileSync(
    fake,
    `import { writeFileSync } from "node:fs";
const [mode, delay = "0"] = process.argv.slice(2);
writeFileSync(${JSON.stringify(marker)}, "");
const url = "https://" + process.env.DEV_BASIC_AUTH_USERNAME + ":" + process.env.DEV_BASIC_AUTH_PASSWORD + "@develop.example.app";
setTimeout(() => {
  console.log("Issue | Title\\n----\\n557 | a table row");
  if (mode === "ok") {
    console.error("gh did not answer, so titles are blank.");
    console.log("pushed 120 responses (3 new) and 40 issues to https://develop.example.app.");
  } else {
    // A server that echoes the request back puts the header's base64 here too.
    const header = Buffer.from(process.env.DEV_BASIC_AUTH_USERNAME + ":" + process.env.DEV_BASIC_AUTH_PASSWORD).toString("base64");
    console.error("Push to " + url + "/__devtools/usage-push failed: 401 Unauthorized (Basic " + header + ")");
    process.exitCode = 1;
  }
}, Number(delay));
`,
  );
});

afterEach(() => rmSync(home, { recursive: true, force: true }));

const run = async (
  credentials: { username?: string; password?: string },
  mode: "ok" | "fail",
  delay = 0,
) => {
  const env: Record<string, string | undefined> = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
  };
  delete env.DEV_BASIC_AUTH_USERNAME;
  delete env.DEV_BASIC_AUTH_PASSWORD;
  if (credentials.username !== undefined)
    env.DEV_BASIC_AUTH_USERNAME = credentials.username;
  if (credentials.password !== undefined)
    env.DEV_BASIC_AUTH_PASSWORD = credentials.password;
  const hook = Bun.spawn(
    ["node", HOOK, "--", "node", fake, mode, String(delay)],
    {
      stdin: Buffer.from(JSON.stringify({ hook_event_name: "SessionEnd" })),
      stderr: "pipe",
      env,
    },
  );
  const [code, stderr] = await Promise.all([
    hook.exited,
    new Response(hook.stderr).text(),
  ]);
  return { code, stderr };
};

// Until the log holds `count` lines, or ten seconds have passed.
const logLines = async (count: number) => {
  const read = () =>
    existsSync(logFile())
      ? readFileSync(logFile(), "utf8").trimEnd().split("\n")
      : [];
  for (let i = 0; i < 100 && read().length < count; i++) await Bun.sleep(100);
  return read();
};

// Each case starts three processes (hook, worker, fake), and a cold `node`
// takes seconds on a Windows dev machine, hence the timeouts.
// The hook is under `.claude/`, which the develop image does not carry.
describe.skipIf(partialCheckout)("push-usage hook", () => {
  test("returns before the push ends, then logs the rows it added", async () => {
    const { code, stderr } = await run(
      { username: USER, password: PASS },
      "ok",
      3000,
    );
    expect(code).toBe(0);
    expect(stderr).toBe("");
    // Had the hook waited, the line would already be written.
    expect(existsSync(logFile())).toBe(false);
    const lines = await logLines(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^\d{4}-\d\d-\d\dT\S+Z pushed 120 responses \(3 new\)/,
    );
  }, 20_000);

  test("does nothing when either credential is unset", async () => {
    const runs = await Promise.all(
      [{ password: PASS }, { username: USER }, {}].map((credentials) =>
        run(credentials, "ok"),
      ),
    );
    expect(runs).toEqual(Array(3).fill({ code: 0, stderr: "" }));
    // Long enough for a worker that was started by mistake to have run.
    await Bun.sleep(2000);
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(logFile())).toBe(false);
  }, 20_000);

  test("appends a failed push without the credentials, and still exits 0", async () => {
    const earlier = "2026-10-15T09:00:00.000Z pushed 1 responses (1 new)";
    mkdirSync(path.dirname(logFile()), { recursive: true });
    writeFileSync(logFile(), `${earlier}\n`);
    const { code, stderr } = await run(
      { username: USER, password: PASS },
      "fail",
    );
    expect(code).toBe(0);
    expect(stderr).toBe("");
    const lines = await logLines(2);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(earlier);
    expect(lines[1]).toContain(
      "failed (exit 1): Push to https://develop.example.app/__devtools/usage-push failed: 401 Unauthorized",
    );
    expect(lines.join("\n")).not.toContain(USER);
    expect(lines.join("\n")).not.toContain(PASS);
    expect(lines[1]).toContain("(Basic ***)");
  }, 20_000);
});
