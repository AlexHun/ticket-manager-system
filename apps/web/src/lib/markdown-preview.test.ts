import { describe, expect, it } from "vitest";
import { markdownPreview } from "./markdown-preview";

describe("markdownPreview", () => {
  it("strips bold, inline code, a link and a list, keeping the words", () => {
    const body = [
      "Use **Forgot password?** on the sign-in page, or write to `privacy@example.com`.",
      "See [the help centre](https://example.com/help) for more.",
      "",
      "- Open **Account → Security**",
      "* Turn on two-factor",
      "1. Save the codes",
    ].join("\n");

    expect(markdownPreview(body)).toBe(
      "Use Forgot password? on the sign-in page, or write to privacy@example.com. " +
        "See the help centre for more. " +
        "Open Account → Security Turn on two-factor Save the codes",
    );
  });

  it("strips headings, quotes, italics, strikethrough and code fences", () => {
    const body = [
      "## Before you start",
      "> Check _your_ inbox and *spam* first.",
      "```",
      "reset-token",
      "```",
      "~~Old~~ __new__ flow, ![diagram](https://example.com/a.png).",
    ].join("\n");

    expect(markdownPreview(body)).toBe(
      "Before you start Check your inbox and spam first. reset-token Old new flow, diagram.",
    );
  });

  it("leaves underscores and asterisks inside words alone", () => {
    expect(markdownPreview("Set snake_case_name to 2*3*4.")).toBe(
      "Set snake_case_name to 2*3*4.",
    );
  });

  it("keeps escaped Markdown characters as the characters", () => {
    expect(markdownPreview("Price is \\*not\\* final")).toBe(
      "Price is *not* final",
    );
  });

  it("returns plain text as text, never parsing HTML", () => {
    expect(markdownPreview("<b>hi</b> & bye")).toBe("<b>hi</b> & bye");
  });
});
