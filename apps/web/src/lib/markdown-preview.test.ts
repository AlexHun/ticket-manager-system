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

  // Stored bodies keep their hard wraps, so emphasis can open on one line and
  // close on the next — KB-007's "**5–10\nbusiness days**".
  it("strips emphasis, code and links that span a line break", () => {
    const body = [
      "Refunds take **5–10",
      "business days**. Run `npm",
      "ci` or see [the help",
      "centre](https://example.com/help).",
    ].join("\n");

    expect(markdownPreview(body)).toBe(
      "Refunds take 5–10 business days. Run npm ci or see the help centre.",
    );
  });

  it("keeps backslashes inside code, and leaks no markers", () => {
    expect(markdownPreview("Run `C:\\Users\\*` or `\\_x`.")).toBe(
      "Run C:\\Users\\* or \\_x.",
    );
    expect(markdownPreview(`a${String.fromCharCode(0xe000)}0b`)).toBe("a0b");
  });

  it("keeps a fenced block's lines as code, not as Markdown", () => {
    const body = ["```", "# not a heading", "- not a list", "```"].join("\n");
    expect(markdownPreview(body)).toBe("# not a heading - not a list");
  });

  it("reads a wrapped line starting with a number as prose", () => {
    expect(markdownPreview("The plan changed in\n2024. Prices did not.")).toBe(
      "The plan changed in 2024. Prices did not.",
    );
  });

  it("handles parentheses in a URL, reference links and setext headings", () => {
    const body = [
      "Title",
      "=====",
      "See [wiki](https://en.wikipedia.org/wiki/Foo_(bar)) and [docs][1].",
      "",
      "[1]: https://example.com/docs",
    ].join("\n");
    expect(markdownPreview(body)).toBe("Title See wiki and docs.");
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
