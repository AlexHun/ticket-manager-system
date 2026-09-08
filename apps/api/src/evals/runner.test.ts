/**
 * Unit tests for `apps/api/src/evals/runner.ts`.
 *
 * What slice 1 of the eval harness existed to retire and this slice extends:
 * that handing a hand-built `AutoReplyContext` to `autoReply` reproduces a
 * verdict the pipeline would have reached, that the three preflight gates are
 * now reachable from values, and that a run writes nothing a customer or an
 * agent would see (PRD R12).
 *
 * `../ai/auto-reply` is stubbed rather than called, and that is the honest
 * seam: what is under test here is the **translation** — an `AutoReplyResult`
 * into an outcome, an outcome into a match, five of them into a rate — not what
 * the model says. The model half is measured by running the thing, which is
 * what the harness is for, and exercised end to end against the E2E suite's
 * fake provider in `tests/e2e/evals.spec.ts`.
 *
 * The R12 assertion is the interesting one and it is deliberately made against
 * a **real** database (`../test/pg`, ADR-0014) rather than a count of calls on
 * a fake: the claim is that the code path a run reaches cannot write a ticket,
 * and a fake client could only tell us that this test did not ask it to.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  AUTO_REPLY_DECLINE,
  PIPELINE_OUTCOME,
  type AutoReplyDecline,
} from "@ticket/shared";
import { autoReplyCaseById, AUTO_REPLY_CASES } from "@ticket/core";
import { prisma, resetDb } from "../test/pg";
import type { AiUsage } from "../ai/provider";
import type { KbArticle } from "../ai/knowledge-base";

/* ── The model, replaced by whatever this file wants it to say ───────────── */

type AutoReplyOutcome = { usage?: AiUsage } & (
  | { ok: true; reply: string; articleIds: string[] }
  | { ok: false; reason: string; decline: AutoReplyDecline }
);

const DECLINED: AutoReplyOutcome = {
  ok: false,
  reason: "declined",
  decline: AUTO_REPLY_DECLINE.notCovered,
};

/** Answers, in order. The last one is repeated once the list runs out. */
let script: AutoReplyOutcome[] = [DECLINED];
let calls = 0;

/** What `autoReply` was handed, so the synthesized context can be asserted. */
let lastCall: { articles: KbArticle[]; context: unknown } | undefined;

const actual = await import("../ai/auto-reply");

mock.module("../ai/auto-reply", () => ({
  ...actual,
  autoReply: async (articles: KbArticle[], context: unknown) => {
    lastCall = { articles, context };
    const answer = script[Math.min(calls, script.length - 1)]!;
    calls += 1;
    return answer;
  },
}));

const { answerCase, runCase, EVAL_REPEATS } = await import("./runner");

const CORPUS: KbArticle[] = [
  {
    id: "KB-001",
    title: "I forgot my password",
    category: "Technical",
    body: "Use the reset link on the sign-in page.",
  },
];

beforeEach(async () => {
  await resetDb();
  lastCall = undefined;
  calls = 0;
  script = [DECLINED];
});

/* ── What the model is asked ─────────────────────────────────────────────── */

describe("the synthesized input", () => {
  test("is the case's own email, with the corpus it was given", async () => {
    const evalCase = autoReplyCaseById("off-corpus")!;

    await answerCase(CORPUS, evalCase);

    expect(lastCall?.articles).toBe(CORPUS);
    expect(lastCall?.context).toEqual({
      subject: evalCase.values.subject,
      text: evalCase.values.textBody,
      customerName: evalCase.values.senderName,
    });
  });

  test("carries a null body when the email was HTML-only", async () => {
    // The one case that exercises the branch the prompt has for it. An
    // HTML-only email writes a message whose `textBody` is null, which is not
    // the same thing as no inbound message at all — see the note on the
    // `html-only` case.
    await answerCase(CORPUS, autoReplyCaseById("html-only")!);

    expect((lastCall?.context as { text: unknown }).text).toBeNull();
  });

  test("does not vary between repeats", async () => {
    // The repeats are the only place a stopped prompt cache is observable, and
    // an identical prefix is what makes them comparable at all. A run id, a
    // timestamp or a counter anywhere near this would cost 90% of the input
    // price silently (`ai-features.md` on `cached=`).
    const evalCase = autoReplyCaseById("off-corpus")!;
    const seen: unknown[] = [];
    script = [DECLINED];

    for (let i = 0; i < 3; i += 1) {
      await answerCase(CORPUS, evalCase);
      seen.push(lastCall?.context);
    }

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
    expect(lastCall).toBeUndefined();
  });

  test("a thread somebody has replied on declines as `answered`", async () => {
    const result = await answerCase(
      CORPUS,
      autoReplyCaseById("already-answered")!,
    );

    expect(result.decline).toBe(AUTO_REPLY_DECLINE.answered);
    expect(lastCall).toBeUndefined();
  });

  test("a ticket with no inbound message declines as `noText`", async () => {
    // Unreachable through ingestion — a ticket is created by an inbound email —
    // and therefore only ever observable from a declared preflight.
    const result = await answerCase(
      CORPUS,
      autoReplyCaseById("no-inbound-message")!,
    );

    expect(result.decline).toBe(AUTO_REPLY_DECLINE.noText);
    expect(lastCall).toBeUndefined();
  });
});

/* ── What comes back ─────────────────────────────────────────────────────── */

describe("the verdict", () => {
  test("a reply is `resolved`, with no reason", async () => {
    script = [{ ok: true, reply: "Here you go.", articleIds: ["KB-001"] }];

    const result = await answerCase(CORPUS, autoReplyCaseById("off-corpus")!);

    expect(result.outcome).toBe(PIPELINE_OUTCOME.resolved);
    expect(result.decline).toBeNull();
  });

  test("a decline carries the reason the checks reached", async () => {
    script = [
      {
        ok: false,
        reason: "ungrounded",
        decline: AUTO_REPLY_DECLINE.unbackedCommitment,
      },
    ];

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
    script = [
      {
        ok: false,
        reason: "provider",
        decline: AUTO_REPLY_DECLINE.unavailable,
      },
    ];

    const result = await answerCase(CORPUS, autoReplyCaseById("off-corpus")!);

    expect(result.outcome).toBe(PIPELINE_OUTCOME.abandoned);
    expect(result.decline).toBe(AUTO_REPLY_DECLINE.unavailable);
  });
});

/* ── What it cost ────────────────────────────────────────────────────────── */

describe("cost", () => {
  test("is priced off the usage the call reported", async () => {
    // 1,000 fresh input tokens at $0.05/Mtok plus 500 output at $0.40/Mtok.
    script = [
      {
        ...DECLINED,
        usage: { inputTokens: 1_000, outputTokens: 500, cachedInputTokens: 0 },
      },
    ];

    const result = await answerCase(CORPUS, autoReplyCaseById("off-corpus")!);

    expect(result.usd).toBeCloseTo((1_000 * 0.05 + 500 * 0.4) / 1_000_000, 9);
  });

  test("is counted on a decline as well as on a reply", async () => {
    // A reply thrown out by check 5 cost exactly what one that was sent would
    // have. A run that priced only its successes would understate itself by
    // however often the safety checks fired, which is most of the time.
    script = [
      {
        ok: false,
        reason: "ungrounded",
        decline: AUTO_REPLY_DECLINE.unbackedCommitment,
        usage: { inputTokens: 1_000, outputTokens: 0 },
      },
    ];

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
    script = [
      {
        ok: false,
        reason: "ungrounded",
        decline: AUTO_REPLY_DECLINE.noCitation,
      },
    ];

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
    script = [{ ok: true, reply: "Here you go.", articleIds: ["KB-001"] }];

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
    expect(calls).toBe(5);
  });

  test("a case that goes two ways is a rate, not a pass or a fail", async () => {
    // The whole reason repeats exist. Three declines and two replies is the
    // finding; a boolean would round it to one or the other.
    script = [
      DECLINED,
      DECLINED,
      DECLINED,
      { ok: true, reply: "Here you go.", articleIds: ["KB-001"] },
      { ok: true, reply: "Here you go.", articleIds: ["KB-001"] },
    ];

    const outcome = await runCase(CORPUS, autoReplyCaseById("off-corpus")!);

    expect(outcome.matches).toBe(3);
    expect(outcome.repeats).toBe(5);
  });

  test("counts unanswered repeats apart from the misses", async () => {
    script = [
      DECLINED,
      { ok: false, reason: "busy", decline: AUTO_REPLY_DECLINE.unavailable },
    ];

    const outcome = await runCase(CORPUS, autoReplyCaseById("off-corpus")!);

    expect(outcome.matches).toBe(1);
    expect(outcome.abandoned).toBe(4);
  });

  test("adds up what the repeats cost", async () => {
    script = [{ ...DECLINED, usage: { inputTokens: 1_000, outputTokens: 0 } }];

    const outcome = await runCase(CORPUS, autoReplyCaseById("off-corpus")!);

    expect(outcome.usd).toBeCloseTo((5 * 1_000 * 0.05) / 1_000_000, 9);
  });

  test("never counts the first repeat as a cache hit", async () => {
    // It is the one that warms it. Counting it would make a cold run read as
    // 20% cached forever, which is exactly the sort of number that stops
    // anybody looking at it.
    script = [
      { ...DECLINED, usage: { inputTokens: 1_000, cachedInputTokens: 900 } },
    ];

    const outcome = await runCase(CORPUS, autoReplyCaseById("off-corpus")!);

    expect(outcome.cachedRepeats).toBe(4);
  });

  test("a gated case costs no model calls at all", async () => {
    const outcome = await runCase(CORPUS, autoReplyCaseById("refund")!);

    expect(calls).toBe(0);
    expect(outcome.matches).toBe(5);
    expect(outcome.usd).toBe(0);
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
