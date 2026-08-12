import * as Sentry from "@sentry/bun";
import type { PgBoss, Db, Queue } from "pg-boss";
import { MESSAGE_DIRECTION } from "@ticket/shared";
import { classifyTicket } from "../ai/classify";
import { isAiConfigured } from "../ai/provider";
import { prisma } from "../db";
import { isRetryable } from "./ai-retry";
import { enqueueAutoReply } from "./auto-reply-ticket";
import { ensureQueue, getBoss } from "./boss";

/**
 * Classifying a ticket, off the request that created it.
 *
 * The scheduling half of the classifier; `ai/classify.ts` is the deciding half.
 * This ran on an in-memory array until pg-boss arrived, and the reasoning that
 * put it in the background in the first place is unchanged:
 *
 * **An inbound webhook is on a provider's clock.** Postmark retries what it
 * considers a slow or failed delivery, so a handler that waits several seconds
 * for a model turns a classification outage into duplicate ingestion and, on a
 * bad day, into email the desk never receives. The ticket and its message are
 * what the webhook owes Postmark. The category is an improvement to something
 * already saved, and it must never be on that critical path.
 *
 * What pg-boss changes is what happens when it goes wrong. Three failures in
 * `AiFailure` — `provider`, `busy`, `empty` — mean "try again in a moment", and
 * an in-memory queue had nothing to try again with: the ticket stayed
 * uncategorised forever and nothing recorded that it had ever been attempted. A
 * restart lost the queue outright. Both are fixed below, and neither could be
 * fixed without somewhere durable to put the work.
 *
 * **The ticket row is still the source of truth, not the job.** pg-boss delivers
 * at least once, so a job may arrive twice, arrive late, or arrive after an
 * agent has already filed the ticket by hand. Every guard that made the
 * in-memory version safe survives for that reason: re-read the ticket, bail if
 * it is already decided, and write through a conditional `updateMany` so a human
 * who chose a category during the model call wins. Do not replace those with a
 * check on job state — the job is a nudge, the ticket is the fact.
 */

/** The queue a new ticket is announced on. */
export const CLASSIFY_QUEUE = "classify-ticket";

/**
 * Where a job goes after it has exhausted its retries.
 *
 * Not a graveyard: it has a worker (`registerClassifyTicket` below) whose only
 * duty is to stamp `classifiedAt` so the reconciliation sweep stops offering the
 * ticket back. The failed job row stays in `pgboss` with its error attached,
 * which is the only place the reason survives.
 */
const CLASSIFY_DEAD_QUEUE = "classify-ticket-dead";

/** The cron queue that looks for tickets nothing ever got to. */
const RECONCILE_QUEUE = "classify-ticket-reconcile";

/**
 * How often the sweep runs. Fifteen minutes is far below the window it searches
 * and far above the cost of the query.
 */
const RECONCILE_CRON = "*/15 * * * *";

/**
 * The age band the sweep considers, and the reason it has a floor as well as a
 * ceiling.
 *
 * The ceiling is 24 hours because a ticket nobody classified within a day is a
 * ticket to look at by hand, not one to keep paying a model for; without it a
 * permanently unclassifiable ticket would be re-enqueued every fifteen minutes
 * forever.
 *
 * The floor is ten minutes, and it is what keeps the sweep from fighting the
 * normal path. A freshly ingested ticket is already queued; one that is failing
 * transiently is already retrying, and the full backoff ladder below runs a
 * little over seven minutes. Anything inside that window is in hand, so
 * considering it would only produce a duplicate job. Duplicates are *harmless*
 * here — the handler is idempotent, which is the property that makes all of this
 * safe — but harmless is not free, and each one is a model call.
 */
const RECONCILE_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const RECONCILE_MIN_AGE_MS = 10 * 60 * 1_000;

/** How many stragglers one sweep may pick up. Bounded so a bad day cannot become a bill. */
const RECONCILE_BATCH = 50;

/**
 * Concurrent classifications on this node.
 *
 * Two, and for the reason the in-memory version capped at two: the thing being
 * protected is not this process but the provider account shared with polishing
 * and summarising, both of which have an agent watching a spinner. A burst of
 * forty forwarded emails must not put forty requests in front of the one someone
 * is waiting on. pg-boss spawns this many independent workers, each fetching and
 * failing on its own — which is why this is `localConcurrency` rather than
 * `batchSize`: a batch shares its fate, and one ticket's transient failure would
 * drag its neighbours back through the retry ladder with it.
 */
const LOCAL_CONCURRENCY = 2;

/**
 * The retry ladder: 30s, then roughly 60, 120 and 240, with jitter.
 *
 * Sized against what it is waiting for. A rate limit clears in seconds and a
 * provider incident in minutes, so the early rungs are close together and the
 * last one is far enough out to sit through a short outage. Five attempts in
 * about seven and a half minutes, then the dead-letter queue.
 */
const RETRY_LIMIT = 4;
const RETRY_DELAY_SECONDS = 30;

/**
 * How often a worker polls while LISTEN/NOTIFY is up.
 *
 * pg-boss defaults this to 30s on the reasoning that NOTIFY already wakes a
 * worker the moment a job is inserted, so polling is only a backstop. That
 * reasoning has a hole, and it cost an afternoon to find: **NOTIFY fires on
 * insert, not when a retry becomes due.** A job that failed and is waiting out
 * its backoff is not inserted again — it changes state in place — so nothing
 * wakes anyone, and every rung of the ladder below picks up an extra delay of up
 * to the backstop interval. Measured on the default: a one-second retry delay
 * took 58 seconds to run.
 *
 * Five seconds keeps retries roughly honest without turning the backstop back
 * into the primary mechanism. First delivery is still immediate via NOTIFY; this
 * only governs how late a *retry* can be.
 */
const NOTIFY_POLL_SECONDS = 5;

/**
 * How long a job may be active before pg-boss assumes the worker died and
 * offers it to someone else.
 *
 * Comfortably over the 20s ceiling inside `classifyTicket`, so a slow call is
 * never mistaken for a dead one, and short enough that a process killed
 * mid-classification frees its ticket in about the time it takes to redeploy.
 */
const EXPIRE_IN_SECONDS = 120;

export interface ClassifyTicketJob {
  ticketId: number;
}

/**
 * Ask for this ticket to be classified.
 *
 * `db` takes a `fromPrisma(tx)` adapter so the enqueue can join the caller's
 * transaction — see the inbound-email webhook, where the ticket insert and this
 * job commit together or not at all. Called without one, it enqueues on its own
 * connection, which is what the reconciliation sweep does.
 *
 * A deployment with no AI key enqueues nothing. The check belongs here rather
 * than in the handler so that no queue accumulates work that cannot run: the
 * E2E suite has no key, and it should not be quietly building a backlog to
 * process the day somebody adds one.
 */
export async function enqueueClassification(
  ticketId: number,
  db?: Db,
): Promise<void> {
  if (!isAiConfigured()) return;

  await getBoss().send(
    CLASSIFY_QUEUE,
    { ticketId } satisfies ClassifyTicketJob,
    db ? { db } : {},
  );
}

/**
 * Classify one ticket and file the answer, if it is still wanted.
 *
 * Throws to ask for a retry, returns to say the matter is closed. That is the
 * whole contract with pg-boss, and it is why `RETRYABLE` above is the interesting
 * part of this module.
 */
async function handle(job: ClassifyTicketJob): Promise<void> {
  const { ticketId } = job;

  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: {
      subject: true,
      category: true,
      classifiedAt: true,
      messages: {
        // The first inbound message: the one that opened the ticket and the one
        // the subject line belongs to. A category describes what a ticket is
        // about, which is settled by what was asked, not by the latest reply.
        where: { direction: MESSAGE_DIRECTION.inbound },
        // Oldest first, `id` breaking the tie exactly as the thread query does —
        // `createdAt` defaults to now() and a batch insert shares an instant.
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 1,
        // `textBody` alone. `htmlBody` is stored and never leaves this process —
        // see the "never render email HTML" rule — and a prompt is not the
        // exception that starts.
        select: { textBody: true },
      },
    },
  });

  // Deleted since the job was queued, already decided by a previous delivery of
  // this same job, or categorised by a person in the meantime. All three mean
  // there is nothing to do and no reason to pay for a call — and between them
  // they are what makes at-least-once delivery harmless here.
  if (!ticket) return;
  if (ticket.classifiedAt !== null) return;
  if (ticket.category !== null) return;

  const result = await classifyTicket({
    subject: ticket.subject,
    // Null when the first email was HTML-only. The prompt has a branch for it:
    // classify from the subject and do not guess at the body.
    text: ticket.messages[0]?.textBody?.trim() || null,
  });

  if (!result.ok) {
    // `classifyTicket` has already logged the cause with its stack.
    if (isRetryable(result.reason)) {
      throw new Error(`classification failed (${result.reason})`);
    }

    // Terminal. Stamp the ticket so the sweep below leaves it alone, and say so
    // once at error level — a misconfigured key is not visible anywhere else,
    // and without this it looks exactly like a quiet week.
    console.error(
      `[classify] ticket ${ticketId} abandoned: ${result.reason} is not retryable`,
    );
    await prisma.ticket.update({
      where: { id: ticketId },
      data: { classifiedAt: new Date() },
    });
    return;
  }

  // `updateMany` for its `where`, not for its plurality: `update` addresses a
  // row by id and would happily overwrite a category an agent chose while the
  // model was thinking. This one writes only if the field is still empty, in a
  // single statement, so there is no window between checking and writing.
  const written = await prisma.ticket.updateMany({
    where: { id: ticketId, category: null },
    data: { category: result.category, classifiedAt: new Date() },
  });

  // Silent when the guard fired: an agent got there first, which is the system
  // working. Worth a line when it did write, because without one a classifier
  // that has quietly stopped working looks exactly like a quiet week.
  if (written.count === 0) return;
  console.log(`[classify] ticket ${ticketId} filed as ${result.category}`);

  // Hand it to the auto-reply, which is the next stage of the pipeline
  // `implementation-plan.md` Phase 6 describes: classify, then answer if the
  // knowledge base covers it.
  //
  // Chained here rather than enqueued alongside this job from the webhook,
  // because the category is one of the auto-reply's eligibility gates — a Refund
  // ticket is never answered unattended — and a gate cannot read a column that
  // has not been written yet. It also means the only tickets offered to the
  // auto-reply are ones this job actually filed: a ticket an agent categorised
  // by hand during the call took the `written.count === 0` branch above, and a
  // person who is already looking at a ticket does not need a machine writing to
  // their customer underneath them.
  await enqueueAutoReply(ticketId);
}

/**
 * Offer back any ticket that fell through the cracks.
 *
 * The backstop for everything a queue cannot promise on its own: tickets created
 * while this process was down, tickets that predate the queue, and anything lost
 * to a crash between two writes. It reads the tickets themselves rather than
 * pg-boss's tables, which is the point — the ticket row is the record of what
 * needs doing, so this stays correct even for work that was never enqueued.
 */
async function reconcile(): Promise<void> {
  const now = Date.now();

  const stale = await prisma.ticket.findMany({
    where: {
      // Never reached a verdict: not filed, and not abandoned. A ticket an agent
      // deliberately un-categorised has `classifiedAt` set and is left alone,
      // which is the distinction this column exists to draw.
      classifiedAt: null,
      category: null,
      createdAt: {
        gte: new Date(now - RECONCILE_MAX_AGE_MS),
        lt: new Date(now - RECONCILE_MIN_AGE_MS),
      },
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: RECONCILE_BATCH,
  });

  if (stale.length === 0) return;

  console.log(`[classify] reconciling ${stale.length} unclassified ticket(s)`);
  for (const ticket of stale) {
    await enqueueClassification(ticket.id);
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
export async function registerClassifyTicket(boss: PgBoss): Promise<void> {
  // The dead-letter queue first: naming it on the queue below requires it to
  // exist. It takes no retries of its own — a job arrives here precisely
  // because retrying stopped being the answer.
  await ensureQueue(boss, CLASSIFY_DEAD_QUEUE, { retryLimit: 0 });

  await ensureQueue(boss, CLASSIFY_QUEUE, {
    ...QUEUE_DEFAULTS,
    deadLetter: CLASSIFY_DEAD_QUEUE,
    // Wake workers on insert instead of waiting out a poll, which keeps the
    // near-instant pickup the in-memory queue had. It degrades rather than
    // breaks behind a transaction-mode pooler, where a session-scoped LISTEN
    // cannot survive: pg-boss falls back to polling on its own.
    notify: true,
  });

  await boss.work<ClassifyTicketJob>(
    CLASSIFY_QUEUE,
    {
      batchSize: 1,
      localConcurrency: LOCAL_CONCURRENCY,
      notifyPollingIntervalSeconds: NOTIFY_POLL_SECONDS,
    },
    async ([job]) => {
      await handle(job!.data);
    },
  );

  // The dead-letter worker. Its whole job is to record that we gave up, so the
  // sweep does not offer the same ticket back every fifteen minutes for a day.
  await boss.work<ClassifyTicketJob>(
    CLASSIFY_DEAD_QUEUE,
    { batchSize: 1 },
    async ([job]) => {
      const { ticketId } = job!.data;
      console.error(
        `[classify] ticket ${ticketId} exhausted its retries; leaving it uncategorised`,
      );
      // Reported here and nowhere earlier. A failing attempt is not news — the
      // retry ladder in this file exists because `provider`/`busy`/`empty` are
      // expected to fail and expected to succeed on the next rung, and an alert
      // per attempt would train everyone to ignore the channel. Arriving here
      // means the ladder ran out. The ticket id is a tag rather than part of the
      // message so every occurrence groups into one issue.
      Sentry.withScope((scope) => {
        scope.setTag("queue", CLASSIFY_DEAD_QUEUE);
        scope.setContext("job", { ticketId });
        Sentry.captureMessage("classify-ticket exhausted its retries", "error");
      });
      // `updateMany`, not `update`: the ticket may have been deleted between the
      // last attempt and this one, and a missing row must not fail the job and
      // send it round again.
      await prisma.ticket.updateMany({
        where: { id: ticketId, classifiedAt: null },
        data: { classifiedAt: new Date() },
      });
    },
  );

  await boss.createQueue(RECONCILE_QUEUE, {
    // One sweep at a time, and no retries: if a sweep fails, the next one is
    // fifteen minutes away and will see exactly the same tickets.
    policy: "singleton",
    retryLimit: 0,
    expireInSeconds: EXPIRE_IN_SECONDS,
  });
  await boss.work(RECONCILE_QUEUE, { batchSize: 1 }, async () => {
    await reconcile();
  });
  // Registered on every boot; pg-boss upserts the schedule rather than stacking
  // them, and only one node in a cluster runs the cron.
  await boss.schedule(RECONCILE_QUEUE, RECONCILE_CRON);
}
