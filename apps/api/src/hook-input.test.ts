import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// Every PreToolUse hook in `.claude/settings.json` reads the tool call as JSON
// on stdin, and they read it the same way: a leading BOM, which a Windows
// shell can put in front of a pipe, is stripped before `JSON.parse`. A hook
// that skips it throws on the first byte and exits 1, which Claude Code reports
// as a hook error rather than as the guard's answer (#546).
const root = path.resolve(import.meta.dir, "../../..");

type HookEntry = { matcher?: string; hooks: { command: string }[] };
const settings = JSON.parse(
  readFileSync(path.join(root, ".claude/settings.json"), "utf8"),
) as { hooks: { PreToolUse: HookEntry[] } };

const hooks = [
  ...new Set(
    settings.hooks.PreToolUse.flatMap((entry) =>
      entry.hooks.map(
        ({ command }) => /\.claude\/hooks\/[\w-]+\.mjs/.exec(command)?.[0],
      ),
    ),
  ),
];

describe("PreToolUse hook input", () => {
  test("every registered hook names a script", () => {
    expect(hooks.length).toBeGreaterThan(0);
    expect(hooks).not.toContain(undefined);
  });

  test.each(hooks.filter((hook): hook is string => hook !== undefined))(
    "%s lets a harmless call with a leading BOM through",
    (hook) => {
      const result = Bun.spawnSync(["node", path.join(root, hook)], {
        stdin: Buffer.from(
          "\uFEFF" +
            JSON.stringify({
              tool_name: "Bash",
              tool_input: { command: "git status" },
            }),
        ),
      });
      expect(result.stderr.toString()).toBe("");
      expect(result.exitCode).toBe(0);
    },
  );
});
