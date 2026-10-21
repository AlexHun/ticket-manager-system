import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { WAITING_DIR_ENV, resolveWaitingDir } from "./waiting.ts";

describe("resolveWaitingDir", () => {
  it("reads the records from under the home directory by default", () => {
    // The default `.claude/hooks/record-waiting.mjs` writes to, which
    // `apps/api/src/record-waiting-hook.test.ts` pins on the hook's side.
    expect(resolveWaitingDir({}, { home: "/home/dev" })).toBe(
      join("/home/dev", ".claude-sessions-waiting"),
    );
  });

  it("reads them from the directory the environment names", () => {
    expect(
      resolveWaitingDir(
        { [WAITING_DIR_ENV]: " /tmp/waiting " },
        { home: "/home/dev" },
      ),
    ).toBe("/tmp/waiting");
    expect(WAITING_DIR_ENV).toBe("CLAUDE_WAITING_DIR");
  });
});
