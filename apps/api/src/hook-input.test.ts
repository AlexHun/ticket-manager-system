import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, runHook } from "./test/run-hook";

// Every PreToolUse hook in `.claude/settings.json` reads the tool call as JSON
// on stdin, and they read it the same way: a leading BOM, which a Windows
// shell can put in front of a pipe, is stripped before `JSON.parse`. A hook
// that skips it throws on the first byte and exits 1, which Claude Code reports
// as a hook error rather than as the guard's answer (#546).
type HookEntry = { matcher?: string; hooks: { command: string }[] };
const settings = JSON.parse(
  readFileSync(path.join(REPO_ROOT, ".claude/settings.json"), "utf8"),
) as { hooks: { PreToolUse: HookEntry[] } };

const commands = settings.hooks.PreToolUse.flatMap((entry) =>
  entry.hooks.map(({ command }) => command),
);
const hooks = [
  ...new Set(
    commands.flatMap(
      (command) => /\.claude\/hooks\/[\w-]+\.mjs/.exec(command) ?? [],
    ),
  ),
];

describe("PreToolUse hook input", () => {
  test("every registered hook names a script", () => {
    expect(hooks.length).toBeGreaterThan(0);
    expect(hooks).toHaveLength(new Set(commands).size);
  });

  test.each(hooks)(
    "%s lets a harmless call with a leading BOM through",
    (hook) => {
      const { code, stderr } = runHook(
        hook,
        { tool_name: "Bash", tool_input: { command: "git status" } },
        { bom: true },
      );
      expect(stderr).toBe("");
      expect(code).toBe(0);
    },
  );
});
