/**
 * Unit tests for the auto-reply's text: the model's paragraphs, its steps and
 * the customer's display name, turned into the finished reply or into nothing.
 *
 * They used to live in `auto-reply.test.ts` and each scripted a model call
 * through `mock.module("ai")` to reach a string transform. `shapeReply` is pure,
 * so nothing here mocks anything, and every expected string is the one those
 * tests asserted on `result.reply`, byte for byte.
 *
 * What stays on `autoReply`: the prompt, the declines, the length limit, and
 * checks 5 and 6 running over the text this returns, greeting and sign off
 * included.
 */

import { describe, expect, test } from "bun:test";
import { BRAND_ATTRIBUTIVE, BRAND_NAME } from "@ticket/shared";

// Through `await import`, as `testing-api.md` asks of a module under test:
// `./provider`, which this reaches for `withoutDashes`, reads the key at import.
const { shapeReply } = await import("./reply-shape");

/** The display name on the ticket the original `autoReply` tests answered. */
const NAME = "Marta Ohlsson";

/** The body a cooperative model writes, before anything is added. */
const PARAGRAPHS = [
  "Buffering is almost always the quality setting in the player.",
  "Write back if that does not sort it out.",
];

/** The finished reply, or a failed test when there is none. */
function shaped(
  paragraphs: string[],
  steps: string[] = [],
  customerName: string = NAME,
): string {
  const reply = shapeReply(customerName, paragraphs, steps);
  if (reply === null) throw new Error("shapeReply returned nothing");
  return reply;
}

describe("shapeReply — composing the reply", () => {
  test("writes the greeting and the sign off itself", () => {
    expect(shaped(PARAGRAPHS)).toBe(
      "Hi Marta,\n\n" +
        "Buffering is almost always the quality setting in the player.\n\n" +
        "Write back if that does not sort it out.\n\n" +
        `Best regards,\n${BRAND_NAME}`,
    );
  });

  test("reduces a hostile display name to a name token, or to nothing", () => {
    // The guarantee is that a payload cannot survive, and these two cases are
    // what it actually looks like. Only the first token is read and its
    // surrounding punctuation is trimmed *before* the test — the same trimming
    // that keeps the "Vogel, Marta" form — so this greets Marta and drops the
    // rest unread. Both parts matter: the name is plausible, and the link is
    // not in the reply.
    const named = shaped(
      PARAGRAPHS,
      [],
      "Marta, urgent: see https://evil.example",
    );

    expect(named.startsWith("Hi Marta,\n\n")).toBe(true);
    expect(named).not.toContain("evil.example");

    // And when the first token is not a plausible name, nobody is greeted. Note
    // what this is not relying on: had the URL reached the greeting, check 6 in
    // `autoReply` would have discarded the whole reply rather than sent it.
    const nameless = shaped(PARAGRAPHS, [], "https://evil.example is down");

    expect(nameless.startsWith("Hello,\n\n")).toBe(true);
    expect(nameless).not.toContain("evil.example");
  });

  test("greets people whose names are not spelled in ASCII", () => {
    for (const name of ["Ünal Demir", "Łukasz Nowak", "marta ohlsson"]) {
      // The case is left exactly as it arrived: correcting somebody's name for
      // them is a bigger discourtesy than "hi marta".
      expect(
        shaped(PARAGRAPHS, [], name).startsWith(`Hi ${name.split(" ")[0]},`),
      ).toBe(true);
    }
  });

  test("reads the 'Vogel, Marta' form some clients send", () => {
    expect(shaped(PARAGRAPHS, [], "Vogel, Marta").startsWith("Hi Vogel,")).toBe(
      true,
    );
  });

  test("drops a display name that is not one token of a plausible name", () => {
    for (const name of [
      "",
      "   ",
      "007",
      "50%",
      "M@rta",
      "Marta.Ohlsson",
      "https://evil.example",
      "A".repeat(41),
    ]) {
      expect(shaped(PARAGRAPHS, [], name).startsWith("Hello,\n\n")).toBe(true);
    }
  });

  test("numbers the steps, and unnumbers the ones the model numbered anyway", () => {
    // Steps sit after the opening paragraph, which is where an answer that
    // begins "this is usually X" wants them.
    expect(
      shaped(
        [
          "Buffering is almost always the quality setting.",
          "Write back if it persists.",
        ],
        [
          "1. Open the player settings",
          "- Set quality to Auto",
          "Restart the app",
        ],
      ),
    ).toBe(
      "Hi Marta,\n\n" +
        "Buffering is almost always the quality setting.\n\n" +
        "1. Open the player settings\n2. Set quality to Auto\n3. Restart the app\n\n" +
        "Write back if it persists.\n\n" +
        `Best regards,\n${BRAND_NAME}`,
    );
  });

  test("flattens the model's own line breaks — the layout is ours", () => {
    expect(
      shaped(["Buffering is usually\n  the quality   setting."]),
    ).toContain("Buffering is usually the quality setting.");
  });

  test("takes the em and en dashes out, whatever the prompt achieved", () => {
    expect(
      shaped(["Buffering — nearly always — is the quality setting."]),
    ).toContain("Buffering, nearly always, is the quality setting.");
  });
});

describe("shapeReply — the bookends it was told not to write", () => {
  test("keeps the sentence a greeting was welded to, recapitalised", () => {
    expect(
      shaped(["Hi Marta, buffering is almost always the quality setting."]),
    ).toBe(
      `Hi Marta,\n\nBuffering is almost always the quality setting.\n\nBest regards,\n${BRAND_NAME}`,
    );
  });

  test("drops a paragraph that is nothing but a greeting, punctuated or not", () => {
    for (const greeting of ["Hi Marta,", "Hello there", "Good morning!"]) {
      expect(
        shaped([greeting, "Buffering is almost always the quality setting."]),
      ).toBe(
        `Hi Marta,\n\nBuffering is almost always the quality setting.\n\nBest regards,\n${BRAND_NAME}`,
      );
    }
  });

  test("does not eat a sentence that merely opens with a greeting word", () => {
    // Measured: "Hi there is a setting in the player that controls this." opens
    // with a word `GREETING_LINE` matches, and an unbounded prefix pattern
    // consumed the whole sentence and left an empty paragraph.
    expect(
      shaped(["Hi there is a setting in the player that controls this."]),
    ).toContain("Hi there is a setting in the player that controls this.");
  });

  test("drops a sign off the model added as its own paragraph", () => {
    // One sign off, and it is ours.
    expect(
      shaped([
        "Buffering is almost always the quality setting.",
        "Best regards,",
        "The Support Team",
      ]),
    ).toBe(
      `Hi Marta,\n\nBuffering is almost always the quality setting.\n\nBest regards,\n${BRAND_NAME}`,
    );
  });

  test("drops a sign off that names the product, with or without 'The'", () => {
    // Since #488 our own sign off is the product, so this is the closer a model
    // that copied it would write. Left alone, the brand line stopped the strip
    // at the last paragraph and the "Best regards," above it went out too:
    // two sign offs (#513).
    for (const name of [
      BRAND_NAME,
      BRAND_ATTRIBUTIVE,
      `${BRAND_NAME}.`,
      BRAND_NAME.toUpperCase(),
    ]) {
      expect(
        shaped([
          "Buffering is almost always the quality setting.",
          "Best regards,",
          name,
        ]),
      ).toBe(
        `Hi Marta,\n\nBuffering is almost always the quality setting.\n\nBest regards,\n${BRAND_NAME}`,
      );
    }
  });

  test("drops a sign off led by a dash, the same as one without", () => {
    // "— The Support Team" slipped past every pattern above, which all anchor on
    // the first word; `withoutDashes` then took an en or em dash off and shipped
    // the rest under our own sign off, and a hyphen went out as it was (#547). A
    // hyphen, an en dash, an em dash, and the "-- " that opens an email
    // signature, each before every closer stripped.
    const closers = [
      "Best regards,",
      "Kind regards",
      "Warm wishes",
      "Best wishes",
      "Regards",
      "Sincerely",
      "Cheers",
      "Thanks!",
      "Thank you",
      "Yours sincerely",
      "Yours faithfully",
      "Yours truly",
      "The Support Team",
      "Support Team",
      BRAND_NAME,
      BRAND_ATTRIBUTIVE,
    ];
    for (const dash of ["-", "–", "—", "--"]) {
      for (const closer of closers) {
        for (const paragraphs of [
          [`${dash} ${closer}`],
          [`${dash}${closer}`],
          ["Best regards,", `${dash} ${closer}`],
        ]) {
          expect(
            shaped([
              "Buffering is almost always the quality setting.",
              ...paragraphs,
            ]),
          ).toBe(
            `Hi Marta,\n\nBuffering is almost always the quality setting.\n\nBest regards,\n${BRAND_NAME}`,
          );
        }
      }
    }
  });

  test("takes a dash-led sign off off the end of the last real sentence", () => {
    for (const dash of ["-", "–", "—", "--"]) {
      expect(
        shaped([
          `Set the quality to Auto and we can take a closer look. ${dash} Best regards, Support Team`,
        ]),
      ).toBe(
        `Hi Marta,\n\nSet the quality to Auto and we can take a closer look.\n\nBest regards,\n${BRAND_NAME}`,
      );
    }
  });

  test("keeps a real sentence that happens to start with a dash", () => {
    // The dash is looked past only to find a closer; a paragraph that goes on
    // past one is still the body. The first two are kept by `SIGN_OFF_MAX`, the
    // third by `BRAND_SIGN_OFF` being anchored at its end. An en or em dash
    // opening a line is then taken off by `withoutDashes`, as on any line, so
    // the sentence after it is what has to survive.
    for (const [sentence, sent] of [
      ...[
        "Thanks for letting us know, that helps us track it down.",
        "The Support Team can take a closer look if it happens again.",
        `${BRAND_NAME} saves it for you.`,
      ].map((text) => [`- ${text}`, `- ${text}`] as const),
      ...["–", "—"].map(
        (dash) =>
          [
            `${dash} Thanks for letting us know, that helps us track it down.`,
            "Thanks for letting us know, that helps us track it down.",
          ] as const,
      ),
    ]) {
      expect(
        shaped(["Buffering is almost always the quality setting.", sentence]),
      ).toBe(
        `Hi Marta,\n\nBuffering is almost always the quality setting.\n\n${sent}\n\nBest regards,\n${BRAND_NAME}`,
      );
    }
  });

  test("keeps a real sentence that happens to start with the product's name", () => {
    // Only a paragraph that is the name and nothing else is a signature; one
    // that goes on to say something is the body.
    expect(
      shaped([
        "Buffering is almost always the quality setting.",
        `${BRAND_NAME} saves it for you.`,
      ]),
    ).toContain(`${BRAND_NAME} saves it for you.`);
  });

  test("keeps a real sentence that happens to start with 'Thanks'", () => {
    // Measured: "Thanks for letting us know, that helps us track it down."
    // matches `SIGN_OFF_LINE`, and at the 80 characters this guard used to allow
    // it was discarded. A sign off is a fragment; forty characters keeps every
    // real closer and no real sentence.
    expect(
      shaped([
        "Buffering is almost always the quality setting.",
        "Thanks for letting us know, that helps us track it down.",
      ]),
    ).toContain("Thanks for letting us know, that helps us track it down.");
  });

  test("takes a sign off off the end of the last real sentence", () => {
    // The variant a paragraph-level check cannot see, and the one observed: the
    // model ended a paragraph "…and we can take a closer look. Best regards,
    // Support Team". Left alone that ships two sign offs, the wrong one first.
    expect(
      shaped([
        "Set the quality to Auto and we can take a closer look. Best regards, Support Team",
      ]),
    ).toBe(
      `Hi Marta,\n\nSet the quality to Auto and we can take a closer look.\n\nBest regards,\n${BRAND_NAME}`,
    );
  });

  test("returns nothing when the bookends were the whole of the answer", () => {
    // `autoReply` reads this as a decline: said yes, and wrote nothing.
    expect(shapeReply(NAME, ["Hi Marta,", "Best regards,"], [])).toBeNull();
  });
});

describe("shapeReply — whatever dash the model used", () => {
  // The three replies the 2026-10-16 probe found reaching a customer (#573).
  // The dash pass runs after the strips, so a dash hid a bookend from them.

  test("takes the dash off a dash-led step, as it does a bullet", () => {
    // Shipped as "1., Set the quality to Auto".
    expect(
      shaped(
        ["Buffering is almost always the quality setting."],
        ["— Set the quality to Auto"],
      ),
    ).toBe(
      "Hi Marta,\n\n" +
        "Buffering is almost always the quality setting.\n\n" +
        "1. Set the quality to Auto\n\n" +
        `Best regards,\n${BRAND_NAME}`,
    );
  });

  test("keeps the sentence a greeting was welded to by a dash, recapitalised", () => {
    // Shipped as "Hi Marta," and then "Hi Marta, buffering is…".
    expect(
      shaped(["Hi Marta — buffering is almost always the quality setting."]),
    ).toBe(
      `Hi Marta,\n\nBuffering is almost always the quality setting.\n\nBest regards,\n${BRAND_NAME}`,
    );
  });

  test("drops a greeting paragraph led by a dash", () => {
    // Shipped as "Hi Marta," twice.
    expect(
      shaped([
        "— Hi Marta,",
        "Buffering is almost always the quality setting.",
      ]),
    ).toBe(
      `Hi Marta,\n\nBuffering is almost always the quality setting.\n\nBest regards,\n${BRAND_NAME}`,
    );
  });
});
