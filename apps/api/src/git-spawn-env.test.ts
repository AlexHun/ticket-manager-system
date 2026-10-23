import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { stripComments } from "@ticket/repo-scan/strip-comments";
import { trackedFiles } from "@ticket/repo-scan/tracked-files";

/**
 * Every `git` and `gh` process started from `apps/` or `scripts/` takes its
 * environment from `repositoryFreeEnv` (`@ticket/repo-scan/git-env`), and this
 * fails one that does not (#566, `docs/prd/one-repo-scanner.md` R4). Git sets
 * `GIT_DIR` for the hooks it runs, so a spawn that inherits it answers for the
 * hook's repository whatever its `cwd` says: #531 was the doc-citations check
 * building its scratch repositories inside the worktree being pushed.
 *
 * **In the API suite** because `.husky/pre-push` runs it, so a new spawn fails
 * the push rather than waiting for CI. It reads the files git tracks under
 * `apps/` and `scripts/` with their comments blanked, so a comment that names
 * a spawn is not one.
 *
 * **What counts as a spawn**: a call to anything named like `spawn` or `exec`
 * (`execFileSync`, `execFileAsync`, `spawn`, `Bun.spawn`, …) whose command is
 * the literal `git` or `gh`, as the first argument, the first element of an
 * argv array, or the first word of a command string. **What counts as clean**:
 * its options' `env` calls `repositoryFreeEnv`, or names a binding in the same
 * file whose initializer or body does, or calls a wrapper in `WRAPPERS` that
 * the file does not declare itself. A name declared more than once must be
 * clean in every declaration, since the check does not know scope. Not seen
 * at all: a command held in a variable, `Bun.spawn({ cmd: […] })`'s object
 * form, and a Bun shell template. None of today's callers uses them.
 */

const REPO_ROOT = path.resolve(import.meta.dir, "../../..");

const ROOTS = ["apps/", "scripts/"];
const SOURCE = /\.[cm]?[jt]sx?$/;

const SPAWN =
  /\b[\w$.]*(?:spawn|exec)[\w$]*\s*\(\s*\[?\s*(["'`])(git|gh)(?:\1|\s)/gi;

const CLEANUP = /\brepositoryFreeEnv\s*\(/;

/**
 * Functions in another module whose whole job is to return the cleanup's
 * result, and the file each is declared in. A call to one is clean; the test
 * below holds each to calling `repositoryFreeEnv` where it is declared.
 */
const WRAPPERS: Record<string, string> = {
  gitEnv: "apps/web/dev/child-env.ts",
};

/** Files whose matches are not spawns, and why. */
const EXEMPT: Record<string, string> = {
  "apps/web/dev/standards-guard.test.ts":
    "a planted synchronous `gh` spawn inside a string, which that guard's rule against synchronous spawns must catch",
};

/** The index past the string literal that opens at `start`. */
function endOfString(code: string, start: number): number {
  const quote = code[start];
  for (let at = start + 1; at < code.length; at += 1) {
    if (code[at] === "\\") at += 1;
    else if (code[at] === quote) return at;
  }
  return code.length;
}

/**
 * The text from `from` up to the first of `stops` met outside any bracket or
 * string, or up to the bracket that closes one opened before `from`.
 */
function until(code: string, from: number, stops: string): string {
  let depth = 0;
  for (let at = from; at < code.length; at += 1) {
    const char = code[at]!;
    if (char === '"' || char === "'" || char === "`") {
      at = endOfString(code, at);
    } else if ("([{".includes(char)) {
      depth += 1;
    } else if (")]}".includes(char)) {
      if (depth === 0) return code.slice(from, at);
      depth -= 1;
    } else if (depth === 0 && stops.includes(char)) {
      return code.slice(from, at);
    }
  }
  return code.slice(from);
}

/** The `env` a call's arguments pass, as written, or `undefined`. */
function envOf(args: string): string | undefined {
  const match = /(?<![\w$.])env\s*(:|(?=[,}\s]))/.exec(args);
  if (!match) return undefined;
  if (match[1] !== ":") return "env";
  return until(args, match.index + match[0].length, ",").trim();
}

/**
 * Every initializer of a binding named `name`, and every function's parameters
 * and body, in `code`. All of them, because the check does not know scope: a
 * clean `env` in one function must not vouch for a raw one in another.
 */
function declarationsOf(name: string, code: string): string[] {
  const found: string[] = [];
  const binding = new RegExp(
    `\\b(?:const|let|var)\\s+${name}\\b[^=;]*=(?!=)`,
    "g",
  );
  for (const match of code.matchAll(binding)) {
    found.push(until(code, match.index + match[0].length, ";"));
  }
  const fn = new RegExp(`\\bfunction\\s+${name}\\s*\\(`, "g");
  for (const match of code.matchAll(fn)) {
    const opens = match.index + match[0].length;
    const params = until(code, opens, "");
    const body = code.indexOf("{", opens + params.length + 1);
    found.push(body < 0 ? params : `${params} ${until(code, body + 1, "")}`);
  }
  return found;
}

function fromCleanup(
  expression: string,
  code: string,
  seen: ReadonlySet<string> = new Set(),
): boolean {
  if (CLEANUP.test(expression)) return true;
  const name = /^([A-Za-z_$][\w$]*)\s*(?:\(.*\))?$/s.exec(expression)?.[1];
  if (!name || seen.has(name)) return false;
  // A name the file declares itself means those declarations, even when a
  // wrapper elsewhere shares it, so a local `gitEnv` that removes only some of
  // the variables is not taken for the shared one.
  const declared = declarationsOf(name, code);
  if (declared.length === 0) return Object.hasOwn(WRAPPERS, name);
  const inner = new Set([...seen, name]);
  return declared.every((text) => fromCleanup(text.trim(), code, inner));
}

/** Every git or gh spawn in `code` whose environment is not the cleanup's. */
function offendingSpawns(code: string): string[] {
  const found: string[] = [];
  for (const match of code.matchAll(SPAWN)) {
    const open = code.indexOf("(", match.index);
    const env = envOf(until(code, open + 1, ""));
    if (env !== undefined && fromCleanup(env, code)) continue;
    const line = code.slice(0, match.index).split("\n").length;
    found.push(
      env === undefined
        ? `${line}: ${match[2]} with no env`
        : `${line}: ${match[2]} with env ${env}`,
    );
  }
  return found;
}

/** How many git or gh spawns `code` makes, clean or not. */
const spawnCount = (code: string) => [...code.matchAll(SPAWN)].length;

const FILES = trackedFiles(REPO_ROOT).filter(
  (file) => ROOTS.some((root) => file.startsWith(root)) && SOURCE.test(file),
);
const read = (file: string) =>
  stripComments(readFileSync(path.join(REPO_ROOT, file), "utf8")).code;

test("the check reads the tree it means to", () => {
  // 473 when #566 wrote this check.
  expect(FILES.length).toBeGreaterThan(400);
  const spawning = FILES.filter((file) => spawnCount(read(file)) > 0);
  // The callers #566 moved onto the cleanup, so a file list that lost them, or
  // a matcher that stopped seeing them, fails here rather than passing empty.
  expect(spawning).toEqual(
    expect.arrayContaining([
      "apps/api/src/doc-citations.ts",
      "apps/api/src/doc-citations.test.ts",
      "apps/web/dev/issues.ts",
      "apps/web/dev/usage-store.ts",
      "apps/web/dev/usage-store.test.ts",
      "apps/web/vite.config.ts",
    ]),
  );
});

test("every git and gh spawn under apps/ and scripts/ runs without a repository's variables", () => {
  const offending = FILES.filter((file) => !Object.hasOwn(EXEMPT, file))
    .flatMap((file) => offendingSpawns(read(file)).map((at) => `${file}:${at}`))
    .sort();
  expect(offending).toEqual([]);
});

test("each exemption names a tracked file that still has something to exempt", () => {
  for (const [file, reason] of Object.entries(EXEMPT)) {
    expect(reason.length).toBeGreaterThan(0);
    expect(FILES).toContain(file);
    expect(spawnCount(read(file))).toBeGreaterThan(0);
  }
});

test("each wrapper returns the cleanup's result where it is declared", () => {
  for (const [name, file] of Object.entries(WRAPPERS)) {
    const declared = declarationsOf(name, read(file));
    expect(declared).toHaveLength(1);
    expect(CLEANUP.test(declared[0]!)).toBe(true);
  }
});

/**
 * A planted call, assembled so this file's own source holds no spawn of git or
 * gh for the check above to read.
 */
const planted = (spawner: string, command: string, rest: string) =>
  stripComments(`${spawner}(${rest.replace("CMD", `"${command}"`)});`).code;

describe("the matcher", () => {
  test.each([
    ["no env", planted("execFileSync", "git", 'CMD, ["status"]')],
    [
      "the raw process environment",
      planted("spawn", "gh", 'CMD, ["issue", "list"], { env: process.env }'),
    ],
    [
      "the process environment spread",
      planted(
        "execFileAsync",
        "git",
        'CMD, args, { cwd, env: { ...process.env, A: "1" } }',
      ),
    ],
    [
      "an argv array with no env",
      planted("Bun.spawn", "git", "[CMD], { cwd }"),
    ],
    [
      "a command string",
      planted("execSync", "git", "CMD").replace('"git"', '"git status"'),
    ],
    [
      "a local function that shares a wrapper's name",
      `function gitEnv() {\n  const env = { ...process.env };\n  delete env.GIT_DIR;\n  return env;\n}\n${planted("execFileAsync", "git", "CMD, args, { cwd, env: gitEnv() }")}`,
    ],
    [
      "a raw binding that shares its name with a clean one elsewhere in the file",
      `function clean() {\n  const env = repositoryFreeEnv();\n  return env;\n}\nfunction raw() {\n  const env = { ...process.env };\n  ${planted("execFileSync", "git", "CMD, args, { env }")}\n}`,
    ],
    [
      "a local binding that is not the cleanup",
      `const env = { ...process.env };\n${planted("execFileSync", "git", "CMD, args, { env }")}`,
    ],
  ])("catches a spawn with %s", (_, code) => {
    expect(offendingSpawns(code)).toHaveLength(1);
  });

  test.each([
    [
      "the cleanup",
      planted("execFileSync", "git", "CMD, args, { env: repositoryFreeEnv() }"),
    ],
    [
      "a local binding built on it",
      `const env = {\n  ...repositoryFreeEnv(),\n  A: "1",\n};\n${planted("execFileSync", "git", 'CMD, args, { cwd, env, encoding: "utf8" }')}`,
    ],
    [
      "a wrapper",
      planted("spawn", "gh", "CMD, args, { cwd: ROOT, env: gitEnv(ROOT) }"),
    ],
    [
      "a local function returning it",
      `function cleanEnv() {\n  return repositoryFreeEnv(childEnv(root));\n}\n${planted("execFile", "git", "CMD, args, { env: cleanEnv() }")}`,
    ],
  ])("passes a spawn with %s", (_, code) => {
    expect(spawnCount(code)).toBe(1);
    expect(offendingSpawns(code)).toEqual([]);
  });

  test.each([
    ["an assertion on the command", 'expect(file).toBe("gh");'],
    [
      "a spawn of something else",
      'spawn("bun", ["test"], { env: process.env });',
    ],
    [
      "a spawn in a comment",
      stripComments(`// ${planted("execFileSync", "git", "CMD, args")}`).code,
    ],
  ])("ignores %s", (_, code) => {
    expect(spawnCount(code)).toBe(0);
  });
});
