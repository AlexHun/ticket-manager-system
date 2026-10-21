/**
 * The one git environment cleanup (#566). Every `git` and `gh` process started
 * from `apps/` or `scripts/` takes its environment from `repositoryFreeEnv`, and
 * `apps/api/src/git-spawn-env.test.ts` fails a spawn that does not (R4).
 *
 * Git sets `GIT_DIR` for the hooks it runs, and from a linked worktree
 * `pre-push` reached the doc-citations check with it set: every git call read
 * the worktree being pushed whatever `cwd` said, and that test's scratch
 * repositories were built inside it (#531). `gh` resolves its repository
 * through git the same way, so it takes the same environment.
 *
 * An import-free leaf, like `strip-comments.ts`, so the API's compiler options
 * and Vite's native config loader both read it as it is.
 */

/**
 * The variables that tie git to one repository, as `git rev-parse
 * --local-env-vars` lists them (git 2.52). Written out rather than asked for,
 * because asking is one more git process, ~60ms on Windows, on every caller;
 * `git-env.test.ts` compares it with that command on the machine running it,
 * so a variable a later git adds fails there rather than going missing.
 */
export const GIT_LOCAL_ENV: readonly string[] = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_OBJECT_DIRECTORY",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_GRAFT_FILE",
  "GIT_INDEX_FILE",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_REPLACE_REF_BASE",
  "GIT_PREFIX",
  "GIT_SHALLOW_FILE",
  "GIT_COMMON_DIR",
];

/**
 * A copy of `env` without the variables that name a repository, so a git call
 * asks the one its `cwd` is in. A caller that sanitises for its own reasons
 * first (the dev server's `childEnv`) passes its result in, and keeps them.
 */
export function repositoryFreeEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const free = { ...env };
  for (const name of GIT_LOCAL_ENV) delete free[name];
  return free;
}
