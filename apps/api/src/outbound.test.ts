/**
 * Unit tests for `sendReply` in `./outbound` — specifically, what it writes to
 * `Message.polishedDraft`.
 *
 * Everything else `write()` does (threading, the outbox row, `lastMessageAt`)
 * is exercised end-to-end by the E2E suite; what is worth pinning down here is
 * the one thing no browser test can see into a database row to check: that an
 * agent reply carries the polished draft it was sent from, that a reply typed
 * by hand or undone back to it carries none, and that the assistant's replies
 * — which never touch Polish — cannot carry one at all, by construction.
 *
 * `./outbound` has not been imported by any other test file, so this is the
 * first (and only) place `./db` is mocked with a `ticket`/`message` shape.
 * `automation.test.ts` also mocks `./db`, but for `user`/`automationSettings`
 * only, and dynamically imports different modules — see the note there on why
 * that does not collide with this file.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";

interface CreateCall {
  data: Record<string, unknown>;
}

const FAKE_TICKET = {
  id: 1,
  subject: "Cannot log in",
  customerEmail: "customer@example.com",
  customerName: "Marta",
  messages: [] as { messageId: string }[],
};

/** Every `message.create` call this test made, newest last. */
let createCalls: CreateCall[];

const findUnique = mock(() => Promise.resolve(FAKE_TICKET));
const update = mock(() => Promise.resolve({ id: FAKE_TICKET.id }));
const create = mock((args: { data: Record<string, unknown> }) => {
  createCalls.push({ data: args.data });
  return Promise.resolve({
    id: createCalls.length,
    ticketId: FAKE_TICKET.id,
    messageId: args.data.messageId,
    inReplyTo: args.data.inReplyTo ?? null,
    senderEmail: args.data.senderEmail,
    senderName: args.data.senderName,
    textBody: args.data.textBody,
    direction: args.data.direction,
    automated: args.data.automated,
    citedArticleIds: args.data.citedArticleIds,
    createdAt: args.data.createdAt ?? new Date(),
  });
});

const client = {
  ticket: { findUnique, update },
  message: { create },
};

// `Prisma` is included even though nothing in this file calls `Prisma.sql` —
// the same reason `automation.test.ts` includes it beside its own
// `mock.module("./db", …)`. Every factory for this specifier has to carry it:
// `routes/activity.ts`, `ticket-stats.ts` and `ticket-effectiveness.ts` import
// it as a *value*, and a factory that leaves it out can be the one in force
// when one of those is linked, which fails the run with `SyntaxError: Export
// named 'Prisma' not found in module .../src/db.ts` — intermittently, since it
// depends on the order `bun test` reaches the files in.
const { Prisma } = await import("./generated/prisma/client");

mock.module("./db", () => ({
  Prisma,
  prisma: { $transaction: (cb: (c: typeof client) => unknown) => cb(client) },
}));

// `enqueueEmail` does I/O this file has no interest in — pg-boss, the outbox
// row — so it is stubbed rather than exercised.
mock.module("./jobs/send-email", () => ({
  enqueueEmail: mock(() => Promise.resolve({ id: 1 })),
}));

const { REPLY_ORIGIN, SEND_OUTCOME, sendReply } = await import("./outbound");

beforeEach(() => {
  createCalls = [];
  findUnique.mockClear();
  update.mockClear();
  create.mockClear();
});

describe("sendReply — Message.polishedDraft", () => {
  test("an agent reply sent from a polish carries the draft it was sent from", async () => {
    const result = await sendReply({
      ticketId: 1,
      textBody: "Hi Marta, your parcel shipped Friday.\n\nThanks,\nAaron",
      origin: {
        kind: REPLY_ORIGIN.agent,
        author: { id: "u1", name: "Aaron", email: "aaron@example.com" },
        polishedDraft: "Hi Marta, your parcel shipped Friday.\n\nThanks,\nAaron",
      },
    });

    expect(result.outcome).toBe(SEND_OUTCOME.sent);
    expect(createCalls[0].data.polishedDraft).toBe(
      "Hi Marta, your parcel shipped Friday.\n\nThanks,\nAaron",
    );
  });

  test("an agent reply typed by hand writes only the sent text", async () => {
    await sendReply({
      ticketId: 1,
      textBody: "shipped fri",
      origin: {
        kind: REPLY_ORIGIN.agent,
        author: { id: "u1", name: "Aaron", email: "aaron@example.com" },
      },
    });

    expect(createCalls[0].data.polishedDraft).toBeNull();
  });

  test("an assistant reply cannot carry a polished draft", async () => {
    await sendReply({
      ticketId: 1,
      textBody: "Here's what our knowledge base says.",
      origin: { kind: REPLY_ORIGIN.assistant, citedArticleIds: ["KB-004"] },
    });

    // Absent from the create call entirely — the assistant branch of
    // `ReplyOrigin` has no `polishedDraft` field to set, by type.
    expect(createCalls[0].data.polishedDraft).toBeUndefined();
  });
});
