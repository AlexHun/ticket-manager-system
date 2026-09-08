/**
 * Unit tests for `apps/api/src/evals/runner.ts`.
 *
 * The one thing slice 1 of the eval harness exists to retire: that handing a
 * hand-built `AutoReplyContext` to `autoReply` reproduces a verdict the
 * pipeline would have reached, and that a run writes nothing a customer or an
 * agent would see (PRD R12). Everything else in this epic assumes both.
 *
 * `../ai/auto-reply` is stubbed rather than called, and that is the honest
 * seam: what is under test here is the **translation** — an `AutoReplyResult`
 * into an outcome, an outcome into a match — not what the model says. The model
 * half is measured by running the thing, which is what the harness is for, and
 * exercised end to end against the E2E suite's fake provider in
 * `tests/e2e/evals.spec.ts`.
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
import type { KbArticle } from "../ai/knowledge-base";

/* ── The model, replaced by whatever this file wants it to say ───────────── */

type AutoReplyOutcome =
  | { ok: true; reply: string; articleIds: string[] }
  | { ok: false; reason: string; decline: AutoReplyDecline };

let nextResult: AutoReplyOutcome = {
  ok: false,
  reason: "declined",
  decline: AUTO_REPLY_DECLINE.notCovered,
};

/** What `autoReply` was handed, so the synthesized context can be asserted. */
let lastCall: { articles: KbArticle[]; context: unknown } | undefined;

const actual = await import("../ai/auto-reply");

mock.module("../ai/auto-reply", () => ({
  ...actual,
  autoReply: async (articles: KbArticle[], context: unknown) => {
    lastCall = { articles, context };
    return nextResult;
  },
}));

const { answerCase } = await import("./runner");

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
  nextResult = {
    ok: false,
    reason: "declined",
    decline: AUTO_REPLY_DECLINE.notCovered,
  };
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
});

/* ── What comes back ─────────────────────────────────────────────────────── */

describe("the verdict", () => {
  test("a reply is `resolved`, with no reason", async () => {
    nextResult = { ok: true, reply: "Here you go.", articleIds: ["KB-001"] };

    const result = await answerCase(CORPUS, autoReplyCaseById("off-corpus")!);

    expect(result.outcome).toBe(PIPELINE_OUTCOME.resolved);
    expect(result.decline).toBeNull();
  });

  test("a decline carries the reason the checks reached", async () => {
    nextResult = {
      ok: false,
      reason: "ungrounded",
      decline: AUTO_REPLY_DECLINE.unbackedCommitment,
    };

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
    nextResult = {
      ok: false,
      reason: "provider",
      decline: AUTO_REPLY_DECLINE.unavailable,
    };

    const result = await answerCase(CORPUS, autoReplyCaseById("off-corpus")!);

    expect(result.outcome).toBe(PIPELINE_OUTCOME.abandoned);
    expect(result.decline).toBe(AUTO_REPLY_DECLINE.unavailable);
  });
});

/* ── Whether it landed where the case said it would ──────────────────────── */

describe("matching", () => {
  test("a decline must reach the expected reason, not merely decline", async () => {
    // "Expected declined, got declined for a completely different reason" is
    // the finding this harness exists to surface: a payload that slipped past
    // the money check and was thrown out for having no citation is not the
    // safety story holding.
    nextResult = {
      ok: false,
      reason: "ungrounded",
      decline: AUTO_REPLY_DECLINE.noCitation,
    };

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
    nextResult = { ok: true, reply: "Here you go.", articleIds: ["KB-001"] };

    const result = await answerCase(
      CORPUS,
      autoReplyCaseById("password-reset")!,
    );

    expect(result.matched).toBe(true);
  });
});

/* ── R12: a run is invisible to everyone but an admin reading the results ── */

test("answering every case writes nothing a customer or agent would see", async () => {
  // Structural rather than a promise: `answerCase` reaches `autoReply`, which
  // takes its corpus as a value and touches no database at all, so there is no
  // ticket row to avoid creating. Asserted as row counts across a whole pass of
  // the case set, which is the shape the PRD asks for.
  for (const evalCase of AUTO_REPLY_CASES) {
    await answerCase(CORPUS, evalCase);
  }

  expect(await prisma.ticket.count()).toBe(0);
  expect(await prisma.message.count()).toBe(0);
  expect(await prisma.ticketActivity.count()).toBe(0);
  expect(await prisma.outboundEmail.count()).toBe(0);
});
