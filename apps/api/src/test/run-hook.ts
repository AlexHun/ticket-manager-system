import path from "node:path";

// Runs one `.claude/hooks/*.mjs` PreToolUse hook as `.claude/settings.json`
// does: under `node`, one process per call, the tool call as JSON on stdin.
// Exit 2 with the reason on stderr is a refusal.
export const REPO_ROOT = path.resolve(import.meta.dir, "../../../..");

export const runHook = (
  hook: string,
  input: { tool_name: string; tool_input: Record<string, unknown> },
  { bom = false }: { bom?: boolean } = {},
) => {
  const result = Bun.spawnSync(["node", path.join(REPO_ROOT, hook)], {
    stdin: Buffer.from((bom ? "\uFEFF" : "") + JSON.stringify(input)),
  });
  return { code: result.exitCode, stderr: result.stderr.toString() };
};
