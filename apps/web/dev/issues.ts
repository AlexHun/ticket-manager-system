// Issue titles, links and forecast labels, from `gh`.
//
// The other half of the Usage page: `usage.ts` reads what was *spent* off the
// filesystem, this reads what was *forecast* off GitHub, and `gatherUsage`
// joins them on the issue number. Split because the two have nothing in common
// but that number — different source, different dependency (`child_process`),
// and, above all, different failure modes. Transcripts that cannot be read mean
// there is nothing to report; a `gh` that cannot be reached means the actuals
// stand and only the forecast columns go unknown. Keeping them apart is what
// lets the second failure be that small.
//
// **One call, not one per issue.** `gh issue list --state all --limit 500`
// returns every issue in ~1.7s; `gh issue view` costs ~0.9s *each*, which for
// this repo's issue count is a minute and forty-five seconds of page load.
// Measured in #249, which also established that `gh` authenticates fine from a
// process spawned by the Vite dev server — its credential comes from the OS
// credential store, so nothing `childEnv` strips can reach it, and no `.env*`
// file here declares a GitHub token in the first place.

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { BUCKETS, type Bucket } from "../src/dev/protocol.ts";
import { REPO_ROOT, childEnv } from "./child-env.ts";

/**
 * Environment variable naming a file to read the issue listing from, instead of
 * asking `gh`.
 *
 * The same kind of seam as `CLAUDE_TRANSCRIPT_DIR` next door and for the same
 * reason: what this repo's issues are actually titled, and which of them are
 * labelled, is not something an assertion can name — it changes every time
 * somebody files one. The file holds exactly what `gh issue list --json …`
 * prints, so the fixture path and the real path parse through the same code.
 *
 * **It never falls back.** A file that is set and unreadable degrades, rather
 * than quietly reaching for `gh`: the fallback would make `dev-usage.spec.ts`'s
 * degraded case read live GitHub, and pass or fail depending on whose machine
 * it ran on.
 */
export const ISSUES_FILE_ENV = "GH_ISSUES_FILE";

/** How long `gh` gets before it is killed. A hung child would otherwise be a
 *  Scan that never finishes, with nothing on screen saying why. */
const GH_TIMEOUT_MS = 20_000;

/** Room for the listing. `gh`'s labels carry a description and a colour each,
 *  so a repo with hundreds of issues prints a few hundred KB; the default 1MB
 *  is not far away, and overrunning it fails as a truncated-JSON parse error
 *  rather than as anything that names the cause. */
const GH_MAX_BUFFER = 10_000_000;

const execFileAsync = promisify(execFile);

const FORECAST_PREFIX = "forecast/";

/**
 * The two states `gh issue list --state all` reports.
 *
 * A const object rather than two bare strings, matching `LAYER`, `GUARD` and
 * `VERDICT` in `protocol.ts` and for the same reason: `bun run tokens --open`
 * filters on this word, and a comparison against a mistyped literal does not
 * fail — it silently reports no open issues.
 */
export const ISSUE_STATE = { open: "OPEN", closed: "CLOSED" } as const;

export type IssueState = (typeof ISSUE_STATE)[keyof typeof ISSUE_STATE];

/** What GitHub knows about one issue that the transcripts cannot. */
export interface IssueMeta {
  title: string;
  /** Straight from `gh`, rather than assembled from an owner and repo this
   *  module would otherwise have to carry a copy of. */
  url: string;
  /** Not on the wire — `bun run tokens --open` filters on it, and the page has
   *  no column for it. */
  state: IssueState;
  /** The band its `forecast/S|M|L` label names, or null when it carries none. */
  forecast: Bucket | null;
}

/**
 * What one attempt to read the issue listing produced.
 *
 * `byIssue` is `null` rather than empty when nothing could be read, and the
 * distinction is the whole point: an empty map says GitHub knows of no issues,
 * which would make every row's forecast legitimately unknown *and* would say
 * the listing worked. A null says the question could not be asked, and
 * `warning` says why, in a sentence the page shows.
 */
export interface IssueMetadata {
  byIssue: Map<number, IssueMeta> | null;
  warning: string | null;
}

/** The fields this reads off the listing; `gh` prints more and they are
 *  ignored. Hand-written because `gh` ships no types for its JSON. */
interface GhIssue {
  number: number;
  title: string;
  state: string;
  url: string;
  labels: { name: string }[];
}

/** Runs the listing and resolves with `gh`'s stdout. Injected in tests, which
 *  have no business needing this machine to be authenticated. */
export type IssueLister = () => Promise<string>;

/**
 * What `listIssues` asks of `execFile`, narrowed to the one call it makes.
 *
 * Its reason for existing is that `listIssues` below is the only part of this
 * module a test cannot otherwise reach — `fetchIssueMetadata` takes an
 * `IssueLister`, so every test injects past it, and the argv, the `cwd` and the
 * sanitised environment go unasserted. Those three are exactly what #249 warned
 * is easy to break by moving the call: one `issue list` rather than a loop of
 * `issue view`, a `cwd` inside the repo, and `childEnv` rather than the dev
 * server's own environment.
 */
export type Spawn = (
  file: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    encoding: "utf8";
    timeout: number;
    maxBuffer: number;
  },
) => Promise<{ stdout: string }>;

/**
 * Ask `gh` for every issue, open and closed.
 *
 * `cwd` is the repo root and that is load-bearing, not tidiness: `gh` resolves
 * which repository it is talking about from the git remote of the directory it
 * runs in, and the Vite dev server's own cwd is `apps/web`. The environment is
 * `childEnv`'s, because anything spawned from the dev server sanitises first —
 * a `gh` call is a spawn like any other, and the `--bun` shim it removes is on
 * the PATH of every child this server starts.
 *
 * **Asynchronous, and not as a matter of taste.** The obvious version is
 * `execFileSync`, and it is wrong here twice over. It blocks the thread Vite
 * serves every other request on for as long as `gh` takes — ~1.8s of network
 * on this repo, during which the dev server answers nothing. And its `timeout`
 * option does not work in that process: measured 2026-09-17, a dev-server Scan
 * came back in 2.4s with `spawnSync gh ETIMEDOUT`, `signal=SIGTERM` and empty
 * stderr — the child killed at once rather than after the 20 seconds it was
 * given, so the page degraded to "no `gh`" on every press while `bun run
 * tokens`, running the identical call from a plain Bun process, succeeded. The
 * dev server runs under `bunx --bun vite`, so the middleware executes on Bun's
 * runtime; only the synchronous spawn misbehaves there. Both problems are the
 * same fix, and the timeout below is honoured.
 *
 * Exported, and takes its spawn, so `issues.test.ts` can assert all of that
 * without this machine having to be authenticated — see `Spawn`.
 */
export const listIssues = async (
  spawn: Spawn = execFileAsync,
): Promise<string> => {
  const { stdout } = await spawn(
    "gh",
    [
      "issue",
      "list",
      "--state",
      "all",
      "--limit",
      "500",
      "--json",
      "number,title,state,url,labels",
    ],
    {
      cwd: REPO_ROOT,
      env: childEnv(REPO_ROOT),
      encoding: "utf8",
      timeout: GH_TIMEOUT_MS,
      maxBuffer: GH_MAX_BUFFER,
    },
  );
  return stdout;
};

/** The band a label set names, if it names one this repo's bands recognise. */
function forecastOf(labels: { name: string }[]): Bucket | null {
  const named = labels
    .map((label) => label.name)
    .find((name) => name.startsWith(FORECAST_PREFIX))
    ?.slice(FORECAST_PREFIX.length);
  return named && named in BUCKETS ? (named as Bucket) : null;
}

function parseListing(raw: string): Map<number, IssueMeta> {
  const issues = JSON.parse(raw) as GhIssue[];
  if (!Array.isArray(issues)) throw new Error("expected a JSON array");
  return new Map(
    issues.map((issue) => [
      issue.number,
      {
        title: issue.title,
        url: issue.url,
        // Narrowed rather than trusted: `gh` prints one of two words here, and
        // anything else is treated as not-open so a surprise cannot make
        // `--open` list something that is closed.
        state:
          issue.state === ISSUE_STATE.open
            ? ISSUE_STATE.open
            : ISSUE_STATE.closed,
        forecast: forecastOf(issue.labels ?? []),
      },
    ]),
  );
}

/**
 * Why the listing could not be read, in a phrase the warning can carry.
 *
 * The timeout case needs its own sentence because Node does not give it one: a
 * child killed by `timeout` rejects with `Command failed: gh issue list …` and
 * nothing else — the reason lives in `killed`/`signal`, and stderr is empty
 * because the child never got to write any. Repeating the command back to
 * someone who pressed Scan explains nothing; how long it waited does.
 */
const reason = (err: unknown) => {
  const killed = (err as { killed?: boolean } | null)?.killed;
  if (killed) return `no answer within ${GH_TIMEOUT_MS}ms`;
  return err instanceof Error ? err.message : String(err);
};

/** What is lost when the listing cannot be read. Appended to every warning so
 *  the sentence on screen says what it costs, not just what happened. */
const COST = "titles, links and forecast bands read as unknown.";

/**
 * One reading of the issue listing — from the override file when set, from `gh`
 * otherwise.
 *
 * **Nothing here throws**, for the same reason `gatherUsage` does not: `gh`
 * being missing, unauthenticated or offline is an ordinary state (it is the
 * state CI is in), and it costs three columns rather than the page. The
 * actuals are read off the filesystem and do not depend on any of this.
 */
export async function fetchIssueMetadata(
  env: Record<string, string | undefined> = process.env,
  run: IssueLister = listIssues,
): Promise<IssueMetadata> {
  const file = env[ISSUES_FILE_ENV]?.trim();

  try {
    const raw = file ? await readFile(file, "utf8") : await run();
    return { byIssue: parseListing(raw), warning: null };
  } catch (err) {
    return {
      byIssue: null,
      warning: file
        ? `Could not read the issue listing at ${file} (${ISSUES_FILE_ENV}): ${reason(err)} — ${COST}`
        : `\`gh\` could not list this repository's issues: ${reason(err)} — ${COST}`,
    };
  }
}
