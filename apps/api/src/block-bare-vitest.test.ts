import { describe, expect, test } from "bun:test";
import { partialCheckout } from "@ticket/repo-scan/checkout";
import { runHook } from "./test/run-hook";

// `.claude/hooks/block-bare-vitest.mjs` is a PreToolUse hook registered for
// both Bash and PowerShell. It reads `tool_input.command`, and `tool_name` only
// to pick the shell's escape character for quoted strings, so a case is sent
// as a Bash call unless it is about PowerShell's quoting.
const run = (command: string, tool_name = "Bash") =>
  runHook(".claude/hooks/block-bare-vitest.mjs", {
    tool_name,
    tool_input: { command },
  });

// The hook is under `.claude/`, which the develop image does not carry.
describe.skipIf(partialCheckout)("block-bare-vitest hook", () => {
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
    "npx vitest run",
    "npx --yes vitest",
    "npx.cmd vitest",
    "bun --cwd apps/web x vitest run",
    "bun --cwd=apps/web x vitest",
    "bun --env-file .env x vitest",
    'pwsh -c "bunx vitest run src/App.test.tsx"',
    'pwsh -NoProfile -Command "Set-Location apps/web; bunx vitest"',
    "bash -c 'cd apps/web && bunx vitest run'",
    "bash -lc 'bunx vitest run'",
    'sh -ec "npx vitest"',
    'cmd /c "npx vitest"',
    "cmd.exe /d /c npx vitest",
    "bash -c \"pwsh -c 'bunx vitest'\"",
    'bash -c "echo \\"go\\"; npx vitest"',
    "git status; powershell.exe -c bunx vitest",
  ])("refuses `%s` and names the filtered script", (command) => {
    const { code, stderr } = run(command);
    expect(code).toBe(2);
    expect(stderr).toContain("bun run --filter @ticket/web test");
  });

  test("reads a PowerShell string with PowerShell's escape, not bash's", () => {
    // Read with bash's backslash escape, the first string would run on to the
    // last quote and swallow the runner between them.
    const command =
      'Set-Location "C:\\work\\"; bunx vitest; git commit -m "done"';
    expect(run(command, "PowerShell").code).toBe(2);
  });

  test.each([
    "bun run --filter @ticket/web test",
    "bun run --filter @ticket/web test src/pages/UsersPage.test.tsx",
    "bun run --filter @ticket/web test:watch",
    "bun run --filter @ticket/web test:ui",
    'gh issue comment 525 --body "a worker ran bunx vitest from the wrong directory"',
    "bunx prisma generate",
    "npx prisma generate",
    "bun --cwd apps/web run test",
    'git commit -m "npx vitest and bun x vitest are refused now"',
    "git commit -m 'refuse bunx vitest nested in a shell string'",
    'git commit -m "fix; npx vitest is refused"',
    'git commit -m "subject\n\nnpx vitest is refused"',
    'gh issue comment 546 --body "a worker ran pwsh -c \\"bunx vitest\\" from the root"',
    "bash -c 'bun run --filter @ticket/web test'",
  ])("lets `%s` through", (command) => {
    const { code, stderr } = run(command);
    expect(stderr).toBe("");
    expect(code).toBe(0);
  });
});
