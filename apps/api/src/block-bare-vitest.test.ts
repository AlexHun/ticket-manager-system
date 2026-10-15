import { describe, expect, test } from "bun:test";
import path from "node:path";

// `.claude/hooks/block-bare-vitest.mjs` is a PreToolUse hook: it reads the tool
// call as JSON on stdin and exits 2, with the reason on stderr, to block it.
// Run it as `.claude/settings.json` does — under `node`, one process per call.
// It reads only `tool_input.command`, so every case is sent as a Bash call; the
// same hook is registered for PowerShell.
const hook = path.resolve(
  import.meta.dir,
  "../../../.claude/hooks/block-bare-vitest.mjs",
);

const run = (command: string) => {
  const result = Bun.spawnSync(["node", hook], {
    stdin: Buffer.from(
      JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
    ),
  });
  return { code: result.exitCode, stderr: result.stderr.toString() };
};

describe("block-bare-vitest hook", () => {
  test.each([
    "bunx vitest run src/pages/UsersPage.test.tsx",
    "bun x vitest run",
    "bunx --bun vitest",
    "bunx.exe vitest",
    "cd apps/web && bunx vitest run",
    "Set-Location apps/web; bun  x  vitest",
    "if ($?) { bunx vitest run }",
    "if ($?) {\n  bunx vitest run\n}",
    "git status\nBUNX vitest",
  ])("refuses `%s` and names the filtered script", (command) => {
    const { code, stderr } = run(command);
    expect(code).toBe(2);
    expect(stderr).toContain("bun run --filter @ticket/web test");
  });

  test.each([
    "bun run --filter @ticket/web test",
    "bun run --filter @ticket/web test src/pages/UsersPage.test.tsx",
    "bun run --filter @ticket/web test:watch",
    "bun run --filter @ticket/web test:ui",
    'gh issue comment 525 --body "a worker ran bunx vitest from the wrong directory"',
    "bunx prisma generate",
  ])("lets `%s` through", (command) => {
    const { code, stderr } = run(command);
    expect(stderr).toBe("");
    expect(code).toBe(0);
  });
});
