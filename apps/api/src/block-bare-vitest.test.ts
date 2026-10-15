import { describe, expect, test } from "bun:test";
import path from "node:path";

// `.claude/hooks/block-bare-vitest.mjs` is a PreToolUse hook: it reads the tool
// call as JSON on stdin and exits 2, with the reason on stderr, to block it.
// Run it the way Claude Code does, one process per call.
const hook = path.resolve(
  import.meta.dir,
  "../../../.claude/hooks/block-bare-vitest.mjs",
);

const run = (tool_name: string, command: string) => {
  const result = Bun.spawnSync([process.execPath, hook], {
    stdin: Buffer.from(JSON.stringify({ tool_name, tool_input: { command } })),
  });
  return { code: result.exitCode, stderr: result.stderr.toString() };
};

describe("block-bare-vitest hook", () => {
  test.each([
    ["Bash", "bunx vitest run src/pages/UsersPage.test.tsx"],
    ["PowerShell", "bun x vitest run"],
    ["Bash", "bunx --bun vitest"],
    ["Bash", "cd apps/web && bunx vitest run"],
    ["PowerShell", "Set-Location apps/web; bun  x  vitest"],
    ["PowerShell", "if ($?) { bunx vitest run }"],
    ["Bash", "git status\nBUNX vitest"],
  ])("%s refuses `%s` and names the filtered script", (tool, command) => {
    const { code, stderr } = run(tool, command);
    expect(code).toBe(2);
    expect(stderr).toContain("bun run --filter @ticket/web test");
  });

  test.each([
    ["PowerShell", "bun run --filter @ticket/web test"],
    [
      "PowerShell",
      "bun run --filter @ticket/web test src/pages/UsersPage.test.tsx",
    ],
    ["Bash", "bun run --filter @ticket/web test:watch"],
    ["Bash", "bun run --filter @ticket/web test:ui"],
    [
      "PowerShell",
      'gh issue comment 525 --body "a worker ran bunx vitest from the wrong directory"',
    ],
    ["Bash", "bunx prisma generate"],
  ])("%s lets `%s` through", (tool, command) => {
    const { code, stderr } = run(tool, command);
    expect(stderr).toBe("");
    expect(code).toBe(0);
  });
});
