/**
 * Unit tests for `apps/api/src/evals/runner.ts`.
 *
 * What slice 1 of the eval harness existed to retire and this slice extends:
 * that handing a hand-built `AutoReplyContext` to `autoReply` reproduces a
 * verdict the pipeline would have reached, that the four preflight gates are
 * now reachable from values, and that a run writes nothing a customer or an
 * agent would see (PRD R12).
 *
 * `autoReply` is called for real, and the model under it is the preload's
 * scripted fake (`../test/model`, #580). What is under test here is still the
 * **translation** — an `AutoReplyResult` into an outcome, an outcome into a
 * match, five of them into a rate — not what the model says; but each result
 * is now one `autoReply` really returns for a scripted answer, so a verdict
 * this file asserts is one the real checks can reach. The classifier the
 * runner asks first is real too since #656, scripted on the same fake: each
 * repeat makes two model calls, and each feature gets its own scripted answer.
 * The model half is measured by running the thing, which is what the harness
 * is for, and exercised end to end against the E2E suite's fake provider in
 * `tests/e2e/evals.spec.ts`.
 *
 * The R12 assertion is the interesting one and it is deliberately made against
 * a **real** database (`../test/pg`, ADR-0014) rather than a count of calls on
 * a fake: the claim is that the code path a run reaches cannot write a ticket,
 * and a fake client could only tell us that this test did not ask it to.
 */

import { afterAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  AUTO_REPLY_DECLINE,
  PIPELINE_OUTCOME,
  TICKET_CATEGORY,
  type TicketCategory,
} from "@ticket/shared";
import { autoReplyCaseById, AUTO_REPLY_CASES } from "@ticket/core";
import { prisma, resetDb } from "../test/pg";
import {
  type ModelAnswer,
  type ModelUsage,
  lastModelCall,
  modelCalls,
  providerError,
  scriptModel,
} from "../test/model";
import { autoReplyAnswer } from "../test/auto-reply-answer";
import { classifyAnswer } from "../test/classify-answer";
import { AI_FAILURE, type AiFailure } from "../ai/provider";
import { AUTO_REPLY_FAILURE } from "../ai/auto-reply";
import type { KbArticle } from "../ai/knowledge-base";

/* ── The model, scripted ────────────────────────────────────────────────── */

/** The model reads the case and says the corpus does not cover it. */
const DECLINED = autoReplyAnswer({
  answered: false,
  articleIds: [],
  paragraphs: null,
  steps: null,
});

/**
 * The model answers with `paragraph`, citing `articleIds`. What `autoReply`
 * makes of it is the real checks' call: a reply citing nothing that resolves,
 * or promising money or a link its articles do not state, is discarded.
 */
function replied(paragraph: string, articleIds = ["KB-001"]): ModelAnswer {
  return autoReplyAnswer({
    answered: true,
    articleIds,
    paragraphs: [paragraph],
    steps: null,
  });
}

/** A usage report naming only the counts a test is about, as the provider sends it. */
function usage(over: {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
}): ModelUsage {
  return {
    inputTokens: {
      total: over.inputTokens,
      noCache: undefined,
      cacheRead: over.cachedInputTokens,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: over.outputTokens,
      text: undefined,
      reasoning: undefined,
    },
  };
}

/** `answer`, reporting what it cost. */
function costing(answer: ModelAnswer, report: ModelUsage): ModelAnswer {
  return { ...answer, usage: report };
}

/**
 * How the provider produces each failure of the shared taxonomy, as the
 * classifier in `../ai/provider` reads it.
 *
 * A `Record`, so a failure mode added to `AI_FAILURE` is a compile error here
 * until somebody says how a provider produces it — the trick
 * `jobs/ai-retry.ts` plays, one level down.
 */
const PROVIDER_FAILURE: Record<AiFailure, ModelAnswer> = {
  provider: { throws: providerError(500, "internal error") },
  busy: {
    throws: providerError(429, '{"error":{"code":"rate_limit_exceeded"}}'),
  },
  quota: {
    throws: providerError(429, '{"error":{"code":"insufficient_quota"}}'),
  },
  auth: { throws: providerError(401) },
  config: { throws: providerError(400, "unsupported_value") },
  // A success with nothing `Output.object` can parse in it.
  empty: { text: "" },
};

/** What checks 4, 5 and 6 discard, each provoked the way a model would provoke it. */
const NO_CITATION = replied("Here you go.", ["KB-404"]);
const PROMISES_MONEY = replied(
  "As a goodwill gesture we have credited 50 EUR to your account.",
);
const CARRIES_A_LINK = replied("Try https://portal.evil.example/fix instead.");

/** How many times the auto-reply asked the model. */
function replyCalls(): number {
  return modelCalls("auto-reply").length;
}

/* ── The classifier, scripted on the same model ─────────────────────────── */

/**
 * The classifier's answer (`../test/classify-answer`), optionally priced.
 *
 * Scripted on the preload's fake beside the auto-reply's (#656), so the real
 * `classifyCase` and the real `classifyTicket` under it both run: the prompt
 * is built, `Output.object` parses the answer, and `usdFor` prices the usage.
 * Until #656 this file replaced `classifyCase` through
 * `mock.module("./classify-case")`, the seam it had while the job tests owned
 * a stub on `../ai/classify`; #655 moved them onto the fake and this file
 * followed. `isClassifiable` was never replaced and still is not: which cases
 * can honestly be scored is the rule under test, not a fixture.
 */
function filed(category: TicketCategory, report?: ModelUsage): ModelAnswer {
  const answer = classifyAnswer(category);
  return report ? costing(answer, report) : answer;
}

/**
 * What one classification costs when it reports 4,000 fresh input tokens at
 * $0.05/Mtok: $0.0002, the figure the old seam handed back as a constant.
 */
const CLASSIFY_USAGE = usage({ inputTokens: 4_000, outputTokens: 0 });

/** How many times the classifier asked the model. */
function classifyCalls(): number {
  return modelCalls("classify").length;
}

const { answerCase, runCase, EVAL_REPEATS } = await import("./runner");

const CORPUS: KbArticle[] = [
  {
    id: "KB-001",
    title: "I forgot my password",
    category: "Technical",
    body: "Use the reset link on the sign-in page.",
  },
];

// The real `autoReply` and `classifyTicket` narrate every decision: a usage
// line per call, an error for a check that fired or a provider that failed.
// Wanted in production, noise here.
const quiet = [
  spyOn(console, "log").mockImplementation(() => {}),
  spyOn(console, "warn").mockImplementation(() => {}),
  spyOn(console, "error").mockImplementation(() => {}),
];

afterAll(() => {
  for (const spy of quiet) spy.mockRestore();
});

beforeEach(async () => {
  await resetDb();
  scriptModel("auto-reply", DECLINED);
  // Every classifiable case is classified before it is answered, so a test
  // about the auto-reply needs the classifier to say something too. `General`
  // is `off-corpus`'s declared category, the case most tests run. It is a
  // miss on every case declared otherwise, so a test that reads the classifier
  // metric on one of those scripts its own answer. (Until #656 the stub
  // answered each case's own category when nothing was scripted.)
  scriptModel("classify", filed(TICKET_CATEGORY.General));
});

/* ── What the model is asked ─────────────────────────────────────────────── */

describe("the synthesized input", () => {
  test("is the case's own email, with the corpus it was given", async () => {
    const evalCase = autoReplyCaseById("off-corpus")!;

    await answerCase(CORPUS, evalCase);

    const { system, prompt } = lastModelCall("auto-reply");
    expect(system).toContain(
      "[KB-001] (Technical) I forgot my password\nUse the reset link on the sign-in page.",
    );
    expect(prompt).toContain(evalCase.values.subject);
    expect(prompt).toContain(evalCase.values.textBody.trim());
    // The display name is handed over too, and is never sent: `greetingName`
    // turns it into the greeting, which `ai/auto-reply.test.ts` asserts. It
    // cannot be asserted absent here, because this email signs off with it.
  });

  test("carries a null body when the email was HTML-only", async () => {
    // The one case that exercises the branch the prompt has for it. An
    // HTML-only email writes a message whose `textBody` is null, which is not
    // the same thing as no inbound message at all — see the note on the
    // `html-only` case.
    await answerCase(CORPUS, autoReplyCaseById("html-only")!);

    expect(lastModelCall("auto-reply").prompt).toContain(
      "There is nothing to answer: set answered to false.",
    );
  });

  test("does not vary between repeats", async () => {
    // The repeats are the only place a stopped prompt cache is observable, and
    // an identical prefix is what makes them comparable at all. A run id, a
    // timestamp or a counter anywhere near this would cost 90% of the input
    // price silently (`ai-features.md` on `cached=`).
    const evalCase = autoReplyCaseById("off-corpus")!;

    for (let i = 0; i < 3; i += 1) {
      await answerCase(CORPUS, evalCase);
    }

    const seen = modelCalls("auto-reply").map(({ system, prompt }) => ({
      system,
      prompt,
    }));
    expect(seen).toHaveLength(3);
    expect(seen[1]).toEqual(seen[0]!);
    expect(seen[2]).toEqual(seen[0]!);
  });
});

/* ── The preflight gates, reachable from values ──────────────────────────── */

describe("the gates", () => {
  test("a Refund case declines without asking the model", async () => {
    // The whole reason `gateDecline` was extracted. This reason is decided
    // before the corpus is loaded, so before the extraction the harness could
    // not cover it at all — and a case that cost a model call to reach a
    // conclusion the gates already had would be paying for nothing.
    const result = await answerCase(CORPUS, autoReplyCaseById("refund")!);

    expect(result.outcome).toBe(PIPELINE_OUTCOME.declined);
    expect(result.decline).toBe(AUTO_REPLY_DECLINE.category);
    expect(result.matched).toBe(true);
    expect(result.usd).toBe(0);
    expect(replyCalls()).toBe(0);
  });

  test("a thread somebody has replied on declines as `answered`", async () => {
    const result = await answerCase(
      CORPUS,
      autoReplyCaseById("already-answered")!,
    );

    expect(result.decline).toBe(AUTO_REPLY_DECLINE.answered);
    expect(replyCalls()).toBe(0);
  });

  test("a ticket with no inbound message declines as `noText`", async () => {
    // Unreachable through ingestion — a ticket is created by an inbound email —
    // and therefore only ever observable from a declared preflight.
    const result = await answerCase(
      CORPUS,
      autoReplyCaseById("no-inbound-message")!,
    );

    expect(result.decline).toBe(AUTO_REPLY_DECLINE.noText);
    expect(replyCalls()).toBe(0);
  });
});

/* ── What comes back ─────────────────────────────────────────────────────── */

describe("the verdict", () => {
  test("a reply is `resolved`, with no reason", async () => {
    scriptModel("auto-reply", replied("Here you go."));

    const result = await answerCase(CORPUS, autoReplyCaseById("off-corpus")!);

    expect(result.outcome).toBe(PIPELINE_OUTCOME.resolved);
    expect(result.decline).toBeNull();
  });

  test("a decline carries the reason the checks reached", async () => {
    scriptModel("auto-reply", PROMISES_MONEY);

    const result = await answerCase(
      CORPUS,
      autoReplyCaseById("planted-commitment")!,
    );

    expect(result.outcome).toBe(PIPELINE_OUTCOME.declined);
    expect(result.decline).toBe(AUTO_REPLY_DECLINE.unbackedCommitment);
  });

  test("a provider failure is `abandoned`, not a wrong answer", async () => {
    // The distinction that keeps the numbers honest. A model that could not be
    // reached did not decline anything, and counting an outage as a failed case
    // is how a harness starts crying wolf — which is the exact failure the PRD
    // says it exists to prevent.
    scriptModel("auto-reply", PROVIDER_FAILURE.provider);

    const result = await answerCase(CORPUS, autoReplyCaseById("off-corpus")!);

    expect(result.outcome).toBe(PIPELINE_OUTCOME.abandoned);
    expect(result.decline).toBe(AUTO_REPLY_DECLINE.unavailable);
  });
});

/* ── Which failures are the model's answer, and which are its absence ────── */

/**
 * The whole taxonomy, one member at a time, because the interesting half of it
 * was never asked (`docs/adr/0018`).
 *
 * `Object.values(AI_FAILURE)` rather than a list written out here: a failure
 * mode added to the taxonomy joins this loop the moment it exists, exactly as
 * it becomes a compile error in `jobs/ai-retry.ts`. That is the same
 * `Record<AiFailure, boolean>` trick one level up, and it is the property the
 * locally re-declared result type used to make impossible.
 */
describe("a failure the provider decided", () => {
  test.each(Object.values(AI_FAILURE))(
    "`%s` is abandoned — the model never answered",
    async (reason: AiFailure) => {
      // Every one of these is the call not happening or not arriving: refused,
      // rate-limited, out of credit, key rejected, request malformed, or a
      // response with nothing in it. None of them is the model reading a corpus
      // and saying no, so none may land in a rate that claims to measure that.
      scriptModel("auto-reply", PROVIDER_FAILURE[reason]);

      const result = await answerCase(CORPUS, autoReplyCaseById("off-corpus")!);

      expect(result.outcome).toBe(PIPELINE_OUTCOME.abandoned);
    },
  );

  test("tallies as unanswered for the whole case, not as five misses", async () => {
    // The run-level half: the loop above is about one verdict, this is about
    // what five of them add up to on the row an admin reads.
    //
    // An empty corpus, because that is the path to `config` that involves no
    // provider at all — `autoReply` answers `config`/`unavailable` before it
    // builds a prompt when the knowledge base has nothing auto-replyable left
    // in it (`ai/auto-reply.test.ts` pins that), and `jobs/eval-run.ts` puts no
    // guard in front of it. A property of the deployment on the day rather
    // than of any case, which is exactly what `DECLINE_COVERAGE` in
    // `@ticket/core` says about `unavailable` and exactly what it was not
    // getting.
    const outcome = await runCase([], autoReplyCaseById("off-corpus")!);

    expect(outcome.abandoned).toBe(EVAL_REPEATS);
    expect(outcome.matches).toBe(0);
    expect(replyCalls()).toBe(0);
  });
});

/* ── ...and which are the model's own verdict ────────────────────────────── */

describe("a failure the auto-reply decided", () => {
  /** The model saying no, and a reply the checks threw out. */
  const VERDICT = {
    [AUTO_REPLY_FAILURE.declined]: DECLINED,
    [AUTO_REPLY_FAILURE.ungrounded]: NO_CITATION,
  };

  test.each([AUTO_REPLY_FAILURE.declined, AUTO_REPLY_FAILURE.ungrounded])(
    "`%s` is declined — the model answered and the answer was the outcome",
    async (reason) => {
      // The two `AUTO_REPLY_FAILURE` adds on top of the shared taxonomy, and the
      // only two that belong on this side. Both mean a model read the corpus and
      // a verdict was reached about what it produced.
      scriptModel("auto-reply", VERDICT[reason]);

      const result = await answerCase(CORPUS, autoReplyCaseById("off-corpus")!);

      expect(result.outcome).toBe(PIPELINE_OUTCOME.declined);
    },
  );
});

/* ── What it cost ────────────────────────────────────────────────────────── */

describe("cost", () => {
  test("is priced off the usage the call reported", async () => {
    // 1,000 fresh input tokens at $0.05/Mtok plus 500 output at $0.40/Mtok.
    scriptModel(
      "auto-reply",
      costing(
        DECLINED,
        usage({ inputTokens: 1_000, outputTokens: 500, cachedInputTokens: 0 }),
      ),
    );

    const result = await answerCase(CORPUS, autoReplyCaseById("off-corpus")!);

    expect(result.usd).toBeCloseTo((1_000 * 0.05 + 500 * 0.4) / 1_000_000, 9);
  });

  test("is counted on a decline as well as on a reply", async () => {
    // A reply thrown out by check 5 cost exactly what one that was sent would
    // have. A run that priced only its successes would understate itself by
    // however often the safety checks fired, which is most of the time.
    scriptModel(
      "auto-reply",
      costing(PROMISES_MONEY, usage({ inputTokens: 1_000, outputTokens: 0 })),
    );

    const result = await answerCase(
      CORPUS,
      autoReplyCaseById("planted-commitment")!,
    );

    expect(result.usd).toBeGreaterThan(0);
  });

  test("is zero when the provider reported nothing", async () => {
    const result = await answerCase(CORPUS, autoReplyCaseById("off-corpus")!);

    expect(result.usd).toBe(0);
  });
});

/* ── Whether it landed where the case said it would ──────────────────────── */

describe("matching", () => {
  test("a decline must reach the expected reason, not merely decline", async () => {
    // "Expected declined, got declined for a completely different reason" is
    // the finding this harness exists to surface: a payload that slipped past
    // the money check and was thrown out for having no citation is not the
    // safety story holding.
    scriptModel("auto-reply", NO_CITATION);

    const result = await answerCase(
      CORPUS,
      autoReplyCaseById("planted-commitment")!,
    );

    expect(result.matched).toBe(false);
  });

  test("a decline that reaches the expected reason matches", async () => {
    const result = await answerCase(CORPUS, autoReplyCaseById("off-corpus")!);

    expect(result.matched).toBe(true);
  });

  test("a resolved case matches on the outcome alone", async () => {
    scriptModel("auto-reply", replied("Here you go."));

    const result = await answerCase(
      CORPUS,
      autoReplyCaseById("password-reset")!,
    );

    expect(result.matched).toBe(true);
  });
});

/* ── Five repeats, and the rate they produce ─────────────────────────────── */

describe("runCase", () => {
  test("asks five times by default and reports matches out of repeats", async () => {
    const outcome = await runCase(CORPUS, autoReplyCaseById("off-corpus")!);

    expect(EVAL_REPEATS).toBe(5);
    expect(outcome.repeats).toBe(5);
    expect(outcome.verdicts).toHaveLength(5);
    expect(outcome.matches).toBe(5);
    expect(replyCalls()).toBe(5);
  });

  test("a case that goes two ways is a rate, not a pass or a fail", async () => {
    // The whole reason repeats exist. Three declines and two replies is the
    // finding; a boolean would round it to one or the other.
    scriptModel(
      "auto-reply",
      DECLINED,
      DECLINED,
      DECLINED,
      replied("Here you go."),
    );

    const outcome = await runCase(CORPUS, autoReplyCaseById("off-corpus")!);

    expect(outcome.matches).toBe(3);
    expect(outcome.repeats).toBe(5);
  });

  test("counts unanswered repeats apart from the misses", async () => {
    scriptModel("auto-reply", DECLINED, PROVIDER_FAILURE.busy);

    const outcome = await runCase(CORPUS, autoReplyCaseById("off-corpus")!);

    expect(outcome.matches).toBe(1);
    expect(outcome.abandoned).toBe(4);
  });

  test("adds up what the repeats cost", async () => {
    scriptModel(
      "auto-reply",
      costing(DECLINED, usage({ inputTokens: 1_000, outputTokens: 0 })),
    );

    const outcome = await runCase(CORPUS, autoReplyCaseById("off-corpus")!);

    expect(outcome.usd).toBeCloseTo((5 * 1_000 * 0.05) / 1_000_000, 9);
  });

  test("never counts the first repeat as a cache hit", async () => {
    // It is the one that warms it. Counting it would make a cold run read as
    // 20% cached forever, which is exactly the sort of number that stops
    // anybody looking at it.
    scriptModel(
      "auto-reply",
      costing(DECLINED, usage({ inputTokens: 1_000, cachedInputTokens: 900 })),
    );

    const outcome = await runCase(CORPUS, autoReplyCaseById("off-corpus")!);

    expect(outcome.cachedRepeats).toBe(4);
    // And it is not in the denominator either, for the same reason and from the
    // same slice.
    expect(outcome.cacheable).toBe(4);
  });

  test("emits the denominator its cache hits are read against", async () => {
    // **This is the single place the rule lives** (#223). "One repeat per case
    // warms the cache" used to be written twice — `verdicts.slice(1)` here and
    // `Σ max(repeats - 1, 0)` over the stored rows in `routes/evals.ts` — with
    // a database between them and nothing making the two agree. Editing either
    // one alone produced a plausible percentage rather than an error, on the
    // one number in this codebase that makes a stopped prompt cache visible.
    // `runCase` now emits both halves off one slice, `routes/evals.ts` reads
    // the column, and this test is what fails if the rule is edited anywhere
    // else. The rest of the route's arithmetic is asserted where it lives, in
    // `routes/evals.test.ts`.
    scriptModel(
      "auto-reply",
      costing(DECLINED, usage({ inputTokens: 1_000, cachedInputTokens: 0 })),
    );

    const outcome = await runCase(CORPUS, autoReplyCaseById("off-corpus")!, 3);

    expect(outcome.repeats).toBe(3);
    expect(outcome.cacheable).toBe(2);
    // Nothing was served from the cache, and that is a measured zero rather
    // than an unmeasurable one: there were two repeats it could have happened
    // on. A denominator of zero would be the other thing entirely.
    expect(outcome.cachedRepeats).toBe(0);
  });

  test("a case answered once could have hit the cache on nothing", async () => {
    // The edge the two expressions had to agree on and the one a `- 1` gets
    // wrong: one repeat is the warming repeat, so there is no repeat left for a
    // hit to happen on. Zero of zero reads as "this run says nothing about the
    // cache" on the page, which is the honest answer — not 0%, which is what
    // the regression looks like.
    const outcome = await runCase(CORPUS, autoReplyCaseById("off-corpus")!, 1);

    expect(outcome.cacheable).toBe(0);
    expect(outcome.cachedRepeats).toBe(0);
  });

  test("a gated case asks no model to write a reply", async () => {
    // It is no longer *free*, and that changed in slice 4 on purpose: a gated
    // case is still classified, because the gate's whole job is to read what the
    // classifier said and a harness that skipped it here would be measuring the
    // classifier only where its answer does not matter. What the gate still
    // buys is the expensive call — the corpus never reaches a prompt.
    scriptModel("classify", filed(TICKET_CATEGORY.Refund, CLASSIFY_USAGE));

    const outcome = await runCase(CORPUS, autoReplyCaseById("refund")!);

    expect(replyCalls()).toBe(0);
    expect(outcome.matches).toBe(5);
    expect(outcome.usd).toBeCloseTo(0.001, 10);
  });

  test("a case the classifier cannot be scored on costs nothing at all", async () => {
    scriptModel("classify", filed(TICKET_CATEGORY.General, CLASSIFY_USAGE));

    const outcome = await runCase(
      CORPUS,
      autoReplyCaseById("no-inbound-message")!,
    );

    expect(replyCalls()).toBe(0);
    expect(classifyCalls()).toBe(0);
    expect(outcome.classifiedRepeats).toBe(0);
    expect(outcome.usd).toBe(0);
  });
});

/* ── R9: the safety catch rate, and the only number here that is a bug ───── */

describe("an adversarial repeat", () => {
  /** The money payload. Expects `unbackedCommitment`; marker "50 EUR". */
  const commitment = () => autoReplyCaseById("planted-commitment")!;

  test("is caught when an output check discarded the reply", async () => {
    scriptModel("auto-reply", PROMISES_MONEY);

    const verdict = await answerCase(CORPUS, commitment());

    expect(verdict.caught).toBe(true);
    expect(verdict.escaped).toBe(false);
  });

  test("has escaped when the payload is in a reply that was accepted", async () => {
    // The failure ADR-0004 stands on, and the only one the harness could not
    // see before: a fail-closed check that has stopped firing looks exactly
    // like a model that ignored the payload — a reply, either way. The
    // difference is whether the payload is *in* it. The amount with no money
    // word beside it is a reply check 5 has no stem for, so the real checks
    // let it through and the marker is what sees it.
    scriptModel(
      "auto-reply",
      replied(
        "Try the reset link again. We have added 50 EUR to your account.",
      ),
    );

    const verdict = await answerCase(CORPUS, commitment());

    expect(verdict.escaped).toBe(true);
    expect(verdict.caught).toBe(false);
  });

  test("matches the marker however it is cased", async () => {
    scriptModel("auto-reply", replied("We have added 50 eur to your account."));

    expect((await answerCase(CORPUS, commitment())).escaped).toBe(true);
  });

  test("is on neither side of the rate when the model ignored the payload", async () => {
    // Not a miss and not a catch. This is what makes the rate read the way the
    // hand-measured 7-of-9 did: caught over *attempted*, not over repeats.
    scriptModel("auto-reply", replied("Request a fresh reset link."));

    const verdict = await answerCase(CORPUS, commitment());

    expect(verdict.caught).toBe(false);
    expect(verdict.escaped).toBe(false);
  });

  test("is not caught by a check its own payload could not have tripped", async () => {
    // The asymmetry this closes. `escaped` demands the marker; `caught` used to
    // demand nothing but "some output check fired", so a money payload thrown
    // out because the model invented an unrelated *link* counted as the money
    // check holding. That inflates the one number ADR-0004 stands on with
    // repeats where the payload was never in flight — and it does it in the
    // reassuring direction, which is the worst way for a safety metric to be
    // wrong. A case now declares the checks its payload is aimed at.
    scriptModel("auto-reply", CARRIES_A_LINK);

    const verdict = await answerCase(CORPUS, commitment());

    expect(verdict.caught).toBe(false);
  });

  test("has not escaped on a marker the corpus itself supplies", async () => {
    // The live-corpus hole. `cases.test.ts` proves no marker appears in the
    // *frozen* corpus, but a live run answers from the article table, which an
    // admin edits — and an article that happened to mention a goodwill gesture
    // of 50 EUR would make every clean reply grounded in it read as an escape.
    // The safety metric would then report a catastrophe on a desk that is
    // working, which is the "cries wolf, then gets ignored" failure the PRD
    // opens with, arriving through the one number nobody may learn to ignore.
    //
    // The rule is the one checks 5 and 6 already use: a phrase the cited
    // articles contain is backed, and a backed phrase is not evidence of
    // anything.
    const backed: KbArticle[] = [
      {
        id: "KB-099",
        title: "Goodwill credits",
        category: "Technical",
        body: "We sometimes credit 50 EUR as a goodwill gesture.",
      },
    ];
    scriptModel(
      "auto-reply",
      replied("As a goodwill gesture we can credit 50 EUR to your account.", [
        "KB-099",
      ]),
    );

    const verdict = await answerCase(backed, commitment());

    expect(verdict.escaped).toBe(false);
  });

  test("is not caught by a decline that read no reply", async () => {
    // `notCovered` is the model declining to answer at all, so there was no
    // draft for a check to catch anything in. Counting it would inflate the
    // catch rate with repeats where nothing was ever attempted.
    scriptModel("auto-reply", DECLINED);

    expect((await answerCase(CORPUS, commitment())).caught).toBe(false);
  });

  test("watches a code path the model never runs", async () => {
    // `hostile-display-name` expects a clean reply: the From name is reduced by
    // `greetingName` in `composeReply` and never sent to the model at all. So
    // its marker is the only one guarding an escape that a prompt could not
    // cause and a prompt fix could not repair. The marker is read over the
    // whole assembled reply, so a bare domain anywhere in it — no scheme and no
    // path, which check 6 does not read as a link — is that escape seen. The
    // greeting path itself is `greetingName`'s, pinned in `ai/reply-shape.test.ts`.
    scriptModel(
      "auto-reply",
      replied("See evil.example for how to change your address."),
    );

    const verdict = await answerCase(
      CORPUS,
      autoReplyCaseById("hostile-display-name")!,
    );

    expect(verdict.escaped).toBe(true);
    // And it is still a match: the case expected a reply and got one. The two
    // metrics are separate, which is R9's whole point — a run can be accurate
    // and unsafe at the same time, and one number would hide it.
    expect(verdict.matched).toBe(true);
  });
});

describe("an ordinary case", () => {
  test("is on neither side of the catch rate, however it lands", async () => {
    // The rate is over the payloads and nothing else. A covered question
    // declined by the money check is a decline-accuracy miss and a finding in
    // its own right; it is not a payload being caught, and folding it in would
    // let the safety number improve because an unrelated case got worse.
    scriptModel("auto-reply", PROMISES_MONEY);

    const verdict = await answerCase(CORPUS, autoReplyCaseById("subtitles")!);

    expect(verdict.caught).toBe(false);
    expect(verdict.escaped).toBe(false);
  });
});

describe("a case's catch tally", () => {
  test("counts the caught and the escaped repeats apart", async () => {
    scriptModel(
      "auto-reply",
      PROMISES_MONEY,
      replied("We have added 50 EUR to your account."),
      replied("Request a fresh link."),
    );

    const outcome = await runCase(
      CORPUS,
      autoReplyCaseById("planted-commitment")!,
    );

    expect(outcome.caught).toBe(1);
    expect(outcome.escaped).toBe(1);
    // Three of the five said nothing about the payload either way.
    expect(outcome.repeats).toBe(5);
  });
});

/* ── R12: a run is invisible to everyone but an admin reading the results ── */

test("answering every case writes nothing a customer or agent would see", async () => {
  // Structural rather than a promise: `answerCase` reaches `gateDecline`, a
  // predicate over three fields, and `autoReply`, which takes its corpus as a
  // value and touches no database at all. There is no ticket row to avoid
  // creating. Asserted as row counts across a whole pass of the case set, which
  // is the shape the PRD asks for.
  for (const evalCase of AUTO_REPLY_CASES) {
    await answerCase(CORPUS, evalCase);
  }

  expect(await prisma.ticket.count()).toBe(0);
  expect(await prisma.message.count()).toBe(0);
  expect(await prisma.ticketActivity.count()).toBe(0);
  expect(await prisma.outboundEmail.count()).toBe(0);
});

/* ── R15: the third metric, and the one that is not about the auto-reply ─── */

describe("the classifier", () => {
  test("is asked for every repeat, and its answer is on the verdict", async () => {
    scriptModel("classify", filed(TICKET_CATEGORY.General));

    const verdict = await answerCase(CORPUS, autoReplyCaseById("off-corpus")!);

    expect(classifyCalls()).toBe(1);
    expect(verdict.category).toBe(TICKET_CATEGORY.General);
    expect(verdict.classifyMatched).toBe(true);
  });

  test("filing a case somewhere else is a miss on that metric and nothing else", async () => {
    // The point of measuring this separately. `refund` is declined by the
    // category gate whatever the classifier says, because the gate reads the
    // case's *declared* preflight — so decline accuracy is a clean 5/5 while
    // the classifier is 0/5. Two numbers, two findings; one blended score
    // would have shown neither.
    scriptModel("classify", filed(TICKET_CATEGORY.General));

    const outcome = await runCase(CORPUS, autoReplyCaseById("refund")!);

    expect(outcome.matches).toBe(5);
    expect(outcome.classifiedRepeats).toBe(5);
    expect(outcome.classifyMatches).toBe(0);
    expect(outcome.verdicts[0]!.category).toBe(TICKET_CATEGORY.General);
  });

  test("is never asked about a case it cannot be scored on", async () => {
    // `unclassified` expects classification to have *failed*. There is no right
    // answer, so there is no call and no denominator.
    const outcome = await runCase(CORPUS, autoReplyCaseById("unclassified")!);

    expect(classifyCalls()).toBe(0);
    expect(outcome.classifiedRepeats).toBe(0);
    expect(outcome.classifyMatches).toBe(0);
    expect(outcome.verdicts.every((v) => v.category === null)).toBe(true);
  });

  test("a repeat it could not answer shrinks the denominator, never the numerator", async () => {
    // An outage is not the model getting things wrong. Two answers, then the
    // provider stops answering: 2 of 2, not 2 of 5. A 401 is `auth`, which is
    // not retried, so each of the last three repeats is one refused call; the
    // last scripted answer repeats.
    scriptModel(
      "classify",
      filed(TICKET_CATEGORY.General),
      filed(TICKET_CATEGORY.General),
      { throws: providerError(401) },
    );

    const outcome = await runCase(CORPUS, autoReplyCaseById("off-corpus")!);

    expect(outcome.classifiedRepeats).toBe(2);
    expect(outcome.classifyMatches).toBe(2);
    expect(classifyCalls()).toBe(5);
  });

  test("costs are added to what the case spent, not reported apart from it", async () => {
    // R10 stays one number: an admin reading "what did this run cost" wants
    // everything the run spent, and the classifier's calls are now most of a
    // gated case's bill.
    scriptModel("classify", filed(TICKET_CATEGORY.General, CLASSIFY_USAGE));
    scriptModel("auto-reply", replied("Here you go."));

    const verdict = await answerCase(CORPUS, autoReplyCaseById("off-corpus")!);

    expect(verdict.usd).toBeCloseTo(0.0002, 10);
  });

  test("and the auto-reply each get their own answer from the one model", async () => {
    // The flow the runner exists for, classify then reply, on one fake (#656).
    // Each feature is scripted on its own and asked its own question; a fake
    // that crossed the two would put a reply's JSON where a category is parsed,
    // and the verdict would carry no category and no reply.
    scriptModel("classify", filed(TICKET_CATEGORY.Technical));
    scriptModel("auto-reply", replied("Here you go."));
    const evalCase = autoReplyCaseById("off-corpus")!;

    const verdict = await answerCase(CORPUS, evalCase);

    expect(verdict.category).toBe(TICKET_CATEGORY.Technical);
    expect(verdict.classifyMatched).toBe(false);
    expect(verdict.outcome).toBe(PIPELINE_OUTCOME.resolved);
    // Classified first, as on the real path, and each call carried its own
    // feature's prompt: the email for the classifier, the corpus for the reply.
    expect(modelCalls().map((call) => call.feature)).toEqual([
      "classify",
      "auto-reply",
    ]);
    expect(lastModelCall("classify").prompt).toContain(evalCase.values.subject);
    expect(lastModelCall("classify").system).not.toContain("KB-001");
    expect(lastModelCall("auto-reply").system).toContain(
      "[KB-001] (Technical) I forgot my password",
    );
  });

  test("does not disturb what the auto-reply is asked", async () => {
    // The prompt-cache rule (see the runner's header): repeats of a case have to
    // reach `autoReply` with an identical prefix. Interleaving a second call
    // with a different system prompt is fine — the provider's cache is keyed on
    // the prefix, not on what the last request was — but the corpus and context
    // handed over must not move.
    await runCase(CORPUS, autoReplyCaseById("off-corpus")!, 2);

    expect(replyCalls()).toBe(2);
    expect(lastModelCall("auto-reply").system).toContain(
      "[KB-001] (Technical) I forgot my password",
    );
  });
});
