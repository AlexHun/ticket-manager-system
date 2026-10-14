import { AUTO_REPLY_DECLINES } from "@ticket/shared";
import { DECLINE_LABEL, DECLINE_SHORT, midSentence } from "./pipeline-labels";

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

  // Every decline reason that can follow a dash, in both its forms: a word is
  // lowered, an acronym is kept, and nothing reads "aI …" on the Evals page or
  // in the activity feed.
  test.each(
    AUTO_REPLY_DECLINES.flatMap((decline) => [
      [`DECLINE_SHORT.${decline}`, DECLINE_SHORT[decline]],
      [`DECLINE_LABEL.${decline}`, DECLINE_LABEL[decline]],
    ]),
  )("%s reads correctly mid-sentence", (_name, label) => {
    const lowered = midSentence(label);
    const opensOnAcronym = /^[A-Z]{2}/.test(label);
    expect(lowered.charAt(0)).toBe(
      opensOnAcronym ? label.charAt(0) : label.charAt(0).toLowerCase(),
    );
    expect(lowered.slice(1)).toBe(label.slice(1));
    expect(lowered).not.toMatch(/^[a-z][A-Z]/);
  });
});
