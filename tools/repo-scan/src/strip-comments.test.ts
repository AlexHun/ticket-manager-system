import { describe, expect, test } from "bun:test";
import { stripComments } from "./strip-comments.ts";

// The cases each former copy had to get right (#565, R1). Before the two were
// merged, both ran over every tracked JS, TS and JSON file and their outputs
// were compared: 568 files, no difference. So no case here records a
// disagreement between them; each is a shape a character scanner can get wrong.

describe("stripComments", () => {
  test("a comment opener inside a string is kept, and the code after it survives", () => {
    const source = 'route("/__dev/*");\nconst kept = 1;';
    expect(stripComments(source).code).toBe(source);
  });

  test("a line comment is blanked to the end of its line, and the newline stays", () => {
    expect(stripComments("a; // note\nb;").code).toBe("a;        \nb;");
  });

  test("a block comment is blanked across lines, keeping every newline", () => {
    expect(stripComments("a; /* one\ntwo */ b;").code).toBe(
      "a;       \n       b;",
    );
  });

  test("a regex literal holding comment openers is kept whole", () => {
    const source = "const re = /\\/\\/|[/*]/g;\nconst kept = 1;";
    expect(stripComments(source).code).toBe(source);
  });

  test("a slash after a value divides, so a comment after it is still found", () => {
    expect(stripComments("x = a / b; // half").code).toBe("x = a / b;        ");
  });

  test("a template literal's contents are kept, comment openers and all", () => {
    const source = "api.get(`/api/tickets/${id}/*`);\nconst kept = 1;";
    expect(stripComments(source).code).toBe(source);
  });

  test("a stray apostrophe ends at its line, not at the end of the file", () => {
    expect(stripComments("it's\n// gone").code).toBe("it's\n       ");
  });

  test("counts the lines that kept code and the lines that held only a comment", () => {
    const stripped = stripComments("// head\nconst a = 1; // tail\n\n/* b */");
    expect(stripped.codeLines).toBe(1);
    expect(stripped.commentLines).toBe(2);
  });
});
