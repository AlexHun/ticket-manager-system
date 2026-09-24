/**
 * The environment, and the repo root, that anything spawned from the dev server
 * gets.
 *
 * Split out of `suites.ts` when a second spawner arrived: `issues.ts` shells out
 * to `gh` for issue titles and forecast labels, and the sanitiser below is not
 * optional for it either — a `gh` call is a spawn like any other. Importing it
 * from `suites.ts` would have dragged the whole test runner (and its `spawn`
 * machinery) into `bun run tokens`'s import graph for the sake of one function.
 *
 * Nothing here is specific to a test run; every reason each subtraction exists
 * is on `childEnv` itself.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { BASIC_AUTH_ENV } from "./basic-auth.ts";

/**
 * The repo root, as this directory knows it: `apps/web/dev` → three up.
 *
 * Lives here because every spawner needs it and one of them needs it for a
 * reason that is easy to get wrong. `process.cwd()` is *not* interchangeable
 * with it — the Vite dev server's cwd is `apps/web` — which cost the Usage page
 * a shipped bug (see the usage route in `plugin.ts`), and `gh` resolves the
 * repo from the git remote of the directory it is spawned in, so a `gh` child
 * started anywhere else answers about a different repository or not at all
 * (#249).
 */
export const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

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
 * Four subtractions from the OS environment, each for its own reason.
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
 * **The basic-auth gate's variables** (`basic-auth.ts`). On Railway's develop
 * service they are service variables rather than `.env` keys, so the first rule
 * misses them; no suite needs the password, and a child cannot print what it
 * was never handed.
 *
 * Everything a child actually needs — PATH itself, SystemRoot, USERPROFILE — is
 * left alone.
 */
export function childEnv(root: string): NodeJS.ProcessEnv {
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
  for (const key of Object.values(BASIC_AUTH_ENV)) delete env[key];
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
