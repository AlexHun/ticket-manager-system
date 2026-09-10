/**
 * Unit tests for `apps/api/src/evals/stored-verdict.ts`.
 *
 * **Values in, values out — no database and no route.** That is the point of
 * the file as much as its contents: every question here used to be answerable
 * only by inserting a `Json` column into Postgres and fetching it back through
 * `GET /api/evals/runs`, because the narrowing lived in the read model and
 * nothing else could reach it. What a row written by an older build reads as is
 * a property of the parse, and it is asserted against the parse.
 *
 * Nothing is mocked. Both exports are pure and `./runner` is imported for its
 * type alone, so this file adds nothing to the process-wide mock registry
 * (`testing.md`).
 */

import { describe, expect, test } from "bun:test";
import {
  AUTO_REPLY_DECLINE,
  PIPELINE_OUTCOME,
  TICKET_CATEGORY,
} from "@ticket/shared";
import type { EvalVerdict } from "./runner";
import { parseStoredVerdicts, storedVerdict } from "./stored-verdict";

/** A repeat that answered, as the runner hands it over. */
function verdict(overrides: Partial<EvalVerdict> = {}): EvalVerdict {
  return {
    outcome: PIPELINE_OUTCOME.declined,
    decline: AUTO_REPLY_DECLINE.notCovered,
    matched: true,
    usd: 0.0012,
    cached: true,
    caught: false,
    escaped: false,
    category: TICKET_CATEGORY.General,
    classifyMatched: true,
    ...overrides,
  };
}

describe("what a repeat leaves on the row", () => {
  test("the six fields a breakdown reads, and nothing that has a column", () => {
    // `usd`, `cached` and `classifyMatched` are summed into columns of their
    // own — see `EVAL_COUNTERS` — and a copy of them inside the Json would be a
    // second, unmaintained answer to a question the row already answers.
    expect(Object.keys(storedVerdict(verdict())).sort()).toEqual([
      "category",
      "caught",
      "decline",
      "escaped",
      "matched",
      "outcome",
    ]);
  });

  test("survives the round trip it was written for", () => {
    const stored = storedVerdict(
      verdict({
        outcome: PIPELINE_OUTCOME.declined,
        decline: AUTO_REPLY_DECLINE.unbackedCommitment,
        matched: false,
        caught: true,
        category: TICKET_CATEGORY.Refund,
      }),
    );

    // Through `JSON.parse(JSON.stringify(...))` rather than straight back in,
    // because that is what the column does to it: the driver hands the read
    // model a plain value, not the object the worker built.
    expect(parseStoredVerdicts(JSON.parse(JSON.stringify([stored])))).toEqual([
      stored,
    ]);
  });

  test("a repeat that could not be answered keeps its null category", () => {
    // Not the same as a repeat nobody asked about — the two are indistinguishable
    // on the row, which is why `filedFrom` decides between them from the case's
    // own expectation rather than from here.
    expect(
      storedVerdict(verdict({ category: null, classifyMatched: false })),
    ).toMatchObject({ category: null });
  });
});

describe("rows written by earlier builds", () => {
  test("one from before slice 4 reads as not classified, not as a miss", () => {
    // The shape every row written before the classifier metric existed is in:
    // three keys, no `category`. It must read as an absence — null, the same
    // value a repeat the provider could not answer produces — because a zero
    // would put it in the denominator of a rate nobody measured, and a `false`
    // matched would report a filing that went wrong.
    const [parsed] = parseStoredVerdicts([
      {
        outcome: PIPELINE_OUTCOME.declined,
        decline: AUTO_REPLY_DECLINE.notCovered,
        matched: true,
      },
    ]);

    expect(parsed).toEqual({
      outcome: PIPELINE_OUTCOME.declined,
      decline: AUTO_REPLY_DECLINE.notCovered,
      matched: true,
      // Absent on the row, and false is what keeps it out of both sides of the
      // catch rate rather than on the reassuring side of it.
      caught: false,
      escaped: false,
      category: null,
    });
  });

  test("a reason this build has no wording for reads null", () => {
    // The columns are plain text and grow a value every time a safety check is
    // added; rendering a raw one at an admin is worse than saying nothing.
    expect(
      parseStoredVerdicts([
        { outcome: PIPELINE_OUTCOME.declined, decline: "fromTheFuture" },
      ])[0],
    ).toMatchObject({ decline: null });
  });

  test("an outcome this build has no wording for reads notOffered", () => {
    // An outcome is not nullable on the wire, and "nothing is scheduled and
    // nothing happened" is the honest reading of a value this build cannot name.
    expect(
      parseStoredVerdicts([{ outcome: "alsoFromTheFuture" }])[0],
    ).toMatchObject({ outcome: PIPELINE_OUTCOME.notOffered });
  });

  test.each(Object.values(PIPELINE_OUTCOME))(
    "%s survives the column unchanged",
    (outcome) => {
      // Every member, not two of them. `notOffered` is also the fallback for a
      // value this build cannot name, so a narrowing that quietly stopped
      // recognising one of the real outcomes would still answer with something
      // plausible — and the two spot-checks above are exactly the pair on which
      // that would be invisible. This is the same "and what about the other
      // four" question `runner.test.ts` asks of `AI_FAILURE` (docs/adr/0018).
      expect(parseStoredVerdicts([{ outcome }])[0]).toMatchObject({ outcome });
    },
  );

  test("a category this build has no wording for reads as not classified", () => {
    expect(
      parseStoredVerdicts([{ category: "cryptocurrency" }])[0],
    ).toMatchObject({ category: null });
  });
});

describe("a column that is not the shape this build writes", () => {
  test("something that is not an array yields no repeats", () => {
    // A page whose whole job is saying what happened must not 500 on one row
    // it cannot read, or it stops being able to report the thirty it can.
    expect(parseStoredVerdicts({ not: "an array" })).toEqual([]);
    expect(parseStoredVerdicts(null)).toEqual([]);
    expect(parseStoredVerdicts("[]")).toEqual([]);
  });

  test("entries that are not objects are not repeats", () => {
    // A `null` entry used to reach a property access and take the page down
    // with it. Dropping it is the quieter reading: it is not a repeat, so it is
    // in no numerator and no denominator.
    expect(parseStoredVerdicts([null, "declined", 7, []])).toEqual([]);
  });

  test("an unreadable entry does not cost the readable ones beside it", () => {
    expect(
      parseStoredVerdicts([null, { outcome: PIPELINE_OUTCOME.resolved }]),
    ).toEqual([
      {
        outcome: PIPELINE_OUTCOME.resolved,
        decline: null,
        matched: false,
        caught: false,
        escaped: false,
        category: null,
      },
    ]);
  });
});
