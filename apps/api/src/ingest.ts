import { fromPrisma } from "pg-boss";
import type { InboundEmail } from "@ticket/core";
import { TICKET_STATUS } from "@ticket/shared";
import { prisma } from "./db";
import { enqueueClassification } from "./jobs/classify-ticket";

/**
 * Turning an inbound email into a ticket, or into a message on one.
 *
 * **This is the only ingestion path, and two callers depend on that being true.**
 * `routes/webhooks/inbound-email.ts` is the front door a mail provider posts to;
 * `routes/pipeline.ts` is the simulator behind `/pipeline`, which exists so an
 * admin can watch a ticket descend the unattended path without owning the
 * webhook password. The simulator is only worth having because it is *not* a
 * second implementation — a page that demonstrates a parallel copy of this logic
 * demonstrates the copy, not the system. If a third caller ever appears, it
 * comes here too.
 *
 * What the callers keep for themselves is what is genuinely theirs: the webhook
 * has Basic Auth, a 45mb body limit sized for a provider that inlines
 * attachments, and the Postmark adapter; the simulator has `requireAdmin`, a
 * pinned sender domain and a rate cap. Everything below this line is what it
 * means to receive an email, and it is identical either way.
 *
 * The three outcomes are the three things that can be true of an arriving
 * message: we have seen it before, it belongs to a conversation already in
 * progress, or it opens a new one.
 */

export const INGEST_OUTCOME = {
  /** Seen before, by `messageId`. Nothing was written. */
  deduped: "deduped",
  /** Appended to an existing thread. */
  threaded: "threaded",
  /** Opened a new ticket, and asked for it to be classified. */
  created: "created",
} as const;

export type IngestOutcome = (typeof INGEST_OUTCOME)[keyof typeof INGEST_OUTCOME];

export interface IngestResult {
  outcome: IngestOutcome;
  ticketId: number;
  /**
   * The `Message-ID` the email was stored under, brackets already stripped.
   *
   * On a dedupe this is the id that was already there, which is the same string
   * — that is what made it a dedupe.
   */
  messageId: string;
}

export function stripAngles(value: string): string {
  return value.trim().replace(/^<|>$/g, "");
}

/**
 * Find the ticket an arriving message belongs to, if any.
 *
 * Exported because the simulator needs to answer the same question *before*
 * ingesting, in order to refuse an `inReplyTo` that points at a real customer's
 * thread. Asking it twice is two indexed lookups and no duplicated rules.
 */
export async function findParentTicketId(
  inReplyTo: string | undefined,
  references: string[] = [],
): Promise<number | null> {
  // Best parent first: the direct reply, then references newest-first.
  const parentCandidates = [inReplyTo, ...[...references].reverse()].filter(
    (v): v is string => Boolean(v),
  );

  // A first email carries neither header, and that is the common case — so it
  // skips the lookup entirely rather than asking the database to match nothing.
  if (parentCandidates.length === 0) return null;

  // One query for every candidate rather than one per candidate. A long thread
  // carries a dozen or more ids in `References`, and asked one at a time that
  // is a dozen sequential round trips on a webhook the provider is timing.
  //
  // The order above is the whole point of this block, and the database does not
  // preserve it — so the rows go into a map and the winner is chosen by walking
  // `parentCandidates`, never by taking the first row returned.
  const parents = await prisma.message.findMany({
    where: { messageId: { in: parentCandidates } },
    select: { messageId: true, ticketId: true },
  });
  const ticketByMessageId = new Map(
    parents.map((p) => [p.messageId, p.ticketId]),
  );

  for (const candidate of parentCandidates) {
    const found = ticketByMessageId.get(candidate);
    if (found !== undefined) return found;
  }

  return null;
}

/**
 * Receive one email.
 *
 * Idempotent on `messageId`, which is what makes a retried delivery harmless —
 * and a mail provider retries anything it considers slow, so this is not a
 * theoretical property.
 */
export async function ingestInboundEmail(
  email: InboundEmail,
): Promise<IngestResult> {
  const messageId = stripAngles(email.messageId);
  const inReplyTo = email.inReplyTo ? stripAngles(email.inReplyTo) : undefined;
  const refs = (email.references ?? [])
    .map(stripAngles)
    .filter((s) => s.length > 0);

  // Only the ticket id is read below. Without the select this loads `textBody`
  // and `htmlBody` — two full email bodies, the largest columns in the schema —
  // to answer a yes/no question.
  const existing = await prisma.message.findUnique({
    where: { messageId },
    select: { ticketId: true },
  });
  if (existing) {
    return {
      outcome: INGEST_OUTCOME.deduped,
      ticketId: existing.ticketId,
      messageId,
    };
  }

  const ticketId = await findParentTicketId(inReplyTo, refs);

  const messageData = {
    messageId,
    inReplyTo: inReplyTo ?? null,
    senderEmail: email.senderEmail,
    senderName: email.senderName,
    textBody: email.textBody ?? null,
    htmlBody: email.htmlBody ?? null,
  };

  if (ticketId !== null) {
    await prisma.$transaction([
      prisma.message.create({ data: { ...messageData, ticketId } }),
      prisma.ticket.update({
        where: { id: ticketId },
        data: { lastMessageAt: new Date() },
      }),
      // A customer writing back to a ticket the *machine* resolved reopens it.
      //
      // Without this the auto-reply has a hole rather than a feature: a
      // knowledge-base answer that missed the point leaves the customer replying
      // "that didn't help" into a ticket marked Resolved, which no agent
      // filtering for open work will ever see. A resolve that swallows the
      // follow-up is not a resolve.
      //
      // Narrowed to `autoResolvedAt` on purpose, and that is why the column
      // exists. A human who resolves a ticket has judged it finished and is
      // usually right; undoing that on every "thanks, that worked!" would reopen
      // half the queue. Nobody made that judgement here.
      //
      // `updateMany` because the `where` is doing the work — a plain `update`
      // addresses by id and would reopen tickets a person had settled.
      //
      // Note for anything reading the pipeline afterwards: this **clears**
      // `autoResolvedAt`, so a reopened ticket is indistinguishable from one the
      // machine never answered. `/pipeline` states that limitation rather than
      // guessing around it.
      prisma.ticket.updateMany({
        where: { id: ticketId, autoResolvedAt: { not: null } },
        data: { status: TICKET_STATUS.Open, autoResolvedAt: null },
      }),
    ]);
    return { outcome: INGEST_OUTCOME.threaded, ticketId, messageId };
  }

  const subject =
    email.subject.replace(/^(re|fwd?):\s*/gi, "").trim() || "(no subject)";

  // The ticket and the request to classify it commit together or not at all.
  //
  // What must never be awaited before answering the caller is the *model call* —
  // a mail provider times the webhook, a slow webhook is retried, and a retried
  // webhook is duplicate ingestion. Enqueuing is not that: it is one INSERT into
  // a table in the same database, inside the transaction that is already
  // happening. The classification itself still runs long after this returns, on
  // a worker.
  //
  // Doing it inside the transaction closes a real gap. Scheduling after the
  // response, as this did while the queue lived in memory, leaves a window
  // between the ticket committing and the work being recorded; a crash inside it
  // produced a ticket that nothing would ever classify and nothing would ever
  // report. Now the two facts share a fate.
  //
  // Only on creation. A reply arriving on an existing thread does not re-open the
  // question of what that ticket is about, and re-classifying on every inbound
  // message would spend a call per email to argue with whatever an agent had
  // already filed it under.
  const ticket = await prisma.$transaction(async (tx) => {
    const created = await tx.ticket.create({
      data: {
        subject,
        customerEmail: email.senderEmail,
        customerName: email.senderName,
        messages: { create: messageData },
      },
      select: { id: true },
    });

    await enqueueClassification(created.id, fromPrisma(tx));

    return created;
  });

  return { outcome: INGEST_OUTCOME.created, ticketId: ticket.id, messageId };
}
