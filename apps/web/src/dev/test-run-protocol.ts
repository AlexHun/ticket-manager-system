/**
 * The test runner's wire contract: the suites `apps/web/dev/suites.ts` can run,
 * and the frames its stream carries to `/__dev/tests`.
 *
 * One of the three contracts `protocol.ts` split into (#284) — see
 * `./devtools-paths` for why it split and where the shared route table went.
 * Nothing here is read by a module that renders `/__dev/map` or
 * `/__dev/usage`, and nothing here reads theirs.
 *
 * It lives under `src/` rather than beside the plugin so the browser half can
 * reach it through the `@/` alias; the node half imports it with a relative
 * path (see `apps/web/dev/suites.ts`), and `apps/web/tsconfig.node.json` lists
 * `dev` precisely so the two ends are typechecked against the same
 * declarations. Types only, and it has no imports of its own and must keep
 * none: the node half reaches it by relative path under Vite's native config
 * loader, which resolves the way Node does.
 *
 * None of this ships: the plugin is registered `apply: "serve"` and every
 * importer of these types sits behind `import.meta.env.DEV`.
 */

export const SUITE_KIND = {
  unit: "unit",
  types: "types",
  e2e: "e2e",
} as const;

export type SuiteKind = (typeof SUITE_KIND)[keyof typeof SUITE_KIND];

export interface SuiteDescriptor {
  id: string;
  label: string;
  /** What it actually checks, in one line. */
  description: string;
  /** The command, verbatim, so the page can show what it is about to run. */
  command: string;
  kind: SuiteKind;
  /**
   * Needs Postgres and its own servers. The page warns before running one and
   * leaves it out of "run everything" unless asked.
   */
  heavy: boolean;
}

export const CASE_STATUS = {
  passed: "passed",
  failed: "failed",
  skipped: "skipped",
} as const;

export type CaseStatus = (typeof CASE_STATUS)[keyof typeof CASE_STATUS];

/** One test file (vitest) or one spec (playwright), as parsed out of the run. */
export interface CaseResult {
  name: string;
  status: CaseStatus;
  /** Assertions inside it, where the reporter says. */
  tests: number | null;
  durationMs: number | null;
}

export interface RunCounts {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
}

export interface RunSummary {
  /** Null for a suite whose reporter counts nothing — a typecheck. */
  files: RunCounts | null;
  tests: RunCounts | null;
  /** Compiler diagnostics, for the typecheck suite. */
  errors: number | null;
}

/**
 * What happened during one suite run.
 *
 * `line` carries the reporter's own output, ANSI already stripped — it is the
 * evidence, and the parsed counts are only a reading of it. Everything else is
 * derived and may be absent; the exit code in `end` is what decides pass/fail.
 */
export type RunEvent =
  | {
      type: "start";
      suite: string;
      command: string;
      cwd: string;
      /** Epoch ms. Carried so the page's elapsed clock is measured from when the
       *  run began rather than from when this tab started watching — the two
       *  differ every time a reload reconnects mid-run. */
      startedAt: number;
    }
  | { type: "line"; text: string; stream: "out" | "err" }
  | { type: "case"; case: CaseResult }
  | {
      type: "end";
      suite: string;
      ok: boolean;
      exitCode: number | null;
      /** Set when the run was cut short from the page. */
      cancelled: boolean;
      durationMs: number;
      summary: RunSummary;
    }
  | { type: "error"; message: string };

/**
 * A frame on the dev tools' one event stream.
 *
 * There is a single stream for the whole page rather than one per run, and the
 * runs live on the server rather than in the browser tab. That is not tidiness —
 * it is what makes a long suite survive a reload.
 *
 * The reason is concrete: starting the Playwright suite launches a second Vite
 * over the same project, which can make *this* dev server re-optimise its
 * dependencies and full-reload the page. With the child process owned by the
 * page's connection, that reload killed the run every time. Owned by the server,
 * the reloaded page reconnects, gets the backlog replayed, and carries on
 * watching. Navigating away no longer cancels anything either — only Cancel does.
 */
export type DevStreamMessage =
  /** `suite` rides in the envelope so the run events themselves stay small. */
  | { kind: "run"; suite: string; event: RunEvent }
  /** Sent on connect and whenever either changes, so a fresh page learns what is
   *  already in flight without a second request. */
  | { kind: "state"; active: string | null; queued: string[] };
