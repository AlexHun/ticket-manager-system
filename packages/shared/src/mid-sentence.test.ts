import { describe, expect, test } from "bun:test";
import { midSentence } from "./index";

// The helper's own rules. Whether every real decline label reads right after
// a dash is `apps/web/src/lib/pipeline-labels.test.ts`'s question, since those
// labels live in the web app.
describe("midSentence", () => {
  test("lower-cases the first letter of a label that follows a dash", () => {
    expect(midSentence("Not covered by the knowledge base")).toBe(
      "not covered by the knowledge base",
    );
  });

  test("keeps a label that opens on an acronym intact", () => {
    expect(midSentence("AI polish was unavailable")).toBe(
      "AI polish was unavailable",
    );
    expect(midSentence("URL not in any article")).toBe(
      "URL not in any article",
    );
  });

  test("leaves the rest of the label as written", () => {
    expect(
      midSentence(
        "Written in a demo session, and a demo session's email is never sent",
      ),
    ).toBe(
      "written in a demo session, and a demo session's email is never sent",
    );
  });
});
