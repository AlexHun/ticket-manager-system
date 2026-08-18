import { fromPrisma } from "pg-boss";
import type { InboundEmail } from "@ticket/core";
import {
  TICKET_ACTIVITY_ACTION,
  TICKET_EVENT_FIELD,
  TICKET_STATUS,
  type TicketEventField,
} from "@ticket/shared";
import { assistantUser, resolveHandoff } from "./automation";
import { prisma } from "./db";
import {
  publishPipelineChanged,
  publishTicketCreated,
  publishTicketMessage,
  publishTicketUpdated,
} from "./events/ticket-events";
import { enqueueClassification } from "./jobs/classify-ticket";
import { customerActor, recordActivity, writeActivity } from "./ticket-activity";

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
    const [, , reopened] = await prisma.$transaction([
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

    // A reopened ticket is assigned to the assistant, and the assistant is not
    // coming back for it.
    //
    // The auto-reply files a ticket it resolved under its own account, which is
    // an accurate record right up to the moment the customer says "that didn't
    // help". From then on it is an open ticket owned by something that cannot
    // read it — worse than an unowned one, because every "unassigned" view an
    // agent works from now skips it. So the reopen hands it to whoever the
    // handoff setting names, which is the same route every other ticket the
    // machine could not finish takes.
    //
    // Conditional on the update above having fired, so the two lookups are paid
    // for by a reopen and not by every reply on every thread — which is the
    // common case by a wide margin. Narrowed to the assistant's own account as
    // well: a ticket a *person* resolved and a customer reopened stays theirs.
    // Guarded on `count`, like the reassignment below it and for the same
    // reason: `updateMany`'s whole job here is to match nothing on a ticket a
    // person resolved, and an entry written regardless would report a reopen
    // that did not happen on exactly those tickets.
    //
    // Recorded after the transaction rather than inside it, and swallowed on
    // failure. A mail provider times this webhook and retries a slow one, and a
    // retried webhook is duplicate ingestion — so nothing about writing the
    // audit line may be allowed to fail the request that received the email.
    // Accumulated rather than published as we go, so a reopen that also
    // reassigns is one event and not two. Both are the same commit as far as
    // anyone watching is concerned, and two events would mean two refetches of
    // the same thread to show one arrival.
    const changed: TicketEventField[] = [];

    if (reopened.count > 0) {
      const actor = customerActor(email.senderName);

      await recordActivity(
        ticketId,
        { action: TICKET_ACTIVITY_ACTION.reopened, toValue: TICKET_STATUS.Open },
        actor,
      );
      changed.push(TICKET_EVENT_FIELD.status);

      const assistant = await assistantUser();
      if (assistant) {
        const handoffId = await resolveHandoff();
        const reassigned = await prisma.ticket.updateMany({
          where: { id: ticketId, assignedToId: assistant.id },
          data: { assignedToId: handoffId },
        });

        // Again on `count`: the ticket may have been resolved by the machine and
        // then picked up by a person, in which case it is theirs and nothing
        // moved.
        if (reassigned.count > 0) {
          const handoff = handoffId
            ? await prisma.user.findUnique({
                where: { id: handoffId },
                select: { name: true },
              })
            : null;

          await recordActivity(
            ticketId,
            {
              action: TICKET_ACTIVITY_ACTION.assignee_changed,
              fromValue: assistant.name,
              toValue: handoff?.name ?? null,
            },
            actor,
          );
          changed.push(TICKET_EVENT_FIELD.assignee);
        }
      }
    }

    // After every write above has committed, and after the audit lines, so a
    // subscriber that re-reads on this sees the thread and its trail agreeing.
    //
    // The message event fires on every reply; the update only when something
    // actually moved, which on the common path — a customer replying to a
    // ticket a person is already working — is nothing.
    publishTicketMessage(ticketId);
    publishTicketUpdated(ticketId, changed);

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

    // Inside the transaction, unlike the reopen entries above — the same
    // argument this function already makes for enqueuing here. It is one INSERT
    // into a table in the same database, in a transaction that is happening
    // anyway, and the first line of a ticket's history sharing a fate with the
    // ticket is the point: an audit trail whose opening entry can go missing is
    // one you cannot tell "no history" apart from "history lost" in.
    await writeActivity(
      tx,
      created.id,
      {
        action: TICKET_ACTIVITY_ACTION.created,
        toValue: TICKET_STATUS.New,
      },
      customerActor(email.senderName),
    );

    await enqueueClassification(created.id, fromPrisma(tx));

    return created;
  });

  // Outside the transaction, unlike the two writes above, and that is the rule
  // rather than an oversight: an event says "re-read this", and a subscriber
  // that acted on one published mid-transaction could read the row before it
  // commits, cache what it saw, and never be told again — the event it needed
  // has already been spent. Publishing after the commit is the only ordering
  // that cannot do that.
  publishPipelineChanged(ticket.id);
  publishTicketCreated(ticket.id);

  return { outcome: INGEST_OUTCOME.created, ticketId: ticket.id, messageId };
}
