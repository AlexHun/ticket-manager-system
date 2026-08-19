import { randomUUID } from "node:crypto";
import { MESSAGE_DIRECTION } from "@ticket/shared";
import { prisma, type Prisma } from "./db";

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
 * **Nothing is sent yet.** There is still no mail transport: this writes a row,
 * exactly as both callers did. That is the point of building it now — when a
 * transport lands there is one implementation to change, and every reply the
 * desk makes already passes through it.
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
  // `take: 1` on the reverse of the thread's own ordering *is* its last
  // message — the same tie-break, so the parent is the one the agent can see at
  // the bottom of the pane. A ticket with no messages yet threads nothing and
  // gets a null, which is what a first email looks like anyway.
  const ticket = await client.ticket.findUnique({
    where: { id: reply.ticketId },
    select: {
      id: true,
      messages: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { messageId: true },
      },
    },
  });
  if (!ticket) return { outcome: SEND_OUTCOME.noSuchTicket };

  const message = await client.message.create({
    data: {
      ticketId: ticket.id,
      messageId: newOutboundMessageId(ticket.id),
      inReplyTo: ticket.messages[0]?.messageId ?? null,
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
