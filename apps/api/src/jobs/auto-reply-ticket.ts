import * as Sentry from "@sentry/bun";
import type { PgBoss, Queue } from "pg-boss";
import {
  AUTO_REPLY_DECLINE,
  MESSAGE_DIRECTION,
  TICKET_CATEGORY,
  TICKET_STATUS,
  type AutoReplyDecline,
} from "@ticket/shared";
import { autoReply, AUTO_REPLY_FAILURE } from "../ai/auto-reply";
import { autoReplyArticles } from "../ai/knowledge-base";
import { isAiConfigured } from "../ai/provider";
import { prisma } from "../db";
import { newOutboundMessageId } from "../message-id";
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
 * Who the reply comes from.
 *
 * Constants rather than env vars, following `message-id.ts`: there is no mail
 * transport yet, so there is nothing to configure them for, and a required env
 * var that nothing reads is a deployment trap. These are two of the handful of
 * lines to change when Phase 3 lands. `example.com` is reserved by RFC 2606, so
 * a misconfigured test cannot reach a real address.
 *
 * The name says "automated" because it is rendered: it sits above the bubble in
 * the thread, beside the badge that `Message.automated` drives. A support desk
 * that hides which replies it wrote by machine is one bad reply away from
 * needing to explain why.
 */
const SUPPORT_EMAIL = "support@example.com";
const SUPPORT_NAME = "Support (automated)";

/**
 * Categories a machine may answer.
 *
 * `Refund` is absent, and this is the second of two independent gates — every
 * refund article in the knowledge base is also marked `Auto-reply: no`. Two,
 * because they fail differently: the file can be edited by anyone with commit
 * access and one careless `yes` would put an unattended reply on a ticket about
 * somebody's money, while this constant is a code change with a reviewer. They
 * have to disagree before anything can go wrong.
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
 * classification too" or "delete the knowledge base".
 */
function autoReplyEnabled(): boolean {
  if (process.env.AUTO_REPLY_ENABLED === "false") return false;
  if (!isAiConfigured()) return false;
  return autoReplyArticles().length > 0;
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
  if (!autoReplyEnabled()) return;
  await getBoss().send(AUTO_REPLY_QUEUE, { ticketId } satisfies AutoReplyJob);
}

/**
 * Hand a claimed ticket back, without disturbing one that is no longer ours.
 *
 * `decline` is recorded on the way out to `Open`, which is the only exit that
 * means "a person's turn now". Going back to `New` is a retry in progress and
 * says nothing yet — stamping a reason there would put a verdict on a ticket the
 * machine is still thinking about, and the next attempt may well answer it.
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
  await prisma.ticket.updateMany({
    where: { id: ticketId, status: TICKET_STATUS.Processing },
    data: {
      status: to,
      ...(decline
        ? { autoReplyDecline: decline, autoReplyDeclinedAt: new Date() }
        : {}),
    },
  });
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

  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: {
      subject: true,
      customerName: true,
      category: true,
      messages: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { messageId: true, textBody: true, direction: true },
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
  const lastMessageId = ticket.messages.at(-1)?.messageId ?? null;

  // One transaction, and the resolve goes first so its `where` decides whether
  // the message is written at all. `Processing` is still ours only if nothing
  // released it while the model was thinking — the recovery sweep, say, or a
  // second delivery. Writing the message first and finding out afterwards would
  // leave a reply on a ticket that had moved on.
  const written = await prisma.$transaction(async (tx) => {
    const resolved = await tx.ticket.updateMany({
      where: { id: ticketId, status: TICKET_STATUS.Processing },
      data: {
        status: TICKET_STATUS.Resolved,
        autoResolvedAt: sentAt,
        lastMessageAt: sentAt,
        // A ticket must never show both verdicts. A retryable failure releases
        // to `New` without stamping one, but the recovery sweep re-enqueues a
        // ticket that has already been declined once — so a later success has
        // to clear the earlier reason rather than sit beside it.
        autoReplyDecline: null,
        autoReplyDeclinedAt: null,
      },
    });
    if (resolved.count === 0) return false;

    await tx.message.create({
      data: {
        ticketId,
        messageId: newOutboundMessageId(ticketId),
        inReplyTo: lastMessageId,
        senderEmail: SUPPORT_EMAIL,
        senderName: SUPPORT_NAME,
        textBody: result.reply,
        direction: MESSAGE_DIRECTION.outbound,
        // No author: nobody wrote this. The flag beside it is what stops that
        // being read as "the agent who wrote it has been deleted".
        authorId: null,
        automated: true,
        // The audit trail. These are the resolved ids — every one exists in the
        // corpus the model was handed, because check 4 discarded the reply
        // otherwise — so the thread can show what this answer was built from
        // rather than asking anyone to trust it.
        citedArticleIds: result.articleIds,
        createdAt: sentAt,
      },
      select: { id: true },
    });
    return true;
  });

  if (written) {
    console.log(
      `[auto-reply] ticket ${ticketId} answered from [${result.articleIds.join(", ")}] and resolved`,
    );
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

  await boss.createQueue(RECOVER_QUEUE, {
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
