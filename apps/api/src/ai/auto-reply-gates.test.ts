/**
 * Unit tests for `apps/api/src/ai/auto-reply-gates.ts`.
 *
 * These three conditions have decided whether the desk answers a customer since
 * the auto-reply shipped, and until now nothing tested them: they were a nested
 * ternary inside a job handler, downstream of a claim, a database read and a
 * model call. Extracting them into a predicate is what makes them a table of
 * rows, and the row that matters most is the first one — `Refund` is one of the
 * two independent controls that stop a machine writing to somebody about their
 * money.
 *
 * No mocks and no database: this module imports two constants and reads three
 * fields.
 */

import { describe, expect, test } from "bun:test";
import {
  AUTO_REPLY_DECLINE,
  TICKET_CATEGORY,
  type TicketCategory,
} from "@ticket/shared";
import { ANSWERABLE_CATEGORIES, gateDecline } from "./auto-reply-gates";

/** The ordinary state of a freshly classified ticket: one email, no reply yet. */
const OPENING = { hasOutbound: false, inboundCount: 1 } as const;

describe("the category gate", () => {
  test("refuses Refund", () => {
    // The second of two independent controls — every refund article is also
    // marked `Auto-reply: no`. They have to disagree before anything goes wrong.
    expect(gateDecline({ ...OPENING, category: TICKET_CATEGORY.Refund })).toBe(
      AUTO_REPLY_DECLINE.category,
    );
  });

  test("refuses a ticket the classifier never answered", () => {
    // Null means the classifier failed, not that it is still thinking: this
    // queue is only offered a ticket after classification. Answering from the
    // knowledge base without knowing what was asked is the thing never to do.
    expect(gateDecline({ ...OPENING, category: null })).toBe(
      AUTO_REPLY_DECLINE.category,
    );
  });

  test.each(ANSWERABLE_CATEGORIES.map((category) => [category] as const))(
    "lets %s through",
    (category) => {
      expect(gateDecline({ ...OPENING, category })).toBeNull();
    },
  );

  test("every category is either answerable or refused, with none left over", () => {
    // A fifth `TicketCategory` would otherwise arrive as silently answerable or
    // silently refused depending on which list somebody remembered to edit.
    for (const category of Object.values(TICKET_CATEGORY) as TicketCategory[]) {
      const answerable = ANSWERABLE_CATEGORIES.some((c) => c === category);
      expect(gateDecline({ ...OPENING, category })).toBe(
        answerable ? null : AUTO_REPLY_DECLINE.category,
      );
    }
  });
});

describe("the already-answered gate", () => {
  test("refuses a thread somebody has replied on", () => {
    // The corpus answers openings, not conversations.
    expect(
      gateDecline({
        category: TICKET_CATEGORY.Technical,
        hasOutbound: true,
        inboundCount: 1,
      }),
    ).toBe(AUTO_REPLY_DECLINE.answered);
  });
});

describe("the nothing-to-read gate", () => {
  test("refuses a ticket with no inbound message at all", () => {
    expect(
      gateDecline({
        category: TICKET_CATEGORY.Technical,
        hasOutbound: false,
        inboundCount: 0,
      }),
    ).toBe(AUTO_REPLY_DECLINE.noText);
  });

  test("an HTML-only email is not this gate's business", () => {
    // It still writes a message row — one whose `textBody` is null — so it goes
    // to the model and is declined on the merits. `noText` is a ticket with no
    // inbound message, which is a state ingestion cannot produce.
    expect(
      gateDecline({
        category: TICKET_CATEGORY.Technical,
        hasOutbound: false,
        inboundCount: 1,
      }),
    ).toBeNull();
  });
});

describe("order", () => {
  test("a ticket tripping every gate reports the money one", () => {
    // Same precedence the nested ternary had. It is the one that must never be
    // reported as something milder.
    expect(
      gateDecline({
        category: TICKET_CATEGORY.Refund,
        hasOutbound: true,
        inboundCount: 0,
      }),
    ).toBe(AUTO_REPLY_DECLINE.category);
  });

  test("a replied-to ticket with nothing to read reports `answered`", () => {
    expect(
      gateDecline({
        category: TICKET_CATEGORY.General,
        hasOutbound: true,
        inboundCount: 0,
      }),
    ).toBe(AUTO_REPLY_DECLINE.answered);
  });
});
