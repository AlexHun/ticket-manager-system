import { describe, expect, it } from "vitest";
import { commandOf } from "./command-prompt.ts";

/** When a prompt is a typed command (#616, #682). Each caller's own command
 *  is tested beside it: `/chain` in `chains.test.ts`, `/implement` in
 *  `implement-step.test.ts`, the title in `sessions.test.ts`. */
describe("commandOf", () => {
  it("reads the command and its arguments in either tag order", () => {
    expect(
      commandOf(
        "<command-message>chain</command-message>\n<command-name>/chain</command-name>\n<command-args> #1 #2 </command-args>",
      ),
    ).toEqual({ name: "/chain", args: "#1 #2" });
    expect(
      commandOf(
        "  <command-name>/clear</command-name>\n<command-message>clear</command-message>",
      ),
    ).toEqual({ name: "/clear", args: "" });
  });

  it("answers null for a prompt that only quotes the markup further in", () => {
    expect(
      commandOf("As <command-name>/chain</command-name> it is recorded"),
    ).toBeNull();
    expect(
      commandOf(
        "<bash-stdout><command-name>/implement</command-name></bash-stdout>",
      ),
    ).toBeNull();
  });

  it("answers null for a prompt that opens on a tag but names no command", () => {
    expect(
      commandOf(
        "<command-message>x</command-message><command-name> </command-name>",
      ),
    ).toBeNull();
  });
});
