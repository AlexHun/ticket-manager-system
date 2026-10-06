import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  AUTO_REPLY_DECLINE,
  MESSAGE_DIRECTION,
  TICKET_CATEGORY,
  TICKET_STATUS,
} from "@ticket/shared";
import type { AutoReplyResult } from "../ai/auto-reply";
import type { Prisma } from "../db";
import { CUSTOMER, seedTicket } from "../test/fixtures";
import { prisma, resetDb } from "../test/pg";
import { sendEmailStub, stubSendEmail } from "../test/send-email";

/**
 * `AUTO_REPLY_WORKER.handle` against the resolve's version compare (#429,
 * `docs/adr/0020`).
 *
 * The resolve used to match on `status: Processing` alone, and appending a
 * message does not move a ticket's status. So a message that committed between
 * the in-transaction re-read and the resolve was resolved over. The tests here
 * commit one in exactly that gap.
 *
 * **How the gap is reached.** PGLite has one connection, and an interactive
 * transaction holds it exclusively, so a write from "another connection" would
 * simply queue behind the resolve. The interleaving is produced instead through
 * `./auto-reply-steps`: `readResolveState` is wrapped so that, after the real
 * read, it commits the change through the **same** `tx`. What the resolve's
 * `updateMany` sees is then exactly what it would see in production, where
 * Postgres re-checks an `UPDATE`'s `where` against a row a concurrent
 * transaction committed.
 *
 * Both stubs default to the real module and act only while a test has set
 * them, so a file that links the job before or after this one sees the genuine
 * answer (testing-api.md).
 */

type Tx = Prisma.TransactionClient;

const steps = {
  /** What the model answers. `null` asks the real one. */
  reply: null as AutoReplyResult | null,
  /** Run once, through the resolve's `tx`, right after the re-read. */
  afterRead: null as ((tx: Tx, ticketId: number) => Promise<void>) | null,
};

const actual = { ...(await import("./auto-reply-steps")) };
mock.module("./auto-reply-steps", () => ({
  ...actual,
  draftReply: async (...args: Parameters<typeof actual.draftReply>) =>
    steps.reply ?? actual.draftReply(...args),
  readResolveState: async (tx: Tx, ticketId: number) => {
    const state = await actual.readResolveState(tx, ticketId);
    const write = steps.afterRead;
    if (write) {
      // Once: the interleaving is one message, not one per read.
      steps.afterRead = null;
      await write(tx, ticketId);
    }
    return state;
  },
}));

// `sendReply` queues the outbound email; this keeps the row and drops the
// pg-boss nudge, which has no queue to reach here.
await stubSendEmail();

const { AUTO_REPLY_WORKER } = await import("./auto-reply-ticket");

/** Long before the test runs, so a message written now visibly moves it. */
const OPENED_AT = new Date(Date.now() - 60 * 60 * 1000);

const ANSWER: AutoReplyResult = {
  ok: true,
  reply: "Hello Marta,\n\nUse the reset link on the sign-in page.",
  articleIds: ["KB-001"],
};

async function claimableTicket(): Promise<number> {
  const ticket = await seedTicket({
    status: TICKET_STATUS.New,
    category: TICKET_CATEGORY.Technical,
    lastMessageAt: OPENED_AT,
    createdAt: OPENED_AT,
  });
  await prisma.message.create({
    data: {
      ticketId: ticket.id,
      messageId: "first@example.com",
      senderEmail: CUSTOMER.email,
      senderName: CUSTOMER.name,
      textBody: "How do I reset my password?",
      direction: MESSAGE_DIRECTION.inbound,
      createdAt: OPENED_AT,
    },
  });
  return ticket.id;
}

/** The customer writes again, the way `ingest.ts` threads a reply on. */
async function customerWritesAgain(tx: Tx, ticketId: number): Promise<void> {
  await tx.message.create({
    data: {
      ticketId,
      messageId: "second@example.com",
      senderEmail: CUSTOMER.email,
      senderName: CUSTOMER.name,
      textBody: "Actually, never mind — I want a refund.",
    },
  });
  await tx.ticket.update({
    where: { id: ticketId },
    data: { lastMessageAt: new Date() },
  });
}

/** An agent re-files the ticket while the model is thinking. */
async function agentFilesAsRefund(tx: Tx, ticketId: number): Promise<void> {
  await tx.ticket.update({
    where: { id: ticketId },
    data: { category: TICKET_CATEGORY.Refund },
  });
}

/** An agent re-files it as another category the machine may still answer. */
async function agentFilesAsGeneral(tx: Tx, ticketId: number): Promise<void> {
  await tx.ticket.update({
    where: { id: ticketId },
    data: { category: TICKET_CATEGORY.General },
  });
}

/** Something else released the claim — the recovery sweep, say. */
async function sweepReleasesClaim(tx: Tx, ticketId: number): Promise<void> {
  await tx.ticket.update({
    where: { id: ticketId },
    data: { status: TICKET_STATUS.New },
  });
}

function ticketRow(id: number) {
  return prisma.ticket.findUniqueOrThrow({
    where: { id },
    select: { status: true, autoResolvedAt: true, autoReplyDecline: true },
  });
}

function outboundCount(ticketId: number) {
  return prisma.message.count({
    where: { ticketId, direction: MESSAGE_DIRECTION.outbound },
  });
}

beforeEach(async () => {
  steps.reply = ANSWER;
  steps.afterRead = null;
  sendEmailStub.failAfterWriting = false;
  await resetDb();
});

// Back to the real module, so a job test that runs after this file in the same
// process is not handed this file's canned answer.
afterEach(() => {
  steps.reply = null;
  steps.afterRead = null;
});

describe("the resolve matches only the version the model answered", () => {
  test("nothing changed: the ticket is answered and resolved", async () => {
    const id = await claimableTicket();

    await AUTO_REPLY_WORKER.handle({ ticketId: id });

    const ticket = await ticketRow(id);
    expect(ticket.status).toBe(TICKET_STATUS.Resolved);
    expect(ticket.autoResolvedAt).not.toBeNull();
    expect(ticket.autoReplyDecline).toBeNull();
    expect(await outboundCount(id)).toBe(1);
  });

  test("a message committed after the re-read hands the ticket back as followUp", async () => {
    const id = await claimableTicket();
    steps.afterRead = customerWritesAgain;

    await AUTO_REPLY_WORKER.handle({ ticketId: id });

    const ticket = await ticketRow(id);
    expect(ticket.status).toBe(TICKET_STATUS.Open);
    expect(ticket.autoResolvedAt).toBeNull();
    expect(ticket.autoReplyDecline).toBe(AUTO_REPLY_DECLINE.followUp);
    expect(await outboundCount(id)).toBe(0);
    // The customer's message is kept: the reply is what was discarded.
    expect(await prisma.message.count({ where: { ticketId: id } })).toBe(2);
  });

  test("a re-file as Refund after the re-read hands the ticket back as category", async () => {
    const id = await claimableTicket();
    steps.afterRead = agentFilesAsRefund;

    await AUTO_REPLY_WORKER.handle({ ticketId: id });

    const ticket = await ticketRow(id);
    expect(ticket.status).toBe(TICKET_STATUS.Open);
    expect(ticket.autoResolvedAt).toBeNull();
    expect(ticket.autoReplyDecline).toBe(AUTO_REPLY_DECLINE.category);
    expect(await outboundCount(id)).toBe(0);
  });

  test("a version that moved with no gate firing hands the ticket back as followUp", async () => {
    // A re-file from one answerable category to another: the gates pass, but
    // the ticket is no longer the one the model answered.
    const id = await claimableTicket();
    steps.afterRead = agentFilesAsGeneral;

    await AUTO_REPLY_WORKER.handle({ ticketId: id });

    const ticket = await ticketRow(id);
    expect(ticket.status).toBe(TICKET_STATUS.Open);
    expect(ticket.autoReplyDecline).toBe(AUTO_REPLY_DECLINE.followUp);
    expect(await outboundCount(id)).toBe(0);
  });

  test("a status someone else moved is left as they left it", async () => {
    // The other reason the resolve can match nothing, and the one where
    // returning without releasing is still right: the ticket is not ours.
    const id = await claimableTicket();
    steps.afterRead = sweepReleasesClaim;

    await AUTO_REPLY_WORKER.handle({ ticketId: id });

    const ticket = await ticketRow(id);
    expect(ticket.status).toBe(TICKET_STATUS.New);
    expect(ticket.autoReplyDecline).toBeNull();
    expect(await outboundCount(id)).toBe(0);
  });
});
