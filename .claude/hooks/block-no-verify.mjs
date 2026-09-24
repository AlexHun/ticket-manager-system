// PreToolUse guard: refuses a shell command that would skip the husky hooks.
// .husky/pre-push is the only local run of the API suite, and sessions have
// committed past it more than once. Exit 2 blocks the call and hands stderr to
// Claude as the reason.
import { readFileSync } from "node:fs";

const { tool_input } = JSON.parse(readFileSync(0, "utf8"));
const command = tool_input?.command ?? "";

// Every pattern is anchored to a `git` invocation or to the start of a command,
// and stops at a line break or separator, so a commit message on a heredoc line
// or a later `echo` that mentions a bypass is not a match.
const bypasses = [
  /\bgit\b[^\n;|&]*\s--no-verify\b/,
  /\bgit\s+commit\b[^\n;|&]*\s-[A-Za-z]*n[A-Za-z]*\b/, // -n, -nm, -an
  /\bgit\s+(?:-\S+\s+)*-c\s+core\.hooksPath\b/i,
  /(?:^|[;&|]\s*)(?:export\s+)?HUSKY=0\b/m,
  /(?:^|[;&|]\s*)\$env:HUSKY\s*=/im,
];

if (bypasses.some((pattern) => pattern.test(command))) {
  process.stderr.write(
    "Blocked: this command skips the husky hooks. Run it with the hooks on; " +
      "when one fails, fix what it reports and run the command again. " +
      "A commit message that has to mention the flag goes in a file: `git commit -F <file>`.\n",
  );
  process.exit(2);
}
