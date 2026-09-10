import {
  AUTO_REPLY_DECLINE,
  TICKET_CATEGORY,
  type AutoReplyDecline,
  type TicketCategory,
} from "@ticket/shared";

/**
 * The four questions asked before a ticket is worth a model call.
 *
 * Lifted out of `../jobs/auto-reply-ticket.ts`, where they were a nested ternary
 * over rows that had just been read from the database; the extraction changed no
 * behaviour, and the only thing it changed is that the decision is now reachable
 * **from values**. The fourth gate (`followUp`) is newer than the extraction and
 * is argued below.
 *
 * That matters for one specific reason. Four of the ten `AUTO_REPLY_DECLINE`
 * reasons — `category`, `answered`, `noText` and `followUp` — are decided here
 * and never by the model, so before this module existed they were unreachable
 * from the eval harness's seam (`../evals/runner.ts` hands a synthesized input
 * straight to `autoReply`) and a case set claiming to cover all ten would have
 * been quietly lying about four of them. Now both callers ask the same function
 * the same question: the job passes what it read off the ticket, the harness
 * passes what the case declares.
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
 * 4. **the customer wrote again** — two or more inbound messages and nothing
 *    outbound, which is the same principle as gate 2 approached from the other
 *    side: nobody has replied, and it is still not an opening.
 *
 * Gate 4 is the answer to #221, and the answer is that the old behaviour was a
 * bug. It is reachable rather than theoretical: this queue is fed by the
 * classifier, categories land 4-17s after the webhook answers, and a customer
 * who writes twice inside that window threads onto the same ticket instead of
 * opening a second one. Until this gate existed such a ticket passed — nothing
 * outbound, `inboundCount` 2 — and `auto-reply-ticket.ts` sent the model
 * `inbound[0]`, the **older** email, after which an accepted reply resolved the
 * ticket on top of a message nobody had read. Three reasons that is wrong and
 * not merely narrow:
 *
 * - the reply answers a question the customer may have already withdrawn or
 *   corrected, and then closes the ticket, so the correction is buried under a
 *   `Resolved` row rather than sitting in a queue;
 * - the category gate above reads a classification made from the **first**
 *   email alone — classification runs once, on arrival — so a second message
 *   that turns the thread into a refund request routes straight past the one
 *   control between somebody's money and an unattended reply;
 * - every other ambiguity in this feature fails closed, and this was the single
 *   place it failed open.
 *
 * What declining costs is one rare ticket left `Open` for an agent, which is the
 * designed, common outcome of this feature and not an error path. That trade is
 * why this is a gate and not a widening of the prompt to carry both emails:
 * answering a thread from a corpus written to answer openings is a different
 * feature, and it would need its own argument, its own prompt and its own
 * measurements (see `docs/adr/0020`).
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
  if (inboundCount > 1) return AUTO_REPLY_DECLINE.followUp;
  return null;
}
