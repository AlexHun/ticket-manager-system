import {
  AUTO_REPLY_DECLINE,
  TICKET_CATEGORY,
  type AutoReplyDecline,
  type TicketCategory,
} from "@ticket/shared";

/**
 * The three questions asked before a ticket is worth a model call.
 *
 * Lifted out of `../jobs/auto-reply-ticket.ts`, where they were a nested ternary
 * over rows that had just been read from the database. The behaviour is byte for
 * byte what it was — same three conditions, same order, same reasons — and the
 * only thing that changed is that the decision is now reachable **from values**.
 *
 * That matters for one specific reason. Three of the nine `AUTO_REPLY_DECLINE`
 * reasons — `category`, `answered` and `noText` — are decided here and never by
 * the model, so before this module existed they were unreachable from the eval
 * harness's seam (`../evals/runner.ts` hands a synthesized input straight to
 * `autoReply`) and a case set claiming to cover all nine would have been quietly
 * lying about three of them. Now both callers ask the same function the same
 * question: the job passes what it read off the ticket, the harness passes what
 * the case declares.
 *
 * A leaf on purpose — one import, of constants — so nothing has to mock it and
 * nothing it reaches can drift. It touches no database, which is also what keeps
 * PRD R12 structural on the harness side: a predicate over three fields reads
 * nothing and writes nothing.
 */

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
 *
 * It moved here with the gate that reads it rather than staying in the job. The
 * argument above is unchanged by the move — this is still code with a review and
 * a deploy in front of it — and leaving the constant a module away from the only
 * thing that consults it is how a list like this gets edited by somebody who
 * never reads the paragraph.
 */
export const ANSWERABLE_CATEGORIES = [
  TICKET_CATEGORY.General,
  TICKET_CATEGORY.Technical,
  TICKET_CATEGORY.Other,
] as const;

/**
 * Everything the preflight gates are allowed to know about a ticket.
 *
 * Three facts, and deliberately not the ticket row: an object of three fields is
 * something a stored eval case can declare and something the job can assemble
 * from what it has already read, which is the whole point of the extraction.
 */
export interface AutoReplyGateFacts {
  /** `null` while the classifier has not answered, or could not be reached. */
  category: TicketCategory | null;
  /** Whether anybody — agent or assistant — has already replied on the thread. */
  hasOutbound: boolean;
  /** How many inbound messages the ticket carries. */
  inboundCount: number;
}

/**
 * Why this ticket is not worth asking the model about, or `null` to go ahead.
 *
 * Order is load-bearing and is the order the job evaluated these in:
 *
 * 1. **money** — `Refund`, or still unclassified. A machine may not answer
 *    either, and "not yet classified" is refused rather than waited on: the
 *    classifier stamps a category before this queue is offered anything, so a
 *    null here means it failed, and answering from the knowledge base without
 *    knowing what was asked is the one thing this feature must never do.
 * 2. **somebody already replied** — the corpus answers openings, not threads. A
 *    conversation with a human in it is a conversation with a human in it.
 * 3. **nothing to read** — no inbound message at all.
 *
 * Reported one at a time rather than as a single boolean, because the reason is
 * what an agent opening the ticket afterwards actually needs, and it is what the
 * eval harness measures. A ticket that trips two gates reports the first, which
 * is the same thing the ternary did.
 *
 * Note what *is* answerable and looks as though it should not be: an email whose
 * body was HTML-only still counts as an inbound message. It has a message row
 * with a null `textBody`, so it reaches the model and is declined as `notCovered`
 * on the merits, and `noText` is reserved for a ticket carrying no inbound
 * message at all — a state ingestion cannot produce, since a ticket is created
 * by an inbound email. That is the gate's contract, not an accident, and it is
 * why the harness has a case that declares it rather than one that sends an
 * empty email.
 */
export function gateDecline({
  category,
  hasOutbound,
  inboundCount,
}: AutoReplyGateFacts): AutoReplyDecline | null {
  if (
    category === null ||
    !ANSWERABLE_CATEGORIES.some((answerable) => answerable === category)
  ) {
    return AUTO_REPLY_DECLINE.category;
  }
  if (hasOutbound) return AUTO_REPLY_DECLINE.answered;
  if (inboundCount === 0) return AUTO_REPLY_DECLINE.noText;
  return null;
}
