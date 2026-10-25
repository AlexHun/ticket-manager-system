/**
 * The reply to POST /api/ai/polish-reply.
 *
 * Plain text, never markup. The composer puts it straight into a textarea and
 * the thread renders `textBody` as a React text node, so anything HTML-shaped
 * would be shown literally at best — see the "never render email HTML" rule.
 *
 * Nothing is persisted by that endpoint, which is why there is no message here
 * and no id: the rewrite exists only in the agent's draft box until they send it.
 */
export interface PolishReplyResponse {
  polished: string;
}

/**
 * How the customer is coming across, as the summary reads them.
 *
 * Four levels rather than the usual positive/neutral/negative three, because the
 * axis a support desk actually triages on is heat, and "negative" flattens the
 * two ends of it that need different handling: a frustrated customer wants their
 * answer, an angry one is deciding whether to escalate. `neutral` is the honest
 * answer for a matter-of-fact report and is what a thread with nothing to read
 * gets — this is never left blank.
 */
export const SUMMARY_SENTIMENT = {
  positive: "positive",
  neutral: "neutral",
  frustrated: "frustrated",
  angry: "angry",
} as const;

export type SummarySentiment =
  (typeof SUMMARY_SENTIMENT)[keyof typeof SUMMARY_SENTIMENT];

/**
 * What the model is asked to produce about one ticket.
 *
 * Structured rather than a paragraph, because the panel renders each part
 * differently and an agent reads them at different moments: the overview answers
 * "what is this", the points answer "what has happened", the next step answers
 * "what do I do", and the sentiment is the thing they see before any of it. A
 * single blob would have to be re-parsed to lay out that way, and the model
 * would decide the shape afresh on every regeneration.
 *
 * Plain text throughout, never markup — same rule as `PolishReplyResponse`, and
 * for the same reason: this is rendered as React text nodes.
 */
export interface TicketSummary {
  /** One or two sentences: what the ticket is about and where it currently stands. */
  overview: string;
  /**
   * What happened in the thread, oldest development first. Empty on a ticket
   * whose thread says nothing beyond its overview — a bulleted restatement of
   * the sentence above it is noise, so the model is allowed to return none.
   */
  keyPoints: string[];
  /**
   * The one thing the agent should do next, or null when the thread has nothing
   * outstanding. Nullable rather than a "nothing to do" string so the panel can
   * leave the section out instead of printing a shrug.
   */
  nextStep: string | null;
  sentiment: SummarySentiment;
  /**
   * The words in the three fields above that must not be skimmed past: order and
   * ticket references, amounts, dates, error text, and whatever names the thing
   * that is blocked. The panel marks each occurrence.
   *
   * Substrings, not concepts — every entry is guaranteed to occur verbatim
   * (case-insensitively) somewhere in `overview`, `keyPoints` or `nextStep`,
   * because the server drops any that does not. A client can therefore match
   * them literally and expect a hit, and an empty list is a normal answer for a
   * summary with nothing worth singling out.
   */
  highlights: string[];
}

/**
 * The reply to POST /api/ai/summarize-ticket.
 *
 * Nothing is persisted, so there is no id and no `generatedAt`: the summary
 * exists in the panel that asked for it until the agent asks again, which is the
 * whole contract — every click is a fresh generation.
 *
 * `messageCount` is how long the thread was when the summary was made, and it is
 * the reason this is not just a `TicketSummary`. The client holds the thread
 * too, so comparing the two is what lets the panel notice that a reply has
 * landed since and say so, rather than showing a confident summary of a
 * conversation that has moved on.
 *
 * Deliberately the whole thread's length rather than the number of messages that
 * reached the model — an HTML-only email carries no `textBody` and is skipped by
 * the prompt, but it is still a message the agent can see in the thread, and a
 * count that disagreed with the one on screen would make the staleness check
 * fire at nothing.
 */
export interface SummarizeTicketResponse {
  summary: TicketSummary;
  messageCount: number;
}
