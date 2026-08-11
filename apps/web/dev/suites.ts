/**
 * Runs the repo's checks as child processes and turns their reporter output into
 * the events `/__dev/tests` renders.
 *
 * Two rules shape everything here. The raw output is always forwarded verbatim
 * (ANSI stripped, nothing else) — it is the evidence, and a page that showed
 * only a parsed verdict would be asking to be trusted. And the exit code, never
 * the parse, decides pass/fail: the counts below are a best-effort reading of
 * three different reporters, so when a parser misses, the suite still reports
 * correctly.
 *
 * The commands are fixed constants selected by id from `SUITES` — nothing from
 * the request reaches the command line. That is what makes `shell: true`
 * acceptable, and it is needed on Windows, where `bun` is a PATH shim rather
 * than an executable spawn can find on its own.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  CASE_STATUS,
  SUITE_KIND,
  type CaseResult,
  type CaseStatus,
  type RunCounts,
  type RunEvent,
  type RunSummary,
  type SuiteDescriptor,
  type SuiteKind,
} from "../src/dev/protocol";

interface Suite extends SuiteDescriptor {
  /** Argv, joined by the shell. Kept split so `command` can be rendered
   *  faithfully without quoting guesswork. */
  argv: string[];
  /** Repo-relative working directory. */
  cwd: string;
}

/**
 * The suites, in the order the page offers them: fastest and least stateful
 * first, so "run everything" fails on a broken type before it spends two minutes
 * booting Postgres and a browser.
 *
 * `bun run --filter @ticket/web test` is the form CLAUDE.md documents; note that
 * a filtered run does *not* change directory, which is why nothing here relies
 * on a relative path resolving inside a workspace.
 */
const SUITES: Suite[] = [
  {
    id: "typecheck",
    label: "TypeScript",
    description:
      "tsc across every workspace — the contract in packages/shared and packages/core is only real if this passes.",
    kind: SUITE_KIND.types,
    argv: ["bun", "run", "typecheck"],
    command: "bun run typecheck",
    cwd: ".",
    heavy: false,
  },
  {
    id: "api-unit",
    label: "API unit tests",
    description:
      "bun test in apps/api. The AI module and its route, with the provider, the database and the session all mocked — no key needed.",
    kind: SUITE_KIND.unit,
    argv: ["bun", "run", "--filter", "@ticket/api", "test"],
    command: "bun run --filter @ticket/api test",
    cwd: ".",
    heavy: false,
  },
  {
    id: "web-unit",
    label: "Web component tests",
    description:
      "Vitest + React Testing Library in jsdom. No network, no database — pages render against mocked module boundaries.",
    kind: SUITE_KIND.unit,
    argv: ["bun", "run", "--filter", "@ticket/web", "test"],
    command: "bun run --filter @ticket/web test",
    cwd: ".",
    heavy: false,
  },
  {
    id: "e2e",
    label: "End-to-end (Playwright)",
    description:
      "Drives a real Chromium against its own API on :3002 and web on :4001, backed by the ticket_manager_test database.",
    kind: SUITE_KIND.e2e,
    argv: ["bun", "run", "test:e2e"],
    command: "bun run test:e2e",
    cwd: ".",
    heavy: true,
  },
];

/** What the page is allowed to know: everything but the argv, listed field by
 *  field so a future `Suite` addition cannot leak into the response by accident. */
export const suiteDescriptors: SuiteDescriptor[] = SUITES.map((suite) => ({
  id: suite.id,
  label: suite.label,
  description: suite.description,
  command: suite.command,
  kind: suite.kind,
  heavy: suite.heavy,
}));

export function findSuite(id: string): Suite | undefined {
  return SUITES.find((suite) => suite.id === id);
}

/* ── The child's environment ─────────────────────────────────────────────── */

/** Directories searched for `.env*` files, repo-relative. */
const ENV_FILE_DIRS = [".", "apps/api", "apps/web"];

/** `KEY=` at the start of a line, with or without `export`. */
const ENV_KEY_RE = /^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=/gm;

/**
 * Every variable name the repo's `.env*` files declare, examples included.
 *
 * Read fresh each run rather than cached: adding a variable to `.env.test` should
 * take effect without restarting the dev server.
 */
function configuredKeys(root: string): Set<string> {
  const keys = new Set<string>();

  for (const dir of ENV_FILE_DIRS) {
    let names: string[];
    try {
      names = readdirSync(path.join(root, dir));
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.startsWith(".env")) continue;
      try {
        const text = readFileSync(path.join(root, dir, name), "utf8");
        for (const m of text.matchAll(ENV_KEY_RE)) keys.add(m[1]!);
      } catch {
        // A directory named `.env`, or a file we may not read. Not fatal.
      }
    }
  }

  return keys;
}

/**
 * Bun's `--bun` shim directory, as in `%TEMP%\bun-node-bf2e2cec\node.exe`.
 *
 * `bunx --bun vite` — how this dev server is started — implements "--bun" by
 * putting a fake `node` on PATH and pointing `NODE` at it, so anything the server
 * spawns that shells out to `node` gets Bun instead. That is right for Vite and
 * catastrophic for a test runner: Vitest launches each worker as
 * `node --require …/vitest/suppress-warnings.cjs`, Bun reads that path as a
 * package name and tries to *install* it ("git fetch … InstallFailed cloning
 * repository"), every worker dies, and the failure surfaces three layers away as
 * `TypeError: undefined is not an object (evaluating 'z.object')` — a module that
 * half-loaded. It very likely broke `dotenv-cli` in the E2E suite the same way,
 * which is why that run's API came up on 3001 with no `.env.test` applied.
 *
 * Removing the shim is what makes a run from this page behave like a run from a
 * terminal, which is the whole promise of the page.
 */
function isBunNodeShimDir(entry: string): boolean {
  const trimmed = entry.replace(/[\\/]+$/, "");
  return path.basename(trimmed).toLowerCase().startsWith("bun-node-");
}

/**
 * The environment a suite runs in.
 *
 * Three subtractions from the OS environment, each for its own reason.
 *
 * **Every key the repo's `.env*` files declare.** `dotenv-cli` does not override a
 * variable that is already set, and this dev server's process carries the app's
 * configuration — so an inherited `PORT` beats `.env.test`'s and the E2E API binds
 * the development port. `DATABASE_URL` is the same mechanism with a far worse
 * ending: the suite's database reset would run against the development database.
 * Stripping the declared keys rather than a hand-kept list keeps this correct when
 * someone adds a variable. `NODE_ENV` goes with them, so Vitest and Playwright
 * each choose their own instead of inheriting `development` from Vite.
 *
 * **Bun's `node` shim**, per the note above.
 *
 * **`npm_*` and `NODE`.** These describe the script that started the *dev server*
 * (`npm_lifecycle_script=vite`, `npm_package_name=…`). A nested run that reads them
 * is being told it is something it is not.
 *
 * Everything a child actually needs — PATH itself, SystemRoot, USERPROFILE — is
 * left alone.
 */
function childEnv(root: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // Belt and braces with the ANSI stripping: quieter output beats cleaning it
    // up afterwards.
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    // Deliberately *not* CI=1. `playwright.config.ts` reads it to switch
    // reporters, enable retries and stop reusing a running server — all of which
    // would make this button behave unlike the terminal command it claims to run.
  };

  for (const key of configuredKeys(root)) delete env[key];

  delete env.NODE;
  for (const key of Object.keys(env)) {
    if (key.startsWith("npm_")) delete env[key];
  }

  // Windows spells it `Path`, and a process can carry both.
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() !== "path") continue;
    env[key] = (env[key] ?? "")
      .split(path.delimiter)
      .filter((entry) => entry.length > 0 && !isBunNodeShimDir(entry))
      .join(path.delimiter);
  }

  return env;
}

/* ── Output cleanup ─────────────────────────────────────────────────────── */

/**
 * Colour and cursor escapes, stripped so the log renders as text.
 *
 * The pattern is assembled from a char code rather than written with an inline
 * escape, which keeps a raw ESC byte out of this file — an invisible control
 * character in source survives neither review nor a copy/paste round trip. The
 * literal `[` is written as the class `[[]` for the same reason: no backslash to
 * lose. Only CSI is handled — off a TTY, with NO_COLOR set on the child, that is
 * the whole of what these reporters emit.
 */
const ANSI_RE = new RegExp(String.fromCharCode(27) + "[[][0-9;?]*[ -/]*[@-~]", "g");

function clean(text: string): string {
  return text.replace(ANSI_RE, "").replace(/\r/g, "");
}

/**
 * A `bun run --filter` workspace prefix, as in `@ticket/web test: RUN v4.1.7`.
 *
 * Bun stamps it on every line of a filtered run, which quietly defeated all three
 * parsers below — they anchor on the line start, and `✓ src/foo.test.tsx` never
 * appears there. It is stripped for *parsing only*: the displayed log keeps the
 * prefix, both because it is the real output and because `bun run typecheck` runs
 * four workspaces at once and the prefix is the only thing saying which one is
 * talking.
 *
 * Anchored on a leading `@`, which every package in this repo has and no
 * reporter's own output does.
 */
const WORKSPACE_PREFIX_RE = /^@[^\s:]+ [^\s:]+: /;

function forParsing(line: string): string {
  return line.replace(WORKSPACE_PREFIX_RE, "");
}

/* ── Parsers ────────────────────────────────────────────────────────────── */

/**
 * `✓`/`✔` pass, `×`/`✘`/`✗` fail, `↓`/`-` skip. Three reporters, one map.
 *
 * `❯` is deliberately absent. Vitest uses it for a file that is *still running* —
 * `❯ src/pages/UsersPage.test.tsx (0 test)` — and also for a finished file that
 * failed, distinguished only by a `| N failed` inside the parentheses. Reading the
 * glyph alone reported five passing files as failures on a slow run, which is why
 * `pushVitest` decides that case from the parentheses instead.
 */
const SYMBOL_STATUS: Record<string, CaseStatus> = {
  "✓": CASE_STATUS.passed,
  "✔": CASE_STATUS.passed,
  "×": CASE_STATUS.failed,
  "✘": CASE_STATUS.failed,
  "✗": CASE_STATUS.failed,
  "↓": CASE_STATUS.skipped,
  "-": CASE_STATUS.skipped,
};

/** The in-progress marker, which is not a result. */
const VITEST_RUNNING = "❯";

const VITEST_FILE_RE =
  /^\s*([✓×✗❯↓])\s+(\S+\.(?:test|spec)\.tsx?)\s*\((\d+)\s+tests?([^)]*)\)(?:\s+(\d+(?:\.\d+)?)(ms|s))?/;
const VITEST_TOTAL_RE = /^\s*(Test Files|Tests)\s+(.+?)\s*$/;
/**
 * `bun test`'s totals, which is all it prints when a run is piped and passing —
 * ` 49 pass`, ` 0 fail`, one per line, and no per-file lines to build case rows
 * from.
 *
 * The `\b` is what keeps this off Vitest's own summary: "passed" and "failed"
 * carry on past the word, so only Bun's bare `pass`/`fail`/`skip` match.
 */
const BUN_TOTAL_RE = /^\s*(\d+)\s+(pass|fail|skip)\b/;
const PLAYWRIGHT_CASE_RE =
  /^\s*([✓✔✘×✗-])\s+\d+\s+(.+?)(?:\s+\((\d+(?:\.\d+)?)(ms|s)\))?\s*$/;
const PLAYWRIGHT_TOTAL_RE = /^\s*(\d+)\s+(passed|failed|skipped|flaky|did not run)\b/;
const TSC_ERROR_RE = /error TS\d+:/;
const TSC_TOTAL_RE = /^\s*Found (\d+) errors?/;

function toMs(value: string | undefined, unit: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(unit === "s" ? n * 1000 : n) : null;
}

function emptyCounts(): RunCounts {
  return { passed: 0, failed: 0, skipped: 0, total: 0 };
}

/** `1 failed | 27 passed (28)` → counts. The parenthesised total wins over the
 *  sum, because Vitest counts todo/skipped tests there that it does not list. */
function parseVitestCounts(segment: string): RunCounts {
  const counts = emptyCounts();
  for (const m of segment.matchAll(/(\d+)\s+(passed|failed|skipped|todo)/g)) {
    const n = Number(m[1]);
    if (m[2] === "passed") counts.passed += n;
    else if (m[2] === "failed") counts.failed += n;
    else counts.skipped += n;
  }
  const total = /\((\d+)\)/.exec(segment);
  counts.total = total ? Number(total[1]) : counts.passed + counts.failed + counts.skipped;
  return counts;
}

/**
 * Accumulates whatever the reporter happens to say.
 *
 * One object per run, fed one line at a time. It is deliberately additive and
 * never throws: a reporter change makes the counts go quiet, not wrong.
 */
class RunParser {
  private readonly cases: CaseResult[] = [];
  private files: RunCounts | null = null;
  private tests: RunCounts | null = null;
  private errors: number | null = null;

  constructor(private readonly kind: SuiteKind) {}

  /** Returns a case to emit, when this line described one. */
  push(line: string): CaseResult | null {
    if (this.kind === SUITE_KIND.types) return this.pushTypecheck(line);
    if (this.kind === SUITE_KIND.unit) return this.pushVitest(line);
    return this.pushPlaywright(line);
  }

  private pushTypecheck(line: string): null {
    if (TSC_ERROR_RE.test(line)) this.errors = (this.errors ?? 0) + 1;
    const total = TSC_TOTAL_RE.exec(line);
    if (total) this.errors = Number(total[1]);
    return null;
  }

  private pushVitest(line: string): CaseResult | null {
    const total = VITEST_TOTAL_RE.exec(line);
    if (total) {
      const counts = parseVitestCounts(total[2]!);
      if (total[1] === "Test Files") this.files = counts;
      else this.tests = counts;
      return null;
    }

    // Both unit suites land here; Bun only ever contributes totals.
    const bun = BUN_TOTAL_RE.exec(line);
    if (bun) {
      const counts = this.tests ?? emptyCounts();
      const n = Number(bun[1]);
      if (bun[2] === "pass") counts.passed += n;
      else if (bun[2] === "fail") counts.failed += n;
      else counts.skipped += n;
      counts.total = counts.passed + counts.failed + counts.skipped;
      this.tests = counts;
      return null;
    }

    const m = VITEST_FILE_RE.exec(line);
    if (!m) return null;

    const failed = /\d+\s+failed/.test(m[4] ?? "");
    // A `❯` with nothing in the parentheses is progress, not a verdict. Emitting
    // it would put a row on the page that says a passing file failed.
    if (m[1] === VITEST_RUNNING && !failed) return null;

    const result: CaseResult = {
      name: m[2]!,
      status: failed ? CASE_STATUS.failed : (SYMBOL_STATUS[m[1]!] ?? CASE_STATUS.passed),
      tests: Number(m[3]),
      durationMs: toMs(m[5], m[6]),
    };
    this.cases.push(result);
    return result;
  }

  private pushPlaywright(line: string): CaseResult | null {
    const total = PLAYWRIGHT_TOTAL_RE.exec(line);
    if (total) {
      const counts = this.tests ?? emptyCounts();
      const n = Number(total[1]);
      if (total[2] === "passed") counts.passed += n;
      else if (total[2] === "failed" || total[2] === "flaky") counts.failed += n;
      else counts.skipped += n;
      counts.total = counts.passed + counts.failed + counts.skipped;
      this.tests = counts;
      return null;
    }

    const m = PLAYWRIGHT_CASE_RE.exec(line);
    if (!m) return null;
    // Playwright numbers every spec line; anything without a `›` is chrome.
    if (!m[2]!.includes("›")) return null;
    const result: CaseResult = {
      name: m[2]!.trim(),
      status: SYMBOL_STATUS[m[1]!] ?? CASE_STATUS.passed,
      tests: null,
      durationMs: toMs(m[3], m[4]),
    };
    this.cases.push(result);
    return result;
  }

  summary(): RunSummary {
    // Fall back to the cases actually seen when the reporter printed no totals —
    // a cancelled run, most often.
    let tests = this.tests;
    if (!tests && this.cases.length > 0) {
      tests = emptyCounts();
      for (const c of this.cases) {
        if (c.status === CASE_STATUS.passed) tests.passed += 1;
        else if (c.status === CASE_STATUS.failed) tests.failed += 1;
        else tests.skipped += 1;
      }
      tests.total = this.cases.length;
    }
    return { files: this.files, tests, errors: this.errors };
  }
}

/* ── Running ─────────────────────────────────────────────────────────────── */

/**
 * Kill the whole tree, not just the shell.
 *
 * `shell: true` means the direct child is cmd.exe, and `child.kill()` reaps only
 * that — leaving Vitest, or Playwright's two dev servers, running and holding
 * ports 3002/4001. `taskkill /T` is the only thing on Windows that takes the
 * descendants with it.
 */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    child.kill("SIGKILL");
  }
}

export interface RunHandle {
  cancel: () => void;
}

/**
 * Spawn one suite, streaming events until it exits.
 *
 * `emit` is called with every event including the terminal `end`, after which it
 * is never called again — the caller can close the SSE response on it.
 */
export function runSuite(
  suite: Suite,
  root: string,
  emit: (event: RunEvent) => void,
): RunHandle {
  const startedAt = Date.now();
  const parser = new RunParser(suite.kind);
  let cancelled = false;
  let finished = false;

  emit({
    type: "start",
    suite: suite.id,
    command: suite.command,
    cwd: suite.cwd,
    startedAt,
  });

  const child = spawn(suite.argv[0]!, suite.argv.slice(1), {
    // `suite.cwd` is repo-relative and was previously declared but not applied —
    // every suite ran at the root whatever it said.
    cwd: path.join(root, suite.cwd),
    shell: true,
    windowsHide: true,
    env: childEnv(root),
  });

  const finish = (exitCode: number | null): void => {
    if (finished) return;
    finished = true;
    const summary = parser.summary();
    // tsc prints nothing at all when it is happy, so a clean typecheck has no
    // diagnostics to count and the card would show no number. Exit code 0 from
    // tsc *means* zero errors — this states it rather than leaving a blank.
    if (suite.kind === SUITE_KIND.types && exitCode === 0 && summary.errors === null) {
      summary.errors = 0;
    }
    emit({
      type: "end",
      suite: suite.id,
      // A cancelled run is never "ok", whatever the shell reports on the way out.
      ok: !cancelled && exitCode === 0,
      exitCode,
      cancelled,
      durationMs: Date.now() - startedAt,
      summary,
    });
  };

  const reader = (stream: "out" | "err") => {
    let pending = "";
    return (chunk: Buffer): void => {
      pending += clean(chunk.toString("utf8"));
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const text of lines) {
        // The line goes out verbatim and the parser gets a de-prefixed copy —
        // see the note on WORKSPACE_PREFIX_RE.
        emit({ type: "line", text, stream });
        const result = parser.push(forParsing(text));
        if (result) emit({ type: "case", case: result });
      }
    };
  };

  child.stdout?.on("data", reader("out"));
  child.stderr?.on("data", reader("err"));

  child.on("error", (err) => {
    emit({ type: "error", message: `Could not start \`${suite.command}\`: ${err.message}` });
    finish(null);
  });
  child.on("close", (code) => finish(code));

  return {
    cancel: () => {
      if (finished || cancelled) return;
      cancelled = true;
      emit({ type: "line", text: "", stream: "out" });
      emit({ type: "line", text: "— cancelled from the dev tools page —", stream: "err" });
      killTree(child);
    },
  };
}
