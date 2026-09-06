/**
 * Unit tests for `sendReply` in `./outbound` — the only path a reply leaves the
 * desk by.
 *
 * **The database is real (`./test/pg`, ADR-0014), and that is what this file
 * is now about.** It used to be about one column: `./db` was a hand-written
 * `ticket`/`message` fake that recorded the arguments `message.create` was
 * called with, so the only assertable thing was what `polishedDraft` was set
 * to. Everything else `write()` does — threading a reply onto the end of a
 * thread, moving the ticket's last-message time, and the outbox row that
 * commits beside the message — was left to the E2E suite, because a fake
 * client cannot roll anything back and a `$transaction` that is a callback
 * invoked immediately never had a commit to fail.
 *
 * ## The one mock left, and why it is where it is
 *
 * `./jobs/send-email` is still replaced, because `enqueueEmail` does two things
 * and only one of them is a database write: it inserts the `OutboundEmail` row
 * *into the caller's transaction*, and then hands pg-boss a job. The second
 * needs a started queue and a wire-protocol connection, neither of which exists
 * in this process.
 *
 * So the stub keeps the insert and drops the nudge. That is what makes ADR-0009
 * assertable here at all: the row is written through the same
 * `Prisma.TransactionClient` `sendReply` is holding, so "the message is on the
 * thread and the email was queued" either both happened or neither did, and
 * Postgres is what decides which.
 *
 * **The seam is deliberately this module rather than `./jobs/boss`**, which
 * would have let the real `enqueueEmail` run end to end. `jobs/sweeps.test.ts`
 * already registers a `./boss` factory whose `getBoss` falls through to the
 * real one unless one of its own tests is watching a queue, and the
 * `mock.module` registry is one process wide: a second factory for that module
 * with different behaviour would mean whichever file loaded first decided what
 * the other one got — the exact hazard `docs/standards/testing.md` describes,
 * and the one that shows up as a file that passes alone and fails in the suite.
 *
 * The factory spreads the real module, so `requeueEmail`, `SEND_EMAIL_WORKER`
 * and `registerSendEmail` stay genuine for `routes/outbox.ts` and `boss.test.ts`
 * whichever order the suite reaches them in.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  MESSAGE_DIRECTION,
  OUTBOUND_EMAIL_KIND,
  OUTBOUND_EMAIL_STATUS,
} from "@ticket/shared";
import { COLLEAGUE, seedColleagues } from "./test/fixtures";
import { Prisma, prisma, resetDb } from "./test/pg";

/* ── The world behind the module ─────────────────────────────────────────── */

mock.module("./db", () => ({ Prisma, prisma }));

const sendEmail = { ...(await import("./jobs/send-email")) };
type EnqueueEmailInput = Parameters<typeof sendEmail.enqueueEmail>[0];

/**
 * Fail the enqueue *after* the outbox row has been written — the shape
 * `getBoss().send()` fails in, on a queue that is unreachable or was never
 * started.
 *
 * Thrown by this stub rather than reached for in the real `enqueueEmail`,
 * whose `getBoss()` would throw that error by itself. That would be the more
 * genuine article, and it is unavailable for the reason in the header: whether
 * the *real* `getBoss` is the one in force by the time this file loads depends
 * on whether `jobs/sweeps.test.ts` registered its `./boss` fake first, which
 * depends on the order `bun test` reaches the files in. A rollback test that
 * only fails on CI is worth less than a rollback test.
 */
let enqueueFailsAfterWriting = false;

mock.module("./jobs/send-email", () => ({
  ...sendEmail,
  enqueueEmail: async (
    input: EnqueueEmailInput,
    tx?: Prisma.TransactionClient,
  ) => {
    // The real module's insert, minus the `getBoss().send()` beneath it. The
    // client is the caller's transaction when there is one, which is the whole
    // property under test — see the header.
    const row = await (tx ?? prisma).outboundEmail.create({
      data: {
        kind: input.kind,
        messageId: input.messageId ?? null,
        toEmail: input.toEmail,
        toName: input.toName ?? null,
        subject: input.subject,
        textBody: input.textBody,
        emailMessageId: input.emailMessageId ?? null,
        inReplyTo: input.inReplyTo ?? null,
        references: input.references ?? [],
      },
      select: { id: true },
    });

    if (enqueueFailsAfterWriting) {
      throw new Error("send-email: the queue is unreachable");
    }
    return row;
  },
}));

const { REPLY_ORIGIN, SEND_OUTCOME, sendReply } = await import("./outbound");

/* ── Fixtures ────────────────────────────────────────────────────────────── */

const TICKET_ID = 1;

/** Before any reply in this file — so a `lastMessageAt` that did not move is
 *  visibly the one the ticket was created with. */
const OPENED_AT = new Date("2026-08-27T09:00:00.000Z");
const SENT_AT = new Date("2026-08-27T12:00:00.000Z");

const AGENT = {
  id: COLLEAGUE.agent.id,
  name: COLLEAGUE.agent.name,
  email: COLLEAGUE.agent.email,
};

function seedTicket(subject = "Cannot log in") {
  return prisma.ticket.create({
    data: {
      id: TICKET_ID,
      subject,
      customerEmail: "customer@example.com",
      customerName: "Marta",
      lastMessageAt: OPENED_AT,
      createdAt: OPENED_AT,
    },
  });
}

/** A message already on the thread, as `ingest.ts` would have stored it —
 *  `messageId` without angle brackets, which is the detail threading rests on. */
function seedInbound(messageId: string, createdAt: Date) {
  return prisma.message.create({
    data: {
      ticketId: TICKET_ID,
      messageId,
      senderEmail: "customer@example.com",
      senderName: "Marta",
      textBody: "I still cannot log in.",
      direction: MESSAGE_DIRECTION.inbound,
      createdAt,
    },
  });
}

/** An ordinary agent reply. The origin every test that is not about the
 *  assistant uses. */
function agentReply(over: { textBody?: string; polishedDraft?: string } = {}) {
  return {
    ticketId: TICKET_ID,
    textBody: over.textBody ?? "Hi Marta, your parcel shipped Friday.",
    sentAt: SENT_AT,
    origin: {
      kind: REPLY_ORIGIN.agent,
      author: AGENT,
      ...(over.polishedDraft === undefined
        ? {}
        : { polishedDraft: over.polishedDraft }),
    },
  } as const;
}

/** The reply row, read back from the table rather than from the return value. */
function messageRows() {
  return prisma.message.findMany({ orderBy: { id: "asc" } });
}

function outboxRows() {
  return prisma.outboundEmail.findMany({ orderBy: { id: "asc" } });
}

async function ticketRow() {
  return prisma.ticket.findUniqueOrThrow({ where: { id: TICKET_ID } });
}

beforeEach(async () => {
  enqueueFailsAfterWriting = false;
  await resetDb();
  await seedColleagues("agent");
  await seedTicket();
});

/* ── The two rows, and the one commit ────────────────────────────────────── */

describe("sendReply writes a message and an outbox row together", () => {
  test("both rows land, and the outbox row carries the message's own id", async () => {
    const result = await sendReply(agentReply());

    expect(result.outcome).toBe(SEND_OUTCOME.sent);
    const [message] = await messageRows();
    const [email] = await outboxRows();

    expect(message).toMatchObject({
      ticketId: TICKET_ID,
      direction: MESSAGE_DIRECTION.outbound,
      senderEmail: AGENT.email,
      senderName: AGENT.name,
      authorId: AGENT.id,
      automated: false,
      citedArticleIds: [],
      createdAt: SENT_AT,
    });

    expect(email).toMatchObject({
      kind: OUTBOUND_EMAIL_KIND.reply,
      // The two rows are joined, which is what puts a sent reply on the outbox
      // screen next to the thread it belongs to.
      messageId: message.id,
      toEmail: "customer@example.com",
      toName: "Marta",
      status: OUTBOUND_EMAIL_STATUS.queued,
      // The same id, not one of its own: the header the customer's client will
      // thread its answer on has to be the one `ingest.ts` can look up.
      emailMessageId: message.messageId,
    });
  });

  test("a reply that cannot be queued takes the message back with it", async () => {
    // The outbox row is written and the nudge then fails. By that point the
    // message and the ticket's new last-message time are already in the
    // transaction — a thread showing an answer the desk never queued is a
    // customer waiting on something nobody is going to send, and it is exactly
    // the state ADR-0009 exists to make impossible.
    enqueueFailsAfterWriting = true;

    await expect(sendReply(agentReply())).rejects.toThrow(
      "send-email: the queue is unreachable",
    );

    expect(await messageRows()).toHaveLength(0);
    expect(await outboxRows()).toHaveLength(0);
    expect((await ticketRow()).lastMessageAt).toEqual(OPENED_AT);
  });

  test("a caller's own transaction takes both rows with it when it rolls back", async () => {
    // `jobs/auto-reply-ticket.ts` calls `sendReply` inside a transaction whose
    // other half is the status transition proving it still holds its claim.
    // If that half fails, the customer must not be left holding a reply.
    await expect(
      prisma.$transaction(async (tx) => {
        await sendReply(agentReply(), tx);
        throw new Error("the claim was lost");
      }),
    ).rejects.toThrow("the claim was lost");

    expect(await messageRows()).toHaveLength(0);
    expect(await outboxRows()).toHaveLength(0);
    expect((await ticketRow()).lastMessageAt).toEqual(OPENED_AT);
  });

  test("no such ticket is an answer, not an error, and writes nothing", async () => {
    const result = await sendReply({ ...agentReply(), ticketId: 404 });

    // A missing ticket is a 404 the route has to give, so it is looked up
    // rather than left to a foreign key — which would surface as a 500.
    expect(result.outcome).toBe(SEND_OUTCOME.noSuchTicket);
    expect(await messageRows()).toHaveLength(0);
    expect(await outboxRows()).toHaveLength(0);
  });
});

/* ── Threading ───────────────────────────────────────────────────────────── */

describe("threading", () => {
  test("the reply hangs off whatever the thread ended with", async () => {
    await seedInbound("first@mail.example.com", new Date("2026-08-27T09:00:00.000Z"));
    await seedInbound("second@mail.example.com", new Date("2026-08-27T10:00:00.000Z"));

    await sendReply(agentReply());
    const [, , reply] = await messageRows();
    const [email] = await outboxRows();

    expect(reply.inReplyTo).toBe("second@mail.example.com");
    // `References` is the thread in its own order, which on a desk that never
    // branches is the same list the parent was taken from.
    expect(email.references).toEqual([
      "first@mail.example.com",
      "second@mail.example.com",
    ]);
    expect(email.inReplyTo).toBe("second@mail.example.com");
  });

  test("a first reply threads nothing and references nothing", async () => {
    await sendReply(agentReply());

    const [reply] = await messageRows();
    const [email] = await outboxRows();
    expect(reply.inReplyTo).toBeNull();
    expect(email.inReplyTo).toBeNull();
    expect(email.references).toEqual([]);
  });

  test("the minted Message-ID is stored without angle brackets", async () => {
    await sendReply(agentReply());

    const [reply] = await messageRows();
    // `ingest.ts` strips the brackets off an incoming `In-Reply-To` before
    // looking the parent up, so an id stored with them would never match and
    // the customer's answer would open a second ticket.
    expect(reply.messageId).not.toContain("<");
    expect(reply.messageId).not.toContain(">");
    expect(reply.messageId.startsWith(`${TICKET_ID}.`)).toBe(true);
  });

  test("two replies on one ticket get different ids", async () => {
    await sendReply(agentReply({ textBody: "First." }));
    await sendReply(agentReply({ textBody: "Second." }));

    // `Message.messageId` is UNIQUE, so a minting bug is a failed insert here
    // rather than two threads quietly merged in a mail client.
    const [first, second] = await messageRows();
    expect(first.messageId).not.toBe(second.messageId);
    expect(second.inReplyTo).toBe(first.messageId);
  });
});

/* ── The subject, and the ticket's clock ─────────────────────────────────── */

describe("the addressed email", () => {
  test("the subject is prefixed once", async () => {
    await sendReply(agentReply());

    expect((await outboxRows())[0].subject).toBe("Re: Cannot log in");
  });

  test("a subject that is already a reply is left alone", async () => {
    await resetDb();
    await seedColleagues("agent");
    await seedTicket("RE: Cannot log in");

    // Case-insensitive and only at the front — a thread that has been round a
    // few times reads `Re: Cannot log in`, not `Re: Re: Re: Cannot log in`.
    await sendReply(agentReply());
    expect((await outboxRows())[0].subject).toBe("RE: Cannot log in");
  });

  test("the ticket's last-message time is the reply's own instant", async () => {
    await sendReply(agentReply());

    // Written from one value rather than from a `now()` default a moment
    // later: the client moves "Last message" to the createdAt of the message
    // it gets back, and the two columns have to agree.
    const [reply] = await messageRows();
    expect((await ticketRow()).lastMessageAt).toEqual(SENT_AT);
    expect(reply.createdAt).toEqual(SENT_AT);
  });
});

/* ── Who is replying ─────────────────────────────────────────────────────── */

describe("the origin decides the byline and the flags", () => {
  test("an assistant reply says a machine wrote it and names no author", async () => {
    await sendReply({
      ticketId: TICKET_ID,
      textBody: "Here's what our knowledge base says.",
      sentAt: SENT_AT,
      origin: { kind: REPLY_ORIGIN.assistant, citedArticleIds: ["KB-004"] },
    });

    const [reply] = await messageRows();
    expect(reply).toMatchObject({
      // `outbound.ts`'s own constants. `example.com` is reserved by RFC 2606,
      // so a misconfigured test cannot reach a real address.
      senderEmail: "support@example.com",
      senderName: "Support (automated)",
      // No author, and the flag beside it is what stops that reading as "the
      // agent who wrote this has been deleted".
      authorId: null,
      automated: true,
      citedArticleIds: ["KB-004"],
      polishedDraft: null,
    });
  });

  test("an agent reply sent from a polish carries the draft it was sent from", async () => {
    const draft = "Hi Marta, your parcel shipped Friday.\n\nThanks,\nAaron";
    await sendReply(
      agentReply({ textBody: draft, polishedDraft: draft }),
    );

    expect((await messageRows())[0].polishedDraft).toBe(draft);
  });

  test("an agent reply typed by hand stores only the sent text", async () => {
    await sendReply(agentReply({ textBody: "shipped fri" }));

    const [reply] = await messageRows();
    expect(reply.textBody).toBe("shipped fri");
    expect(reply.polishedDraft).toBeNull();
  });

  test("an assistant reply cannot carry a polished draft at all", async () => {
    await sendReply({
      ticketId: TICKET_ID,
      textBody: "Here's what our knowledge base says.",
      sentAt: SENT_AT,
      origin: { kind: REPLY_ORIGIN.assistant, citedArticleIds: [] },
    });

    // Not "happens to be null": the assistant branch of `ReplyOrigin` has no
    // `polishedDraft` field to set, by type. This is the column reading back
    // as the schema default because nothing wrote it.
    expect((await messageRows())[0].polishedDraft).toBeNull();
  });
});
