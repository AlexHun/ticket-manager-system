/**
 * What the case set claims about itself, checked.
 *
 * `AUTO_REPLY_CASES` lives in `@ticket/core`, which has no test runner of its
 * own, and the claims worth checking are all about how the *harness* reads it —
 * whether a case's declared preflight agrees with the gate that will actually
 * be applied to it, and whether the set covers what PRD R2 says it covers. So
 * the file sits here, beside the runner that consults both.
 *
 * Nothing is mocked and nothing touches the database: this is a case set, a
 * pure predicate and a lookup table.
 */

import { describe, expect, test } from "bun:test";
import {
  AUTO_REPLY_DECLINE,
  isOutputCheckDecline,
  PIPELINE_OUTCOME,
  type AutoReplyDecline,
} from "@ticket/shared";
import {
  AUTO_REPLY_CASES,
  DECLINE_COVERAGE,
  SIMULATABLE_CASES,
  SMOKE_CASE_IDS,
  autoReplyCaseById,
} from "@ticket/core";
import { gateDecline } from "../ai/auto-reply-gates";
import { frozenCorpus } from "./frozen-corpus";

/* ── R2, as a measurement rather than a claim ────────────────────────────── */

describe("the set covers what the PRD asked for", () => {
  test("at least 30 cases", () => {
    expect(AUTO_REPLY_CASES.length).toBeGreaterThanOrEqual(30);
  });

  test("at least four adversarial payloads", () => {
    expect(
      AUTO_REPLY_CASES.filter((c) => c.adversarial).length,
    ).toBeGreaterThanOrEqual(4);
  });

  test("every decline reason is either covered or has a written reason it cannot be", () => {
    // R2 asks for a case per reason and six of the nine have one. The other
    // three are recorded as unreachable *in prose*, deliberately: a case
    // designed never to match is the "cries wolf, then gets ignored" failure the
    // PRD names as the thing this harness exists to prevent. What this test
    // stops is the third state — a reason with neither a case nor an argument.
    for (const [reason, entry] of Object.entries(DECLINE_COVERAGE)) {
      const covered = entry.caseIds.length > 0;
      const explained = (entry.unreachable ?? "").length > 0;
      expect(
        covered || explained,
        `${reason} has neither a case nor a reason it cannot have one`,
      ).toBe(true);
    }
  });

  test("a reason the table says is covered really is, by a case that expects it", () => {
    // Otherwise the table is a comment. It is the thing R2 is read off, so it
    // has to agree with the cases rather than describe them from memory.
    for (const [reason, entry] of Object.entries(DECLINE_COVERAGE)) {
      for (const caseId of entry.caseIds) {
        const evalCase = autoReplyCaseById(caseId);
        expect(evalCase, `${caseId} names no case`).not.toBeNull();
        expect(evalCase!.expected.decline, `${caseId} under ${reason}`).toBe(
          reason as AutoReplyDecline,
        );
      }
    }
  });

  test("no case expects a reason the table calls unreachable", () => {
    const unreachable = Object.entries(DECLINE_COVERAGE)
      .filter(([, entry]) => entry.caseIds.length === 0)
      .map(([reason]) => reason);

    for (const evalCase of AUTO_REPLY_CASES) {
      expect(
        unreachable,
        `${evalCase.id} expects ${evalCase.expected.decline}`,
      ).not.toContain(evalCase.expected.decline);
    }
  });
});

/* ── A case's declared preflight has to agree with the gate ──────────────── */

describe("preflight and the gates agree", () => {
  test("a case whose preflight trips a gate expects that gate's reason", () => {
    // The failure this stops is silent and permanent: a case declaring
    // `category: Refund` while expecting a reply would never reach the model,
    // never match, and drag the decline-accuracy baseline down forever with
    // nothing on screen saying why.
    for (const evalCase of AUTO_REPLY_CASES) {
      const gated = gateDecline({
        category: evalCase.preflight.category,
        hasOutbound: evalCase.preflight.answered,
        inboundCount: evalCase.preflight.hasInbound ? 1 : 0,
      });
      if (gated === null) continue;

      expect(evalCase.expected.outcome, evalCase.id).toBe(
        PIPELINE_OUTCOME.declined,
      );
      expect(evalCase.expected.decline, evalCase.id).toBe(gated);
    }
  });

  test("a case expecting a gate reason really is gated", () => {
    // The other direction. A case expecting `answered` whose preflight says
    // nobody has replied would cost five model calls to reach a conclusion it
    // could never reach.
    const gateReasons: AutoReplyDecline[] = [
      AUTO_REPLY_DECLINE.category,
      AUTO_REPLY_DECLINE.answered,
      AUTO_REPLY_DECLINE.noText,
    ];

    for (const evalCase of AUTO_REPLY_CASES) {
      if (!gateReasons.includes(evalCase.expected.decline!)) continue;

      expect(
        gateDecline({
          category: evalCase.preflight.category,
          hasOutbound: evalCase.preflight.answered,
          inboundCount: evalCase.preflight.hasInbound ? 1 : 0,
        }),
        evalCase.id,
      ).toBe(evalCase.expected.decline);
    }
  });
});

/* ── R9: the strings the catch rate is measured with ─────────────────────── */

describe("the payload markers", () => {
  test("appear nowhere in the frozen corpus", () => {
    // The mirror image of the failure they exist to catch, and the one that
    // would be invisible: a marker the knowledge base itself uses would report
    // every clean reply as an escape, and the safety metric would read as a
    // catastrophe on a system that is working.
    //
    // **Only the frozen corpus, and deliberately so.** The live corpus is a
    // table an admin edits at `/knowledge`, so no static test can hold it —
    // `payloadIn` in the runner covers that end at run time by ignoring a
    // marker the articles themselves supply, which is the rule checks 5 and 6
    // already keep. This is the static half, on the corpus the nightly answers
    // and the series a threshold is actually read against.
    const corpus = frozenCorpus()
      .map((article) => `${article.title}\n${article.body}`)
      .join("\n")
      .toLowerCase();

    for (const evalCase of AUTO_REPLY_CASES) {
      for (const marker of evalCase.payloadMarkers) {
        expect(
          corpus.includes(marker.toLowerCase()),
          `${evalCase.id}: the corpus already contains "${marker}"`,
        ).toBe(false);
      }
    }
  });

  test("are text the payload actually plants", () => {
    // A marker is a promise about one specific email. If it is not in that
    // email, it can never appear in a reply either, and the case reports a
    // catch rate over a payload it cannot detect — which reads as "nothing ever
    // escaped" rather than as "nothing was ever checked".
    for (const evalCase of AUTO_REPLY_CASES.filter((c) => c.adversarial)) {
      const email = `${evalCase.values.subject}\n${evalCase.values.textBody}\n${evalCase.values.senderName}`;
      for (const marker of evalCase.payloadMarkers) {
        expect(
          email.toLowerCase().includes(marker.toLowerCase()),
          `${evalCase.id}: "${marker}" is not in the email`,
        ).toBe(true);
      }
    }
  });

  test("belong to the payloads and to nothing else", () => {
    // The schema refines this at module load, so the set cannot be parsed
    // otherwise. Asserted here as well because it is the pairing the whole
    // metric rests on, and a refinement is one edit away from being relaxed by
    // somebody who reads it as a formality.
    for (const evalCase of AUTO_REPLY_CASES) {
      expect(
        evalCase.payloadMarkers.length > 0,
        `${evalCase.id} disagrees with itself about being a payload`,
      ).toBe(evalCase.adversarial);
      // Both halves of the rate, or neither. A payload with markers and no
      // declared check reports escapes it can see against catches it cannot.
      expect(
        evalCase.payloadChecks.length > 0,
        `${evalCase.id} has no check its payload is aimed at`,
      ).toBe(evalCase.adversarial);
    }
  });

  test("name a check the case's own expectation agrees with", () => {
    // The drift this stops: a payload expecting `unbackedCommitment` while
    // declaring only `unbackedReference` would score every single one of its
    // own expected declines as *not* caught — the safety numerator silently
    // reading zero on the case that matters most, while decline accuracy said
    // 5/5 and nothing on the screen looked wrong.
    for (const evalCase of AUTO_REPLY_CASES) {
      const expected = evalCase.expected.decline;
      if (expected === null || !isOutputCheckDecline(expected)) continue;

      expect(evalCase.payloadChecks, evalCase.id).toContain(expected);
    }
  });
});

/* ── The two readers, and what each of them can reach ────────────────────── */

describe("what the simulator is offered", () => {
  test("excludes exactly the cases ingestion cannot reproduce", () => {
    // A ticket is created *by* an inbound email, so a thread already replied to
    // and a ticket with no inbound message are states `/pipeline` cannot post
    // its way into. Offering them would be offering a scenario that lands
    // somewhere other than where the case says — which is the one thing sharing
    // a case set between two readers is supposed to make impossible.
    const excluded = AUTO_REPLY_CASES.filter(
      (c) => !SIMULATABLE_CASES.includes(c),
    ).map((c) => c.id);

    expect(excluded.sort()).toEqual(["already-answered", "no-inbound-message"]);
  });
});

describe("the smoke subset", () => {
  test("is small, and covers a gated case and one that reaches the model", () => {
    // The E2E drives a real run against a fake provider; a spec that answered
    // the whole set would take minutes on every push, which is R11's mistake
    // with the money taken out. Both halves still have to be exercised.
    const cases = SMOKE_CASE_IDS.map((id) => autoReplyCaseById(id)!);

    expect(cases.length).toBeLessThanOrEqual(4);
    expect(
      cases.some(
        (c) =>
          gateDecline({
            category: c.preflight.category,
            hasOutbound: c.preflight.answered,
            inboundCount: c.preflight.hasInbound ? 1 : 0,
          }) !== null,
      ),
    ).toBe(true);
    expect(
      cases.some(
        (c) =>
          gateDecline({
            category: c.preflight.category,
            hasOutbound: c.preflight.answered,
            inboundCount: c.preflight.hasInbound ? 1 : 0,
          }) === null,
      ),
    ).toBe(true);
  });
});
