/**
 * Whether the tests run in a tree that is not a full checkout of the repository.
 *
 * `apps/web/Dockerfile.dev` sets it (#585). That image copies only the
 * workspaces and the root manifests, and the root `.dockerignore` keeps `.git`
 * out besides, so `.git`, `.claude/`, `.mcp.json`, the Markdown docs and
 * `tests/` are absent and there is no `git`. The tests that read those, or
 * start `git`, cannot pass there. They skip under it, and only under it:
 * nothing infers the state from a file being missing, so a file that goes
 * missing from a clone or from CI still fails the test that reads it.
 */
export const PARTIAL_CHECKOUT_ENV = "PARTIAL_CHECKOUT";

export const partialCheckout = process.env[PARTIAL_CHECKOUT_ENV] === "1";

/** Printed once per run under it, so a skipped test is not a silent one. */
export const PARTIAL_CHECKOUT_NOTE = `${PARTIAL_CHECKOUT_ENV}=1: the tests that read .git, .claude/, .mcp.json, the Markdown docs or tests/, or that start git, are skipped, because this image has none of them (apps/web/Dockerfile.dev).`;
