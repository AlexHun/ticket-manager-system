import type { PgBoss, Db } from "pg-boss";
import {
  MESSAGE_DIRECTION,
  TICKET_ACTIVITY_ACTION,
  TICKET_EVENT_FIELD,
} from "@ticket/shared";
import { classifyTicket } from "../ai/classify";
import { isAiConfigured } from "../ai/provider";
import { prisma } from "../db";
import {
  publishPipelineChanged,
  publishTicketUpdated,
} from "../events/ticket-events";
import { assistantActor, recordActivity } from "../ticket-activity";
import { isRetryable } from "./ai-retry";
import { enqueueAutoReply } from "./auto-reply-ticket";
import { ensureQueue, getBoss, registerWorker, type WorkerSpec } from "./boss";

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
 * transiently is already retrying, and the full backoff ladder in `./boss` runs
 * a little over seven minutes. Anything inside that window is in hand, so
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
 * How long a job may be active before pg-boss assumes the worker died and
 * offers it to someone else.
 *
 * Comfortably over the 20s ceiling inside `classifyTicket`, so a slow call is
 * never mistaken for a dead one, and short enough that a process killed
 * mid-classification frees its ticket in about the time it takes to redeploy.
 */
const EXPIRE_IN_SECONDS = 120;

/** A `type` rather than an `interface`, so it satisfies `WorkerSpec`'s payload
 *  constraint — see the note there. */
export type ClassifyTicketJob = {
  ticketId: number;
};

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
 * whole contract with pg-boss, and it is why the transient/terminal split in
 * `./ai-retry` is the interesting part of this path.
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
    // The stamp moved this ticket from "still to be classified" to "abandoned"
    // on the rail, which is a stop on the diagram changing without anything an
    // agent would notice. `/pipeline` is the only screen that draws it.
    publishPipelineChanged(ticketId);
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

  // Below the guard, so the trail records what the classifier *wrote* rather
  // than what it decided. A ticket an agent filed during the call took the
  // branch above, and an entry there would tell whoever reads this ticket that a
  // machine overruled them — on precisely the tickets where it did not.
  //
  // `fromValue` is null by construction: the `where` above only matched because
  // the column was empty.
  //
  // **Above the publishes, not below them, and that ordering is the fix for a
  // real defect (#176).** `ticket_updated` invalidates `ticketKeys.activity` on
  // the client, so a detail pane open on this ticket refetches the trail the
  // moment the event lands. Published first, that refetch races an entry that
  // has not been written yet — and the window is not an instant: this awaits
  // `assistantActor()`, an uncached `findFirst` on the user table, before the
  // insert. Two round trips. The pane can cache a trail missing the entry and
  // never be told again, because the only event that would have corrected it has
  // already fired. Write the fact, then announce it.
  await recordActivity(
    ticketId,
    {
      action: TICKET_ACTIVITY_ACTION.category_changed,
      toValue: result.category,
    },
    await assistantActor(),
  );

  // Below the same guard the activity row is, and for the same reason: this
  // announces what the classifier *wrote*. A ticket an agent filed during the
  // call took the branch above and has nothing to announce.
  //
  // Two events, two audiences: the rail is admin-only, while a category landing
  // on a ticket is something every agent's list and any open detail pane has
  // just stopped being right about.
  publishPipelineChanged(ticketId);
  publishTicketUpdated(ticketId, [TICKET_EVENT_FIELD.category]);

  // Hand it to the auto-reply, the next stage of the pipeline: classify,
  // then answer if the knowledge base covers it.
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

/**
 * Give up on a ticket, without leaving the sweep to offer it back forever.
 *
 * The dead-letter side of this queue, and it is not a graveyard: stamping
 * `classifiedAt` is what moves the ticket from "still to be classified" to
 * "abandoned", so `reconcile` above stops picking it up every fifteen minutes
 * for a day. The failed job row stays in `pgboss` with its error attached, which
 * is the only place the reason survives.
 *
 * The log line and the Sentry alert are made by `registerWorker` before this
 * runs; what is left is the repair.
 */
async function onExhausted({ ticketId }: ClassifyTicketJob): Promise<void> {
  // `updateMany`, not `update`: the ticket may have been deleted between the
  // last attempt and this one, and a missing row must not fail the job and send
  // it round again.
  await prisma.ticket.updateMany({
    where: { id: ticketId, classifiedAt: null },
    data: { classifiedAt: new Date() },
  });
  publishPipelineChanged(ticketId);
}

/**
 * What `./boss` needs to run this queue, and nothing it can work out itself.
 *
 * Exported because it is also how the two halves are reached without a queue
 * backend: `CLASSIFY_WORKER.handle({ ticketId })` is a function call, and a test
 * that wants to prove the terminal path stamps the ticket does not have to
 * stand up pg-boss to reach it.
 */
export const CLASSIFY_WORKER: WorkerSpec<ClassifyTicketJob> = {
  name: CLASSIFY_QUEUE,
  concurrency: LOCAL_CONCURRENCY,
  expireInSeconds: EXPIRE_IN_SECONDS,
  handle,
  onExhausted,
};

/** Create the queues and start the workers. Called once, from `./index`. */
export async function registerClassifyTicket(boss: PgBoss): Promise<void> {
  await registerWorker(boss, CLASSIFY_WORKER);

  await ensureQueue(boss, RECONCILE_QUEUE, {
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
