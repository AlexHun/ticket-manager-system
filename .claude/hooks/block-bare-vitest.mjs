// PreToolUse guard: refuses a bare `bunx vitest` / `bun x vitest`.
// Run from the wrong directory it resolves no workspace config and installs
// vitest wherever it stands: during #493 that left a stray
// C:\Users\GAP\node_modules. The workspace script runs it from apps/web with
// that package's config (docs/standards/testing.md). Exit 2 blocks the call
// and hands stderr to Claude as the reason.
import { readFileSync } from "node:fs";

const { tool_input } = JSON.parse(readFileSync(0, "utf8").replace(/^\uFEFF/, ""));
const command = tool_input?.command ?? "";

// Anchored to the start of a line or to a separator, so a message that only
// mentions the command (`gh issue comment --body "… bunx vitest …"`) is not a
// match. Flags between the runner and `vitest` (`bunx --bun vitest`) still are.
const bareVitest = /(?:^|[;&|({]\s*)(?:bunx|bun\s+x)\s+(?:-\S+\s+)*vitest\b/im;

if (bareVitest.test(command)) {
  process.stderr.write(
    "Blocked: a bare `bunx vitest` runs outside the web workspace's config and can install " +
      "vitest wherever it stands. Run `bun run --filter @ticket/web test [files]` instead " +
      "(or the `test:watch` / `test:ui` scripts).\n",
  );
  process.exit(2);
}
