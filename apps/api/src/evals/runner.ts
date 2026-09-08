import {
  PIPELINE_OUTCOME,
  type AutoReplyDecline,
  type PipelineOutcome,
} from "@ticket/shared";
import type { AutoReplyCase } from "@ticket/core";
import { autoReply, type AutoReplyResult } from "../ai/auto-reply";
import type { KbArticle } from "../ai/knowledge-base";
import { isRetryable } from "../jobs/ai-retry";

/**
 * Answering one case, and deciding whether it landed where it said it would.
 *
 * The measuring half of the eval harness; `../jobs/eval-run.ts` is the half
 * that stores the answer. Everything here is values in and values out: a
 * corpus, a case, a verdict.
 *
 * **This is where PRD R12 is bought, and it is bought structurally.** A case is
 * handed to `autoReply` as a synthesized `AutoReplyContext` — three strings —
 * rather than posted through `ingest.ts`. `autoReply` takes its corpus as a
 * value and, in `jobs/auto-reply-ticket.ts`'s own words, "touches no database at
 * all", so there is no ticket row for this module to avoid creating: the code
 * path a run reaches cannot create one. "An eval run creates and modifies
 * nothing a customer or an agent would see" is then a property of which
 * function the harness calls, not a promise a reviewer has to keep checking.
 *
 * The cost of that entry point is stated in the PRD's risks and is worth
 * repeating where somebody is reading the code: **ingestion, threading and the
 * classify-to-auto-reply handoff are never exercised by a run.** The mitigation
 * is that `/pipeline` posts the *same* cases through the real path (`R1`,
 * `AUTO_REPLY_CASES` in `@ticket/core`), so a disagreement between the two
 * readers localises the fault to the half they do not share.
 *
 * ## What this deliberately does not do
 *
 * Three of the nine `AUTO_REPLY_DECLINE` reasons — `category`, `answered` and
 * `noText` — are decided by the auto-reply **job**'s three preflight gates,
 * before `autoReply` is ever called: they read `ticket.category` and the
 * messages, not the model. So they are unreachable from this seam, and a case
 * expecting one of them can only be recorded as a mismatch. That is why slice 1
 * runs `off-corpus` and not the whole set; slice 2 extracts those gates into a
 * pure predicate and the reasons become reachable from values.
 */

/** What one case did, and whether that is what the case said it would do. */
export interface EvalCaseOutcome {
  outcome: PipelineOutcome;
  /** The reason, when it declined or the provider failed. Null on a reply. */
  decline: AutoReplyDecline | null;
  /** Outcome and — when the case expected a decline — reason, both as written. */
  matched: boolean;
}

/**
 * An `AutoReplyResult` as the rail reads it.
 *
 * Three outcomes rather than two, and the third is what keeps the numbers
 * honest. `provider`, `busy` and `empty` mean the model could not be asked —
 * the same split `../jobs/ai-retry` already draws for the retry ladder — so
 * they are `abandoned` rather than `declined`. Counting an outage as a case the
 * model got wrong is how a harness starts crying wolf, which the PRD names as
 * the exact failure it exists to prevent; and an `abandoned` case can never
 * match an expectation, so a run through an outage reads as broken rather than
 * as a regression.
 *
 * `unavailable` is still reported as the reason, because "the provider failed"
 * is the useful thing to see beside a run that went nowhere.
 */
function verdictOf(result: AutoReplyResult): {
  outcome: PipelineOutcome;
  decline: AutoReplyDecline | null;
} {
  if (result.ok) {
    return { outcome: PIPELINE_OUTCOME.resolved, decline: null };
  }

  return {
    outcome: isRetryable(result.reason)
      ? PIPELINE_OUTCOME.abandoned
      : PIPELINE_OUTCOME.declined,
    decline: result.decline,
  };
}

/**
 * Answer one case against one corpus, and say whether it landed as expected.
 *
 * `articles` is passed in rather than read here, so the caller decides which
 * corpus a run answered (R4) and this module stays free of the database
 * entirely — which is the property R12 rests on.
 */
export async function answerCase(
  articles: KbArticle[],
  evalCase: AutoReplyCase,
  signal?: AbortSignal,
): Promise<EvalCaseOutcome> {
  const result = await autoReply(
    articles,
    {
      subject: evalCase.values.subject,
      // Null when the email was HTML-only, which is what the ticket read would
      // have produced: an HTML-only email writes a message whose `textBody` is
      // null, and the prompt has a branch for it. `|| null` rather than
      // `?? null` on purpose — an empty body and an absent one are the same
      // thing to a prompt, and `auto-reply-ticket.ts` reads it the same way.
      text: evalCase.values.textBody.trim() || null,
      // The From display name, untrusted, exactly as it arrives on a real
      // email. `greetingName` is what neutralises it, and running a case with a
      // hostile one is how that is observed.
      customerName: evalCase.values.senderName,
    },
    signal,
  );

  const { outcome, decline } = verdictOf(result);

  return {
    outcome,
    decline,
    // A declined case has to reach the **expected reason**, not merely decline.
    // "Expected declined, got declined for a completely different reason" is
    // the finding this whole thing exists to surface: a payload thrown out for
    // having no citation is not the money check holding.
    matched:
      outcome === evalCase.expected.outcome &&
      decline === evalCase.expected.decline,
  };
}
