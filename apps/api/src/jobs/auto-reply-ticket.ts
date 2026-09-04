import * as Sentry from "@sentry/bun";
import type { PgBoss, Queue } from "pg-boss";
import {
  AUTO_REPLY_DECLINE,
  MESSAGE_DIRECTION,
  TICKET_ACTIVITY_ACTION,
  TICKET_CATEGORY,
  TICKET_EVENT_FIELD,
  TICKET_STATUS,
  type AutoReplyDecline,
} from "@ticket/shared";
import { autoReply, AUTO_REPLY_FAILURE } from "../ai/auto-reply";
import { autoReplyArticleCount } from "../ai/knowledge-base";
import { isAiConfigured } from "../ai/provider";
import { assistantUser, resolveHandoff } from "../automation";
import { prisma } from "../db";
import {
  publishPipelineChanged,
  publishTicketMessage,
  publishTicketUpdated,
} from "../events/ticket-events";
import { REPLY_ORIGIN, SEND_OUTCOME, sendReply } from "../outbound";
import { assistantActor, recordActivity } from "../ticket-activity";
import { isRetryable } from "./ai-retry";
import { ensureQueue, getBoss } from "./boss";

/**
 * Answering a ticket from the knowledge base, and resolving it.
 *
 * The scheduling half; `ai/auto-reply.ts` is the deciding half, and its header
 * is where the six checks that make this defensible are written down.
 *
 * **The status is the claim.** A ticket moves `New → Processing` before the model
 * is called and leaves `Processing` on every exit, and `Processing` is the one
 * status `GET /api/tickets` refuses to return. That is not bookkeeping: it is the
 * concurrency control. Without it an agent scanning the queue can open a ticket
 * a worker is composing a reply for, write their own answer, and the customer
 * receives two — one of them from a machine that thought nobody was there. The
 * ticket disappearing for the seconds this takes is the feature.
 *
 * **The ticket row is the source of truth, not the job.** pg-boss delivers at
 * least once, so a job may arrive twice, late, or after an agent has taken the
 * ticket. Every write below is conditional on the state it expects to find:
 * the claim only fires from `New`, the resolve only fires from `Processing`. A
 * second delivery finds neither and does nothing. Do not replace those with a
 * check on job state.
 *
 * **Declining is the expected outcome.** Most support mail is not a knowledge-
 * base question, and a ticket handed back as `Open` is this working correctly.
 * The logs say so: a decline is one info line, and only a discarded reply — one
 * that failed grounding, or carried money or a link from nowhere — is an error.
 */

/** The queue a classified ticket is offered on. */
export const AUTO_REPLY_QUEUE = "auto-reply-ticket";

/**
 * Where a job goes after it has exhausted its retries.
 *
 * Has a worker, like the classifier's: its duty is to release the ticket from
 * `Processing` back to `Open`, because a ticket left claimed by a worker that
 * has given up is a ticket no agent can see and nothing will ever answer.
 */
const AUTO_REPLY_DEAD_QUEUE = "auto-reply-ticket-dead";

/** The cron queue that unsticks tickets a crashed worker left claimed. */
const RECOVER_QUEUE = "auto-reply-ticket-recover";

const RECOVER_CRON = "*/5 * * * *";

/**
 * How long a ticket may sit in `Processing` before it is presumed abandoned.
 *
 * Read off `updatedAt`, which the claim moves. Comfortably past the 30s model
 * call plus the retry ladder's first rungs, so a ticket that is merely slow is
 * never stolen from a worker still holding it; short enough that a hard kill
 * costs one agent one coffee rather than a ticket vanishing until someone
 * notices. Five minutes, checked every five.
 *
 * pg-boss's own `expireInSeconds` re-offers the *job* after two minutes, and
 * that re-delivery cannot claim the ticket — the claim only fires from `New`.
 * This sweep is what puts it back to `New` so the re-delivery has something to
 * take, and what covers the case where the job is gone entirely.
 */
const PROCESSING_STALE_MS = 5 * 60 * 1_000;

/** How far back the sweep looks, and how many it takes at once. */
const RECOVER_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const RECOVER_BATCH = 50;

/**
 * Concurrent auto-replies on this node.
 *
 * Two, matching the classifier and for the same reason: the provider account is
 * shared with polishing and summarising, both of which have an agent watching a
 * spinner, and a burst of forwarded mail must not queue in front of them. Two
 * workers rather than a batch of two — a batch shares its fate, so one ticket's
 * transient failure would drag its neighbour back through the retry ladder.
 */
const LOCAL_CONCURRENCY = 2;

/** The retry ladder: 30s, then roughly 60, 120 and 240, with jitter. */
const RETRY_LIMIT = 4;
const RETRY_DELAY_SECONDS = 30;

/**
 * How often a worker polls while LISTEN/NOTIFY is up.
 *
 * Five, not pg-boss's default of thirty, for the reason documented on the
 * classifier: **NOTIFY fires on insert, not when a retry becomes due**. A job
 * waiting out its backoff is not re-inserted, so nothing wakes a worker and every
 * rung picks up an extra delay of up to the backstop interval. Measured on the
 * default, a one-second retry delay took 58 seconds.
 */
const NOTIFY_POLL_SECONDS = 5;

/**
 * How long a job may be active before pg-boss offers it to someone else.
 *
 * Over the 30s ceiling inside `autoReply`, so a slow call is never mistaken for
 * a dead one.
 */
const EXPIRE_IN_SECONDS = 120;

/**
 * Categories a machine may answer.
 *
 * `Refund` is absent, and this is the second of two independent gates — every
 * refund article in the knowledge base is also marked `Auto-reply: no`. Two,
 * because they fail differently, and the gap between them widened the day the
 * corpus moved into the database: the flag is now a checkbox on an admin screen,
 * so one careless `yes` — or one admin session in the wrong hands — would put an
 * unattended reply on a ticket about somebody's money, while this constant is a
 * code change with a reviewer and a deploy in front of it. They have to disagree
 * before anything can go wrong. Do not derive one from the other.
 */
const ANSWERABLE_CATEGORIES = [
  TICKET_CATEGORY.General,
  TICKET_CATEGORY.Technical,
  TICKET_CATEGORY.Other,
] as const;

export interface AutoReplyJob {
  ticketId: number;
}

/**
 * Whether this deployment answers tickets by itself at all.
 *
 * Three ways to be off, and the kill switch is first because it is the only one
 * an operator can reach in a hurry. A feature that writes to customers
 * unattended needs a way to be stopped that is not "revoke the API key and lose
 * classification too" or "archive every article".
 *
 * Async now that the corpus is a table rather than a cached file. The two cheap
 * checks stay first and still short-circuit, so a deployment with the feature
 * switched off or no API key never touches the database to find that out.
 */
async function autoReplyEnabled(): Promise<boolean> {
  if (process.env.AUTO_REPLY_ENABLED === "false") return false;
  if (!isAiConfigured()) return false;
  return (await autoReplyArticleCount()) > 0;
}

/**
 * Offer a ticket to the auto-reply.
 *
 * No `db` parameter, unlike `enqueueClassification`: this is only ever called
 * from inside the classify handler, which is not in a transaction and has
 * nothing to tie the enqueue to. If a future caller needs the transactional
 * form, take the same `Db` the classifier does.
 */
export async function enqueueAutoReply(ticketId: number): Promise<void> {
  if (!(await autoReplyEnabled())) return;
  await getBoss().send(AUTO_REPLY_QUEUE, { ticketId } satisfies AutoReplyJob);
}

/**
 * Give a ticket an owner, unless it already has one.
 *
 * Every write below the claim is conditional on the state it expects, and this
 * is no exception — the condition is just a different one. The claim required
 * `assignedToId: null`, but nothing stops an agent opening the ticket by id and
 * putting their name on it during the seconds the model is thinking; only the
 * *list* hides `Processing`. So the assignee is filled in rather than set, and a
 * person who got there first keeps the ticket.
 *
 * Separate from `release` and from the resolve transaction on purpose. Folding
 * `assignedToId` into either would make one statement carry two conditions that
 * are not the same condition, and the status write must happen whether or not
 * the assignee one does — a ticket stuck in `Processing` because somebody was
 * already assigned is invisible to everybody.
 *
 * A null `userId` is not an error: `unassigned` is a target an admin can choose,
 * and a deployment with no seeded assistant has nobody to file automated tickets
 * under. Both mean "leave it as it was".
 */
async function assignIfUnowned(
  ticketId: number,
  userId: string | null,
): Promise<void> {
  if (userId === null) return;
  await prisma.ticket.updateMany({
    where: { id: ticketId, assignedToId: null },
    data: { assignedToId: userId },
  });
}

/**
 * Hand a claimed ticket back, without disturbing one that is no longer ours.
 *
 * `decline` is recorded on the way out to `Open`, which is the only exit that
 * means "a person's turn now". Going back to `New` is a retry in progress and
 * says nothing yet — stamping a reason there would put a verdict on a ticket the
 * machine is still thinking about, and the next attempt may well answer it.
 *
 * **`Open` is also the only exit that assigns anybody**, and for the same
 * reason turned the other way round: the claim can only take a ticket whose
 * `assignedToId` is null, so naming an owner on the way back to `New` would put
 * the ticket beyond the reach of the retry that is already scheduled for it —
 * and beyond the recovery sweep, which releases to `New` as well. A provider
 * outage would quietly become a queue of tickets nothing would ever look at
 * again. Ownership is for when the machine is finished, never for when it is
 * pausing.
 *
 * Still conditional on holding the claim, like everything else here: a ticket a
 * recovery sweep released while the model was thinking is no longer ours to
 * annotate.
 */
async function release(
  ticketId: number,
  to: "New" | "Open",
  decline?: AutoReplyDecline,
): Promise<void> {
  const released = await prisma.ticket.updateMany({
    where: { id: ticketId, status: TICKET_STATUS.Processing },
    data: {
      status: to,
      ...(decline
        ? { autoReplyDecline: decline, autoReplyDeclinedAt: new Date() }
        : {}),
    },
  });

  // One publish for both exits, guarded the same way the assignment below is:
  // only the call that actually released it has anything to announce. A release
  // to `New` matters to the rail as much as one to `Open` — the ticket has gone
  // back to waiting, and a stop on the diagram just emptied.
  if (released.count > 0) publishPipelineChanged(ticketId);

  // Only if this call is the one that released it. A second delivery that found
  // the ticket already handed back must not re-assign it, or it would undo an
  // agent who had picked it up in between.
  if (to === TICKET_STATUS.Open && released.count > 0) {
    await assignIfUnowned(ticketId, await resolveHandoff());

    // Only this exit, and only because of what agents can see. `Processing` is
    // never published to them, so their lists still show this ticket as `New` —
    // the exit to `Open` is the first thing that is genuinely different from
    // what they have cached. A release back to `New` returns it to the state
    // they were already showing, so there is nothing to tell them.
    publishTicketUpdated(ticketId, [
      TICKET_EVENT_FIELD.status,
      TICKET_EVENT_FIELD.assignee,
    ]);

    // One entry for the whole handing-back, not three. The claim and this
    // release are a matched pair that a person never sees — `Processing` lasts
    // seconds and the tickets list refuses to return it — so logging both would
    // bury the only part that carries information under two lines describing a
    // state nobody can observe. The reason is that information: `/pipeline`
    // counts declines in aggregate, and until now the ticket an agent is
    // actually looking at never said which one it hit.
    //
    // Guarded on `decline` as well as on `count`, because a release to `New` is
    // a retry in progress and has no verdict to record yet — the same reason
    // `autoReplyDecline` is only stamped on this exit.
    if (decline) {
      await recordActivity(
        ticketId,
        {
          action: TICKET_ACTIVITY_ACTION.auto_declined,
          toValue: decline,
        },
        await assistantActor(),
      );
    }
  }
}

/**
 * Answer one ticket, if it is still there to answer and the knowledge base
 * covers it.
 *
 * Throws to ask for a retry, returns to say the matter is closed — the whole
 * contract with pg-boss.
 */
async function handle(job: AutoReplyJob): Promise<void> {
  const { ticketId } = job;

  // The claim, and the only unconditional write in this function. `updateMany`
  // for its `where`: one statement that both tests and takes, so there is no
  // window between deciding the ticket is free and making it ours.
  //
  // `assignedToId: null` is part of the claim rather than a later check. An
  // agent who has already put their name on a ticket is working it, and a
  // machine writing to their customer underneath them is precisely the collision
  // this whole mechanism exists to prevent.
  const claimed = await prisma.ticket.updateMany({
    where: {
      id: ticketId,
      status: TICKET_STATUS.New,
      assignedToId: null,
    },
    data: { status: TICKET_STATUS.Processing },
  });

  // Deleted, already answered, taken by an agent, or claimed by another delivery
  // of this same job. All of them mean there is nothing to do — and between them
  // they are what makes at-least-once delivery harmless here.
  if (claimed.count === 0) return;

  // The claim itself. This is the one event that exists *because* the audience
  // filter does: `Processing` is invisible to agents on purpose and lasts
  // seconds, so pushing it to everyone would make every open list refetch twice
  // per auto-replied ticket to render no change at all. `/pipeline` is admin-only
  // and this is the moment its rail is drawing.
  publishPipelineChanged(ticketId);

  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: {
      subject: true,
      customerName: true,
      category: true,
      messages: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        // No `messageId`: the parent an outbound reply threads onto is found by
        // `sendReply`, from the same ordering, rather than carried here.
        select: { textBody: true, direction: true },
      },
    },
  });

  // Vanished between the claim and the read. Nothing to release.
  if (!ticket) return;

  const inbound = ticket.messages.filter(
    (m) => m.direction === MESSAGE_DIRECTION.inbound,
  );
  const answeredAlready = ticket.messages.some(
    (m) => m.direction === MESSAGE_DIRECTION.outbound,
  );

  // Gate 1: money. Gate 2: somebody already replied, so this is a conversation
  // and not a new question — the knowledge base answers openings, not threads.
  // Gate 3: nothing to answer from.
  //
  // Split out of the single condition these used to share so each can say which
  // one it was. The gates are unchanged and still evaluated in the same order;
  // only the reporting is new.
  const gated =
    ticket.category === null ||
    !ANSWERABLE_CATEGORIES.some((c) => c === ticket.category)
      ? AUTO_REPLY_DECLINE.category
      : answeredAlready
        ? AUTO_REPLY_DECLINE.answered
        : inbound.length === 0
          ? AUTO_REPLY_DECLINE.noText
          : null;

  if (gated) {
    await release(ticketId, TICKET_STATUS.Open, gated);
    return;
  }

  const result = await autoReply({
    subject: ticket.subject,
    // Null when the first email was HTML-only. The prompt has a branch for it,
    // and that branch declines: there is nothing to answer.
    text: inbound[0]?.textBody?.trim() || null,
    customerName: ticket.customerName,
  });

  if (!result.ok) {
    if (isRetryable(result.reason)) {
      // Back to `New` so the retry has something to claim, and visible again in
      // the meantime — a provider outage must not hide the queue.
      await release(ticketId, TICKET_STATUS.New);
      throw new Error(`auto-reply failed (${result.reason})`);
    }

    // Terminal. `declined` is the designed outcome and says so quietly;
    // `ungrounded` means a reply was written and thrown away, which is worth
    // noticing, and `auto-reply.ts` has already logged what tripped it.
    if (result.reason === AUTO_REPLY_FAILURE.declined) {
      console.log(`[auto-reply] ticket ${ticketId} left for an agent`);
    } else {
      console.error(
        `[auto-reply] ticket ${ticketId} not answered: ${result.reason}`,
      );
    }
    await release(ticketId, TICKET_STATUS.Open, result.decline);
    return;
  }

  const sentAt = new Date();

  // One transaction, and the resolve goes first so its `where` decides whether
  // the message is written at all. `Processing` is still ours only if nothing
  // released it while the model was thinking — the recovery sweep, say, or a
  // second delivery. Writing the message first and finding out afterwards would
  // leave a reply on a ticket that had moved on. `sendReply` joins this
  // transaction rather than opening its own, which is what makes the reply and
  // the claim it was written under commit together or not at all.
  const written = await prisma.$transaction(async (tx) => {
    const resolved = await tx.ticket.updateMany({
      where: { id: ticketId, status: TICKET_STATUS.Processing },
      data: {
        status: TICKET_STATUS.Resolved,
        autoResolvedAt: sentAt,
        // `lastMessageAt` is not set here: `sendReply` moves it, from the same
        // `sentAt` this stamps `autoResolvedAt` with, so the two cannot end up
        // a moment apart.
        //
        // A ticket must never show both verdicts. A retryable failure releases
        // to `New` without stamping one, but the recovery sweep re-enqueues a
        // ticket that has already been declined once — so a later success has
        // to clear the earlier reason rather than sit beside it.
        autoReplyDecline: null,
        autoReplyDeclinedAt: null,
      },
    });
    if (resolved.count === 0) return false;

    // The origin is the whole of what makes this reply different from an
    // agent's: no author, the automated flag, and the articles it was built
    // from. Every one of those ids exists in the corpus the model was handed,
    // because check 4 in `ai/auto-reply.ts` discarded the reply otherwise — so
    // the thread can show what this answer was built from rather than asking
    // anyone to trust it.
    const sent = await sendReply(
      {
        ticketId,
        textBody: result.reply,
        origin: {
          kind: REPLY_ORIGIN.assistant,
          citedArticleIds: result.articleIds,
        },
        sentAt,
      },
      tx,
    );

    // Unreachable today: the `updateMany` above matched a row, so the ticket
    // exists inside this transaction. Thrown rather than returned so it stays
    // unreachable — returning `false` here would *commit* the resolve, leaving
    // a ticket marked answered, stamped `autoResolvedAt` and cleared of its
    // decline reason, with no answer on it and no event to say so. That is the
    // one outcome this transaction exists to prevent, and it is the kind that
    // is never noticed. Throwing rolls the resolve back; the retry that follows
    // finds nothing to claim and stops.
    if (sent.outcome !== SEND_OUTCOME.sent) {
      throw new Error(`auto-reply wrote no message for ticket ${ticketId}`);
    }
    return true;
  });

  if (written) {
    // File it under the assistant. Outside the transaction because it is not
    // part of the reply being correct: the ticket is answered and resolved
    // either way, and a deployment that has never been seeded has no assistant
    // account to name — that must leave the assignee empty, not roll back a
    // reply the customer is going to receive.
    //
    // Note what this does *not* touch. The message keeps `authorId: null` and
    // `automated: true`, because "nobody wrote this" is the fact an agent
    // reading the thread needs, and it is not the same fact as "this ticket is
    // filed under the assistant". Making the assistant the author would put a
    // name above the bubble and undo the one thing the automated badge exists
    // to say.
    await assignIfUnowned(ticketId, (await assistantUser())?.id ?? null);

    // One entry for the resolve and the assignment together: they are one event
    // — the machine finished this ticket and filed it under itself — and two
    // lines saying so would only make a short history harder to read. The
    // articles it answered from are already on the message, where the thread
    // shows them beside the words they produced.
    await recordActivity(
      ticketId,
      {
        action: TICKET_ACTIVITY_ACTION.auto_resolved,
        toValue: TICKET_STATUS.Resolved,
      },
      await assistantActor(),
    );

    console.log(
      `[auto-reply] ticket ${ticketId} answered from [${result.articleIds.join(", ")}] and resolved`,
    );

    // The verdict: the last stop on the rail, and the one anyone watching a
    // simulated ticket descend is waiting for. After the transaction and after
    // the assignment, so a subscriber that re-reads on this event sees the
    // finished ticket rather than a half-built one.
    //
    // Three events for one commit, because three different things became wrong
    // at once: the rail (admins), the ticket's status and owner, and the thread,
    // which has gained a reply nobody typed. An agent with this ticket open sees
    // the answer appear.
    publishPipelineChanged(ticketId);
    publishTicketUpdated(ticketId, [
      TICKET_EVENT_FIELD.status,
      TICKET_EVENT_FIELD.assignee,
    ]);
    publishTicketMessage(ticketId);
  }
}

/**
 * Put back any ticket a worker claimed and never finished.
 *
 * The backstop for a hard kill: `Processing` is a claim held in a database row,
 * and a process that dies holding one leaves a ticket invisible to every agent
 * with nothing scheduled to free it. pg-boss will re-offer the *job* after
 * `EXPIRE_IN_SECONDS`, but that re-delivery cannot claim a ticket that is already
 * `Processing`, so without this the two would wait for each other forever.
 *
 * Back to `New` rather than `Open`, because the work has not been attempted as
 * far as anyone can tell — an expired job is still coming, and this is what gives
 * it something to take.
 */
async function recoverStuck(): Promise<void> {
  const now = Date.now();

  const stuck = await prisma.ticket.findMany({
    where: {
      status: TICKET_STATUS.Processing,
      updatedAt: { lt: new Date(now - PROCESSING_STALE_MS) },
      createdAt: { gte: new Date(now - RECOVER_MAX_AGE_MS) },
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: RECOVER_BATCH,
  });

  if (stuck.length === 0) return;

  console.warn(
    `[auto-reply] releasing ${stuck.length} ticket(s) stuck in ${TICKET_STATUS.Processing}`,
  );
  for (const ticket of stuck) {
    await release(ticket.id, TICKET_STATUS.New);
    await enqueueAutoReply(ticket.id);
  }
}

/** Queue settings shared by the live queue and its dead-letter twin. */
const QUEUE_DEFAULTS: Omit<Queue, "name"> = {
  retryLimit: RETRY_LIMIT,
  retryDelay: RETRY_DELAY_SECONDS,
  retryBackoff: true,
  expireInSeconds: EXPIRE_IN_SECONDS,
};

/** Create the queues and start the workers. Called once, from `./index`. */
export async function registerAutoReplyTicket(boss: PgBoss): Promise<void> {
  // The dead-letter queue first: naming it below requires it to exist.
  await ensureQueue(boss, AUTO_REPLY_DEAD_QUEUE, { retryLimit: 0 });

  await ensureQueue(boss, AUTO_REPLY_QUEUE, {
    ...QUEUE_DEFAULTS,
    deadLetter: AUTO_REPLY_DEAD_QUEUE,
    notify: true,
  });

  await boss.work<AutoReplyJob>(
    AUTO_REPLY_QUEUE,
    {
      batchSize: 1,
      localConcurrency: LOCAL_CONCURRENCY,
      notifyPollingIntervalSeconds: NOTIFY_POLL_SECONDS,
    },
    async ([job]) => {
      await handle(job!.data);
    },
  );

  // Release rather than record. The classifier's dead-letter worker stamps a
  // column so its sweep stops offering the ticket back; this one has to undo a
  // claim, because the ticket is hidden until it does.
  await boss.work<AutoReplyJob>(
    AUTO_REPLY_DEAD_QUEUE,
    { batchSize: 1 },
    async ([job]) => {
      const { ticketId } = job!.data;
      console.error(
        `[auto-reply] ticket ${ticketId} exhausted its retries; handing it to an agent`,
      );
      // Same rule as the classifier's: the retry ladder is expected to be used,
      // so only running out of it is worth an alert. Note what is *not*
      // reported — a decline. `declined` and `ungrounded` are this feature
      // working, the six checks refusing to send something they cannot stand
      // behind, and routing them here would turn the safety design into a
      // stream of alerts until someone silenced it.
      Sentry.withScope((scope) => {
        scope.setTag("queue", AUTO_REPLY_DEAD_QUEUE);
        scope.setContext("job", { ticketId });
        Sentry.captureMessage(
          "auto-reply-ticket exhausted its retries",
          "error",
        );
      });
      // `unavailable`, not a judgement about the ticket: the retries ran out, so
      // nothing was ever decided about whether the knowledge base covers this.
      // An agent reading "the assistant could not be reached" knows to answer it
      // themselves; "not covered by the knowledge base" would be a claim nobody
      // made.
      await release(ticketId, TICKET_STATUS.Open, AUTO_REPLY_DECLINE.unavailable);
    },
  );

  await ensureQueue(boss, RECOVER_QUEUE, {
    // One sweep at a time, and no retries: a failed sweep sees the same tickets
    // five minutes later.
    policy: "singleton",
    retryLimit: 0,
    expireInSeconds: EXPIRE_IN_SECONDS,
  });
  await boss.work(RECOVER_QUEUE, { batchSize: 1 }, async () => {
    await recoverStuck();
  });
  await boss.schedule(RECOVER_QUEUE, RECOVER_CRON);
}
