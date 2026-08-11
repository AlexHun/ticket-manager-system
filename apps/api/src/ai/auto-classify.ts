import { MESSAGE_DIRECTION } from "@ticket/shared";
import { prisma } from "../db";
import { classifyTicket } from "./classify";
import { isAiConfigured } from "./provider";

/**
 * Running the classifier behind the webhook that made it necessary.
 *
 * `classify.ts` decides what a ticket is. This decides when that happens, and
 * the answer is "not while Postmark is waiting". An inbound webhook is on a
 * provider's clock: Postmark retries what it considers a slow or failed
 * delivery, so a handler that waits several seconds for a model turns a
 * classification outage into duplicate ingestion attempts and, on a bad day,
 * into email the desk never receives. The ticket and its message are what the
 * webhook promises; the category is an improvement to something already saved.
 *
 * So `scheduleClassification` returns immediately and the work happens after the
 * response. Everything below exists to make that safe rather than merely
 * unblocking:
 *
 * - Nothing here throws into the caller, and nothing rejects. A background
 *   promise that rejects is an unhandled rejection with no request context and
 *   no user to tell, and under Bun that is a process-level event, not a log line
 *   somebody will find later.
 * - The queue is capped, so a mail flood costs a bounded amount of memory and a
 *   bounded number of provider calls rather than one per message all at once.
 * - The write refuses to overwrite a human. An agent who categorises a ticket in
 *   the seconds it takes to answer has decided, and a model does not get to
 *   correct them.
 *
 * What this is not: durable. The queue is in memory and per process, so a
 * restart, a crash, or a deploy drops whatever was waiting, and two API
 * instances each run their own. The consequence is a ticket that stays
 * uncategorised — the state every ticket starts in, that the UI already draws,
 * and that an agent can fix in one click. That is the whole reason this can be
 * an array and a counter instead of the queue `tech-stack.md` defers: the work
 * is optional, idempotent and cheap to lose. Anything that ever becomes
 * *required* to happen after ingestion needs a real job table, not this.
 */

/**
 * How many classifications may be in flight at once.
 *
 * Two, because the thing being protected is not this process — it is the
 * provider account shared with polishing and summarising, both of which have an
 * agent watching a spinner. A burst of forty forwarded emails should not put
 * forty requests in front of the one an agent is waiting on. Sequential (a cap
 * of one) would be safer still and takes twenty minutes to clear that same burst
 * at a few seconds each, which is long enough for the categories to arrive after
 * the agent has already read the tickets.
 */
const MAX_CONCURRENT = 2;

/**
 * How many tickets may be waiting.
 *
 * The backstop for a mailing list looping into the support address, which is the
 * realistic version of "a lot of mail at once" — several hundred messages in a
 * minute, none of them worth classifying. Past this, new arrivals are dropped
 * rather than queued: uncategorised is the honest state for a ticket nobody
 * looked at, and a queue growing without bound behind a webhook is how a process
 * runs out of memory answering 201s.
 */
const MAX_QUEUE = 200;

/** Ticket ids waiting for a slot, oldest first. */
const queue: number[] = [];

/**
 * Ids that are queued or in flight, so the same ticket is never classified
 * twice concurrently.
 *
 * Belt and braces next to the `category: null` guard on the write, and worth
 * having anyway: two calls for one ticket is money spent to reach the same
 * answer, and the loser of the race is the one that already paid.
 */
const pending = new Set<number>();

let running = 0;

/**
 * Ask for this ticket to be classified, at some point, if that is possible.
 *
 * Returns immediately and always. Call it *after* the response has been written
 * — the ordering is the entire feature, and it is not enforceable from here.
 */
export function scheduleClassification(ticketId: number): void {
  // A deployment with no key classifies nothing, exactly as it polishes nothing
  // and summarises nothing. Checked here rather than inside the run so that no
  // queue builds up in a deployment that can never drain it.
  if (!isAiConfigured()) return;

  if (pending.has(ticketId)) return;
  if (queue.length >= MAX_QUEUE) {
    console.warn(
      `[classify] queue full (${MAX_QUEUE}), skipping ticket ${ticketId}`,
    );
    return;
  }

  pending.add(ticketId);
  queue.push(ticketId);
  pump();
}

/** Start as much queued work as the concurrency cap allows. */
function pump(): void {
  while (running < MAX_CONCURRENT && queue.length > 0) {
    const ticketId = queue.shift()!;
    running++;
    // `void` and a `finally` rather than an `await`: this function is called
    // from a synchronous path and must not become one the caller can wait on.
    // `run` is written so that it cannot reject; the `catch` is here in case a
    // future edit makes that untrue, because the alternative is a slot leaked
    // out of `running` and a queue that stops draining for the life of the
    // process.
    void run(ticketId)
      .catch((err: unknown) => {
        console.error(`[classify] ticket ${ticketId} failed:`, err);
      })
      .finally(() => {
        running--;
        pending.delete(ticketId);
        pump();
      });
  }
}

/** Classify one ticket and file the answer, if it is still wanted. */
async function run(ticketId: number): Promise<void> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: {
      subject: true,
      category: true,
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

  // Deleted between the webhook and here, or categorised by someone in the
  // meantime. Either way there is nothing to do and no reason to pay for a call.
  if (!ticket || ticket.category !== null) return;

  const result = await classifyTicket({
    subject: ticket.subject,
    // Null when the first email was HTML-only. The prompt has a branch for it:
    // classify from the subject and do not guess at the body.
    text: ticket.messages[0]?.textBody?.trim() || null,
  });

  // `classifyTicket` has already logged the cause. A ticket that could not be
  // classified stays uncategorised, which is where it started.
  if (!result.ok) return;

  // `updateMany` for its `where`, not for its plurality: `update` addresses a
  // row by id and would happily overwrite a category an agent chose while the
  // model was thinking. This one writes only if the field is still empty, in a
  // single statement, so there is no window between checking and writing.
  const written = await prisma.ticket.updateMany({
    where: { id: ticketId, category: null },
    data: { category: result.category },
  });

  // Silent when the guard fired: an agent got there first, which is the system
  // working. Worth a line when it did write, because without one a classifier
  // that has quietly stopped working looks exactly like a quiet week.
  if (written.count > 0) {
    console.log(`[classify] ticket ${ticketId} filed as ${result.category}`);
  }
}
