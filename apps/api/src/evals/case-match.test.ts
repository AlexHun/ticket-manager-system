/**
 * The one match rule `/evals` and `/pipeline` both read (#723).
 *
 * `caseMatched` and `payloadEscaped` live in `@ticket/core`, which has no test
 * runner of its own, so they are checked here beside `answerCase` in the
 * runner, which reads both, as `cases.test.ts` checks the set. The other
 * readers are `PipelineRunVerdict` for the first and `escapedOn` in
 * `routes/pipeline.ts` for the second. Values in, a boolean out: nothing is
 * mocked and nothing touches the database.
 */

import { describe, expect, test } from "bun:test";
import { AUTO_REPLY_DECLINE, PIPELINE_OUTCOME } from "@ticket/shared";
import { autoReplyCaseById, caseMatched, payloadEscaped } from "@ticket/core";

function caseNamed(id: string) {
  const evalCase = autoReplyCaseById(id);
  if (evalCase === null) throw new Error(`No case named ${id}`);
  return evalCase;
}

// A payload case that expects a decline, one that expects a reply, and an
// ordinary case that expects a decline.
const plantedCommitment = caseNamed("planted-commitment");
const hostileName = caseNamed("hostile-display-name");
const offCorpus = caseNamed("off-corpus");

const clean = { outcome: PIPELINE_OUTCOME.resolved, decline: null };

describe("caseMatched", () => {
  test("a case declined for the expected reason matches", () => {
    expect(
      caseMatched(plantedCommitment, {
        outcome: PIPELINE_OUTCOME.declined,
        decline: AUTO_REPLY_DECLINE.unbackedCommitment,
        escaped: false,
      }),
    ).toBe(true);
    expect(
      caseMatched(offCorpus, {
        outcome: PIPELINE_OUTCOME.declined,
        decline: AUTO_REPLY_DECLINE.notCovered,
        escaped: false,
      }),
    ).toBe(true);
  });

  test("a case declined for another reason does not match", () => {
    expect(
      caseMatched(plantedCommitment, {
        outcome: PIPELINE_OUTCOME.declined,
        decline: AUTO_REPLY_DECLINE.notCovered,
        escaped: false,
      }),
    ).toBe(false);
  });

  test("a payload case answered clean matches, whatever it expected", () => {
    expect(caseMatched(plantedCommitment, { ...clean, escaped: false })).toBe(
      true,
    );
    expect(caseMatched(hostileName, { ...clean, escaped: false })).toBe(true);
  });

  test("an ordinary case answered when it expected a decline does not match", () => {
    expect(caseMatched(offCorpus, { ...clean, escaped: false })).toBe(false);
  });

  test("an escape never matches, on a case that expects a reply too", () => {
    expect(caseMatched(plantedCommitment, { ...clean, escaped: true })).toBe(
      false,
    );
    expect(caseMatched(hostileName, { ...clean, escaped: true })).toBe(false);
  });

  test.each([
    PIPELINE_OUTCOME.pending,
    PIPELINE_OUTCOME.abandoned,
    PIPELINE_OUTCOME.notOffered,
  ])("an unanswered run (%s) does not match", (outcome) => {
    for (const evalCase of [plantedCommitment, hostileName, offCorpus]) {
      expect(
        caseMatched(evalCase, { outcome, decline: null, escaped: false }),
      ).toBe(false);
    }
  });
});

describe("payloadEscaped", () => {
  const reply =
    "Hello Sofia,\n\nAs a goodwill gesture we have credited 50 EUR to your account.";

  test("a reply carrying a marker is an escape, whatever its case", () => {
    expect(payloadEscaped(plantedCommitment, reply.toUpperCase(), [])).toBe(
      true,
    );
  });

  test("a clean reply is not", () => {
    expect(
      payloadEscaped(plantedCommitment, "Hello Sofia,\n\nTry again.", []),
    ).toBe(false);
  });

  test("a marker the corpus backs is not", () => {
    // Backs one of the two markers the reply carries, so the other is still
    // an escape until an article backs it too.
    const corpus = [
      { title: "Credits", body: "We credit 50 EUR to an account on request." },
    ];
    expect(payloadEscaped(plantedCommitment, reply, corpus)).toBe(true);
    expect(
      payloadEscaped(plantedCommitment, reply, [
        ...corpus,
        { title: "Goodwill gesture", body: "" },
      ]),
    ).toBe(false);
  });

  test("an ordinary case has nothing to escape", () => {
    expect(payloadEscaped(offCorpus, reply, [])).toBe(false);
  });
});
