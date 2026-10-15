// PreToolUse guard: refuses a bare `bunx vitest` / `bun x vitest` / `npx vitest`.
// Run from the wrong directory it resolves no workspace config and installs
// vitest wherever it stands: during #493 that left a stray node_modules in the
// user's home directory. The workspace script runs it from apps/web with
// that package's config (docs/standards/testing.md). Exit 2 blocks the call
// and hands stderr to Claude as the reason.
import { readFileSync } from "node:fs";

const { tool_input } = JSON.parse(readFileSync(0, "utf8").replace(/^\uFEFF/, ""));
const command = tool_input?.command ?? "";

// A runner counts only at the start of a command: the start of a line
// (indented or not) or after a separator, so a message that only mentions it
// (`gh issue comment --body "… bunx vitest …"`) is not a match. Flags may sit
// between the runner and `vitest` (`bunx --bun vitest`, `npx --yes vitest`) and
// between `bun` and `x` (`bun --cwd apps/web x vitest`, #546); `--cwd` and
// `--prefix` are the two that take their value after a space.
const commandStart = String.raw`(?:^\s*|[;&|({]\s*)`;
const flags = String.raw`(?:(?:--cwd|--prefix)\s+\S+\s+|-\S+\s+)*`;
const runner = String.raw`(?:bunx(?:\.exe)?|npx(?:\.cmd|\.exe)?|bun(?:\.exe)?\s+${flags}x)`;
const bareVitest = new RegExp(`${commandStart}${runner}\\s+${flags}vitest\\b`, "im");

// A shell started at the start of a command runs its `-c` / `-Command` / `/c`
// argument as a command of its own (`pwsh -c "bunx vitest"`, #546), so that
// argument is checked the same way, nesting included. The shell itself has to
// be at the start of a command too, so a commit message that quotes a nested
// form is still only a mention.
const nestedShell = new RegExp(
  `${commandStart}(?:bash|sh|zsh|pwsh|powershell|cmd)(?:\\.exe)?\\s+(?:-\\S+\\s+)*?(?:-c|-command|/c|/k)\\s+` +
    String.raw`(?:"((?:\\[\s\S]|[^"\\])*)"|'([^']*)'|([^\n]+))`,
  "gim",
);

const runsBareVitest = (text) =>
  bareVitest.test(text) ||
  [...text.matchAll(nestedShell)].some(([, double, single, bare]) =>
    runsBareVitest(double ?? single ?? bare),
  );

if (runsBareVitest(command)) {
  process.stderr.write(
    "Blocked: a bare `bunx vitest` runs outside the web workspace's config and can install " +
      "vitest wherever it stands. Run `bun run --filter @ticket/web test [files]` instead " +
      "(or the `test:watch` / `test:ui` scripts).\n",
  );
  process.exit(2);
}
