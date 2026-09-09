/**
 * Unit tests for `apps/api/src/evals/classify-case.ts`.
 *
 * The two decisions in that module that are worth pinning: **which cases the
 * classifier can honestly be measured against**, and **what a classify result
 * becomes** on the way to a verdict.
 *
 * Nothing here mocks `../ai/classify`, deliberately. Both exports under test
 * are pure — one reads three declared fields, the other reads a result — so a
 * stub would only be asserting against itself, and registering one on that
 * specifier would put a second, differently-behaved factory on a module
 * `jobs/activity-before-publish.test.ts` already owns (`testing.md`'s registry
 * hazard). The thin call between them is exercised for real against the fake
 * provider in `tests/e2e/evals.spec.ts`.
 */

import { describe, expect, test } from "bun:test";
import { AI_FAILURE } from "../ai/provider";
import { TICKET_CATEGORY } from "@ticket/shared";
import { autoReplyCaseById } from "@ticket/core";
import { categoryOf, isClassifiable } from "./classify-case";

describe("which cases the classifier is measured against", () => {
  test("an ordinary opening is", () => {
    expect(isClassifiable(autoReplyCaseById("off-corpus")!)).toBe(true);
  });

  test("so is one the gates decline — the classifier ran before the gate did", () => {
    // The sharpest place to measure it, not one to skip: the category gate is
    // the only thing standing between a refund request and an unattended
    // reply, and it reads the classifier's answer. A harness that measured the
    // classifier only where its answer did not matter would be measuring the
    // easy half.
    expect(isClassifiable(autoReplyCaseById("refund")!)).toBe(true);
  });

  test("a case whose expectation is that classification failed is not", () => {
    // `unclassified` declares `category: null` — the expectation is that the
    // classifier produced nothing. There is no right answer to score against.
    expect(isClassifiable(autoReplyCaseById("unclassified")!)).toBe(false);
  });

  test("nor is one with no inbound message to read", () => {
    expect(isClassifiable(autoReplyCaseById("no-inbound-message")!)).toBe(
      false,
    );
  });
});

describe("what a classify result becomes", () => {
  test("an answer is the category it named", () => {
    expect(categoryOf({ ok: true, category: TICKET_CATEGORY.Refund })).toBe(
      TICKET_CATEGORY.Refund,
    );
  });

  test("a failure is null, not a category", () => {
    // Null is the denominator shrinking, never a miss. An outage is not the
    // classifier getting things wrong, and a metric that could not tell them
    // apart is the "cries wolf" failure the PRD opens with.
    expect(categoryOf({ ok: false, reason: AI_FAILURE.provider })).toBeNull();
  });
});
