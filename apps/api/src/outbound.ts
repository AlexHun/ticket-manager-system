import { randomUUID } from "node:crypto";
import { MESSAGE_DIRECTION, OUTBOUND_EMAIL_KIND } from "@ticket/shared";
import { prisma, type Prisma } from "./db";
import { enqueueEmail } from "./jobs/send-email";

/**
 * Sending a reply from the desk.
 *
 * **This is the only outbound path, and two callers depend on that being true.**
 * `routes/tickets.ts` is an agent pressing Send; `jobs/auto-reply-ticket.ts` is
 * the assistant answering from knowledge articles with nobody reading it first.
 * Until this module existed both of them assembled a message by hand — minting
 * an id, finding the parent to thread onto, setting the direction, moving the
 * ticket's last-message time — and nothing made the two agree. The counterpart
 * is `ingest.ts`, which owns the other edge of the desk for the same reason.
 *
 * **A reply is two rows now, written together.** The `Message` is the thread as
 * the app sees it; the `OutboundEmail` beside it is the same reply as the
 * customer will get it, and `enqueueEmail` writes it into whatever transaction
 * this call is already in. They commit together or not at all, which is the
 * only arrangement where "it is on the thread" and "we tried to send it" cannot
 * disagree — see `docs/adr/0009-outbound-email-goes-through-a-transactional-outbox.md`.
 *
 * **Nothing is delivered yet**, and that is now a fact about the *transport*
 * rather than about this module. With no provider bound the worker marks the
 * row `undeliverable` and it shows up on `/outbox`; when Postmark is bound,
 * `mail/transport.ts` changes and nothing here does.
 *
 * What the callers keep is what is genuinely theirs. The route has the session,
 * the 404 and the response shape. The job has the claim on the ticket, the
 * status transition, the assignment, the audit entry and the events — and, in
 * `ai/auto-reply.ts`, the six checks that make writing to a customer unattended
 * defensible. **Those checks are not here and must never move here.** They are
 * about whether a reply may be composed at all; this module is about a reply
 * that has already been decided on. See
 * `docs/adr/0004-auto-reply-safety-rests-on-output-checks.md` — a path that
 * reaches this module without them is the failure that ADR exists to prevent.
 */

/**
 * The right-hand side of every Message-ID this system mints.
 *
 * RFC 5322 wants a domain the sender actually owns, so that two systems can
 * never generate the same id. Nothing is being *sent* yet, so a placeholder is
 * the honest value, and this is one of the handful of lines to change when a
 * transport lands. Deliberately not an env var: there is no provider to
 * configure it for, and a required env var that nothing reads is a deployment
 * trap.
 */
const MESSAGE_ID_DOMAIN = "tickets.example.com";

/**
 * Who a machine-written reply comes from.
 *
 * Constants for the same reason as the domain above. `example.com` is reserved
 * by RFC 2606, so a misconfigured test cannot reach a real address.
 *
 * The name says "automated" because it is rendered: it sits above the bubble in
 * the thread, beside the badge that `Message.automated` drives. A support desk
 * that hides which replies it wrote by machine is one bad reply away from
 * needing to explain why.
 */
const SUPPORT_EMAIL = "support@example.com";
const SUPPORT_NAME = "Support (automated)";

/**
 * A Message-ID for an outbound reply, stored the way the inbound webhook stores
 * one: **without** angle brackets.
 *
 * That is the load-bearing detail, not a formatting preference. When the
 * customer answers, their mail client sends `In-Reply-To: <this-id>`, and
 * `stripAngles` in `ingest.ts` takes the brackets off before looking the parent
 * up. An id stored *with* them would never match that lookup, and the
 * customer's reply would open a second ticket instead of threading onto this
 * one.
 *
 * A v4 UUID is where the uniqueness comes from; the ticket id in front is only
 * so a header in a mail log can be traced back to a thread by eye. `messageId`
 * is UNIQUE in the schema, so a collision is a failed insert rather than two
 * threads quietly merged.
 */
function newOutboundMessageId(ticketId: number): string {
  return `${ticketId}.${randomUUID()}@${MESSAGE_ID_DOMAIN}`;
}

/**
 * What a mail client puts in front of a subject when you answer.
 *
 * Only once: a thread that has been round a few times should read `Re: Cannot
 * log in`, not `Re: Re: Re: Cannot log in`. Checked case-insensitively because
 * the prefix arrives however the customer's client wrote it, and only at the
 * front, so a subject that merely mentions "re:" somewhere is left alone.
 *
 * Deliberately not localised. Mail clients thread on `In-Reply-To` and
 * `References`, which are set beside this — the subject is for a person to read.
 */
function replySubject(subject: string): string {
  const trimmed = subject.trim();
  return /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

/**
 * The columns a `ThreadMessage` is made of.
 *
 * htmlBody is deliberately absent: it is attacker-supplied inbound email, and
 * anything that reaches the client is one innerHTML away from running as the
 * signed-in agent. The plain-text part is what the UI renders. authorId is
 * absent too — nothing in the thread shows it, and `senderName`/`senderEmail`
 * already say who wrote a reply. `automated` is here for the opposite reason:
 * the thread marks those, because "nobody wrote this" is exactly what an agent
 * reading a reply needs told rather than left to infer.
 *
 * It lives beside the writer and is read by `routes/tickets.ts` for the thread
 * on `GET /:id`, so the message this module hands back and the messages that
 * route lists cannot come to disagree about the shape of the same thing.
 */
export const MESSAGE_SELECT = {
  id: true,
  ticketId: true,
  messageId: true,
  inReplyTo: true,
  senderEmail: true,
  senderName: true,
  textBody: true,
  direction: true,
  automated: true,
  // Which knowledge-base articles an automated reply cited. Ids from our own
  // corpus, never model output — see the note on `Message.citedArticleIds`.
  citedArticleIds: true,
  createdAt: true,
} as const;

/** A stored message in the shape a `ThreadMessage` is built from. */
export type OutboundMessage = Prisma.MessageGetPayload<{
  select: typeof MESSAGE_SELECT;
}>;

export const REPLY_ORIGIN = {
  /** A signed-in person pressed Send. */
  agent: "agent",
  /** The assistant answered from knowledge articles. Nobody wrote it. */
  assistant: "assistant",
} as const;

/**
 * Who is replying — and therefore everything that follows from that.
 *
 * A union rather than a row of optional fields, because the two kinds differ in
 * four columns at once and every combination but these two is wrong. An agent
 * reply cannot carry citations and a machine reply cannot name an author: not
 * by convention, but because neither shape admits it. Getting that wrong would
 * put a colleague's name above a paragraph no colleague wrote.
 */
export type ReplyOrigin =
  | {
      kind: typeof REPLY_ORIGIN.agent;
      author: { id: string; name: string; email: string };
      /**
       * The polished draft this reply was sent from, when there was one —
       * see `Message.polishedDraft`. Never set by the assistant branch:
       * nothing there was ever handed to Polish.
       */
      polishedDraft?: string | null;
    }
  | {
      kind: typeof REPLY_ORIGIN.assistant;
      /**
       * The articles the reply was built from. Every one resolved against the
       * corpus the model was actually handed — `ai/auto-reply.ts` discards the
       * reply otherwise — so the thread can show what the answer was built from
       * rather than asking anyone to trust it.
       */
      citedArticleIds: string[];
    };

export const SEND_OUTCOME = {
  /** Written, and threaded onto whatever the thread ended with. */
  sent: "sent",
  /** No such ticket. Nothing was written. */
  noSuchTicket: "noSuchTicket",
} as const;

export type SendOutcome = (typeof SEND_OUTCOME)[keyof typeof SEND_OUTCOME];

export type SendReplyResult =
  | { outcome: typeof SEND_OUTCOME.sent; message: OutboundMessage }
  | { outcome: typeof SEND_OUTCOME.noSuchTicket };

export interface Reply {
  ticketId: number;
  textBody: string;
  origin: ReplyOrigin;
  /**
   * The instant the reply was sent, for callers that write something else from
   * the same one — the auto-reply stamps `autoResolvedAt` with it, and a
   * resolved-at a moment away from its own reply's timestamp is a thread that
   * reads out of order. Defaults to now.
   */
  sentAt?: Date;
}

/** The sender identity, the author and the flags, all decided by the origin. */
function senderOf(origin: ReplyOrigin) {
  if (origin.kind === REPLY_ORIGIN.agent) {
    return {
      // From the session, never from a request body: the sender is whoever is
      // signed in. Denormalised beside `authorId` on purpose — deleting the
      // agent nulls the FK, and the thread still has to say who wrote this.
      senderEmail: origin.author.email,
      senderName: origin.author.name,
      authorId: origin.author.id,
      automated: false,
      citedArticleIds: [],
      polishedDraft: origin.polishedDraft ?? null,
    };
  }

  return {
    senderEmail: SUPPORT_EMAIL,
    senderName: SUPPORT_NAME,
    // No author: nobody wrote this. The flag beside it is what stops that being
    // read as "the agent who wrote it has been deleted".
    authorId: null,
    automated: true,
    citedArticleIds: origin.citedArticleIds,
  };
}

async function write(
  client: Prisma.TransactionClient,
  reply: Reply,
  sentAt: Date,
): Promise<SendReplyResult> {
  // The existence check and the parent lookup are one query. The check is a
  // query rather than a catch around a foreign-key violation because a missing
  // ticket is an answer the caller has to give — a 404 on the route — and
  // letting the insert throw would route it through the error pipeline as a
  // 500.
  //
  // The whole thread in its own order, rather than just the last message.
  //
  // The last of them is the parent — the same tie-break as before, so it is
  // still the message an agent can see at the bottom of the pane — and the list
  // in front of it is the `References` header. That equivalence holds because
  // this desk threads linearly: every reply hangs off whatever the thread ended
  // with, so the ancestors of the new message are the thread. It would stop
  // being true the day a ticket could branch, and `References` would then have
  // to be walked rather than read off in order.
  //
  // A ticket with no messages yet threads nothing and references nothing, which
  // is what a first email looks like anyway.
  const ticket = await client.ticket.findUnique({
    where: { id: reply.ticketId },
    select: {
      id: true,
      subject: true,
      customerEmail: true,
      customerName: true,
      messages: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { messageId: true },
      },
    },
  });
  if (!ticket) return { outcome: SEND_OUTCOME.noSuchTicket };

  const references = ticket.messages.map((m) => m.messageId);
  const parentMessageId = references.at(-1) ?? null;

  const message = await client.message.create({
    data: {
      ticketId: ticket.id,
      messageId: newOutboundMessageId(ticket.id),
      inReplyTo: parentMessageId,
      textBody: reply.textBody,
      // The column defaults to `inbound`, so this is not optional.
      direction: MESSAGE_DIRECTION.outbound,
      createdAt: sentAt,
      ...senderOf(reply.origin),
    },
    select: MESSAGE_SELECT,
  });

  // Written from the same instant as the message rather than from a `now()`
  // default a moment later. The client moves the ticket's "Last message" to the
  // createdAt of the message it gets back, and that is only true if the two
  // columns were written from one value.
  await client.ticket.update({
    where: { id: ticket.id },
    data: { lastMessageAt: sentAt },
    // Nothing reads the ticket back; without this Prisma returns every column
    // of a row no caller wants.
    select: { id: true },
  });

  // The same reply, addressed. In this transaction on purpose: a thread showing
  // an answer the desk never queued is a customer waiting on something nobody
  // is going to send, and it would be invisible — the agent saw their message
  // appear.
  //
  // `emailMessageId` carries the id minted above rather than one of its own, so
  // the header the customer's client threads on is the id `ingest.ts` will look
  // up when they answer. Two ids here would silently open a new ticket per
  // reply, and it is the sort of thing nobody notices until a thread splits.
  await enqueueEmail(
    {
      kind: OUTBOUND_EMAIL_KIND.reply,
      messageId: message.id,
      toEmail: ticket.customerEmail,
      toName: ticket.customerName,
      subject: replySubject(ticket.subject),
      textBody: reply.textBody,
      emailMessageId: message.messageId,
      inReplyTo: parentMessageId,
      references,
    },
    client,
  );

  return { outcome: SEND_OUTCOME.sent, message };
}

/**
 * Send one reply on a ticket.
 *
 * Pass `tx` to join a transaction the caller already opened. The auto-reply
 * does: its write has to be conditional on the status transition that proves it
 * still holds the claim, so the message and that transition commit together or
 * not at all. Callers with nothing else to commit pass nothing and get a
 * transaction of this module's own — the message and the ticket's last-message
 * time are two writes either way, and a reply visible on a thread whose ticket
 * still sorts as untouched is not a state worth allowing.
 */
export async function sendReply(
  reply: Reply,
  tx?: Prisma.TransactionClient,
): Promise<SendReplyResult> {
  const sentAt = reply.sentAt ?? new Date();

  if (tx) return write(tx, reply, sentAt);
  return prisma.$transaction((client) => write(client, reply, sentAt));
}
