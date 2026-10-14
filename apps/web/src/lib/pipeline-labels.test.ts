import { AUTO_REPLY_DECLINES, midSentence } from "@ticket/shared";
import { DECLINE_LABEL, DECLINE_SHORT } from "./pipeline-labels";

// `midSentence`'s own rules are tested beside it, in
// `packages/shared/src/mid-sentence.test.ts`; these labels live here.
describe("midSentence", () => {
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
