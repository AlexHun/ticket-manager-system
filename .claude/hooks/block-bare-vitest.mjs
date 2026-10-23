// PreToolUse guard: refuses vitest run through a package runner rather than
// the workspace script: `bunx vitest`, `bun x vitest` (flags before the `x`
// included, `bun --cwd apps/web x vitest`) and `npx vitest`, typed directly or
// nested in a `pwsh -c` / `bash -c` / `cmd /c` string (#546).
// Run from the wrong directory it resolves no workspace config and installs
// vitest wherever it stands: during #493 that left a stray node_modules in the
// user's home directory. The workspace script runs it from apps/web with
// that package's config (docs/standards/testing.md). Exit 2 blocks the call
// and hands stderr to Claude as the reason.
import { readFileSync } from "node:fs";

const { tool_name, tool_input } = JSON.parse(readFileSync(0, "utf8").replace(/^\uFEFF/, ""));
const command = tool_input?.command ?? "";

// A runner counts only at the start of a command: the start of a line
// (indented or not) or after a separator. Quoted strings are set aside before
// the test, so a message that only mentions one (`gh issue comment --body "…;
// bunx vitest …"`) is not a match, whatever separators it holds. A flag may
// carry a value after a space (`--cwd apps/web`, `--env-file .env`); any word
// not starting with `-` is read as one, which can only ever widen a refusal.
const commandStart = String.raw`(?:^\s*|[;&|({]\s*)`;
const flags = String.raw`(?:-\S+(?:\s+[^-\s]\S*)?\s+)*`;
const runner = String.raw`(?:bunx(?:\.exe)?|npx(?:\.cmd|\.exe)?|bun(?:\.exe)?\s+${flags}x)`;
const bareVitest = new RegExp(`${commandStart}${runner}\\s+${flags}vitest\\b`, "im");

// A shell started at the start of a command runs its `-c` argument (`-lc`,
// `-ec`, pwsh's `-Command`, cmd's `/c` / `/k`) as a command of its own, so that
// argument is checked the same way, nesting included. The flags allowed before
// it start with `-` or `/` (cmd's `/d /c`) and take no value, unlike `flags`
// above. `"0"` is where the first
// quoted string stood once the strings were set aside.
const nestedShell = new RegExp(
  `${commandStart}(bash|sh|zsh|pwsh|powershell|cmd)(?:\\.exe)?\\s+(?:[-/]\\S+\\s+)*?(?:-[a-z]*c|-command|/c|/k)\\s+` +
    String.raw`(?:"(\d+)"|([^\n]+))`,
  "gim",
);

// Strings are read by the rules of the shell that parses them: a backslash
// escapes in bash, a backtick in PowerShell. Read with the wrong one, a path
// ending in `\` (`"cd C:\x\"`) would run the string on into the command.
const quotedBy = (escape) =>
  new RegExp(`"((?:\\${escape}[\\s\\S]|[^"\\${escape}])*)"|'([^']*)'`, "g");
const QUOTED = { bash: quotedBy("\\"), pwsh: quotedBy("`") };
const dialectOf = (shell) => (/^(?:pwsh|powershell)$/i.test(shell) ? "pwsh" : "bash");

const runsBareVitest = (text, dialect) => {
  const strings = [];
  const outside = text.replace(QUOTED[dialect], (raw, double, single) => {
    strings.push({ raw, body: double ?? single });
    return `"${strings.length - 1}"`;
  });
  if (bareVitest.test(outside)) return true;
  return [...outside.matchAll(nestedShell)].some(([, shell, index, bare]) =>
    runsBareVitest(
      index !== undefined
        ? strings[Number(index)].body
        : bare.replace(/"(\d+)"/g, (_, i) => strings[Number(i)].raw),
      dialectOf(shell),
    ),
  );
};

if (runsBareVitest(command, tool_name === "PowerShell" ? "pwsh" : "bash")) {
  process.stderr.write(
    "Blocked: a bare `bunx vitest` runs outside the web workspace's config and can install " +
      "vitest wherever it stands. Run `bun run --filter @ticket/web test [files]` instead " +
      "(or the `test:watch` / `test:ui` scripts).\n",
  );
  process.exit(2);
}
