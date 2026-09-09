import {
  PIPELINE_OUTCOME,
  type AutoReplyDecline,
  type PipelineOutcome,
} from "@ticket/shared";
import type { AutoReplyCase } from "@ticket/core";
import { autoReply, type AutoReplyResult } from "../ai/auto-reply";
import { gateDecline } from "../ai/auto-reply-gates";
import type { KbArticle } from "../ai/knowledge-base";
import { usdFor } from "../ai/provider";
import { isRetryable } from "../jobs/ai-retry";

/**
 * Answering one case five times, and deciding how often it landed where it said
 * it would.
 *
 * The measuring half of the eval harness; `../jobs/eval-run.ts` is the half
 * that stores the answer. Everything here is values in and values out: a
 * corpus, a case, a tally.
 *
 * **This is where PRD R12 is bought, and it is bought structurally.** A case is
 * handed to `autoReply` as a synthesized `AutoReplyContext` — three strings —
 * rather than posted through `ingest.ts`. `autoReply` takes its corpus as a
 * value and, in `jobs/auto-reply-ticket.ts`'s own words, "touches no database at
 * all", and `gateDecline` is a predicate over three fields. So there is no
 * ticket row for this module to avoid creating: the code path a run reaches
 * cannot create one. "An eval run creates and modifies nothing a customer or an
 * agent would see" is then a property of which functions the harness calls, not
 * a promise a reviewer has to keep checking.
 *
 * The cost of that entry point is stated in the PRD's risks and is worth
 * repeating where somebody is reading the code: **ingestion, threading and the
 * classify-to-auto-reply handoff are never exercised by a run.** The mitigation
 * is that `/pipeline` posts the *same* cases through the real path (`R1`,
 * `AUTO_REPLY_CASES` in `@ticket/core`), so a disagreement between the two
 * readers localises the fault to the half they do not share.
 *
 * ## Five repeats, and why nothing here varies between them
 *
 * A single answer from a model is not a measurement, which is why a case result
 * is a rate and never a pass (R3). The repeats are run **in series and from an
 * identical prompt** — same corpus array in the same order, same context, no run
 * id, timestamp or counter anywhere near the system prompt. That is not
 * tidiness. Prompt caching is the difference between the auto-reply costing what
 * it does and ten times that, it engages on an identical prefix and stops
 * silently when anything perturbs one (`ai-features.md` on `cached=`), and
 * repeats 2..5 of a case are the only place in this codebase where a stopped
 * cache is *observable*: `cachedRepeats` below counts them, and a run reporting
 * zero on a full set is that regression, showing up on a screen for the first
 * time.
 */

/** What one answer to one case was, and what it cost. */
export interface EvalVerdict {
  outcome: PipelineOutcome;
  /** The reason, when it declined or the provider failed. Null on a reply. */
  decline: AutoReplyDecline | null;
  /** Outcome and — when the case expected a decline — reason, both as written. */
  matched: boolean;
  /** Estimated USD for this one answer. Zero when no model call was made. */
  usd: number;
  /** Whether the provider reported serving part of this prompt from its cache. */
  cached: boolean;
}

/** What a case did over all of its repeats. */
export interface EvalCaseOutcome {
  /** Every repeat's verdict, in the order they were answered. */
  verdicts: EvalVerdict[];
  /** How many were asked for. Fixed per run, and stored so an old row says so. */
  repeats: number;
  /** How many of them landed where the case said. The numerator of the rate. */
  matches: number;
  /**
   * How many could not be answered at all.
   *
   * Reported rather than folded into the misses, because a provider outage is
   * not the model getting things wrong and a harness that cannot tell the two
   * apart is the "cries wolf, then gets ignored" failure the PRD exists to
   * prevent.
   */
  abandoned: number;
  /** Estimated USD across the repeats. */
  usd: number;
  /**
   * Repeats after the first that were served partly from the prompt cache.
   *
   * Out of `repeats - 1`, since the first repeat of a case is what warms it.
   */
  cachedRepeats: number;
}

/**
 * How many times each case is answered.
 *
 * Fixed in code rather than accepted on the request, and that is a decision
 * rather than an omission: a 3-repeat run and a 5-repeat run produce rates that
 * look like the same number and are not, and a stored run is only worth keeping
 * if it can be read against the ones before it. Five is small — the PRD says so
 * in its own risks, and the answer there is to read a move against the trend
 * rather than to make one run decisive.
 */
export const EVAL_REPEATS = 5;

/**
 * An `AutoReplyResult` as the rail reads it.
 *
 * Three outcomes rather than two, and the third is what keeps the numbers
 * honest. `provider`, `busy` and `empty` mean the model could not be asked —
 * the same split `../jobs/ai-retry` already draws for the retry ladder — so
 * they are `abandoned` rather than `declined`. Counting an outage as a case the
 * model got wrong is how a harness starts crying wolf, which the PRD names as
 * the exact failure it exists to prevent; and an `abandoned` repeat can never
 * match an expectation, so it is counted separately as well as excluded from
 * the matches.
 *
 * `unavailable` is still reported as the reason, because "the provider failed"
 * is the useful thing to see beside a repeat that went nowhere.
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

/** Did this land where the case said it would, reason and all. */
function matches(
  evalCase: AutoReplyCase,
  outcome: PipelineOutcome,
  decline: AutoReplyDecline | null,
): boolean {
  // A declined case has to reach the **expected reason**, not merely decline.
  // "Expected declined, got declined for a completely different reason" is the
  // finding this whole thing exists to surface: a payload thrown out for having
  // no citation is not the money check holding.
  return (
    outcome === evalCase.expected.outcome &&
    decline === evalCase.expected.decline
  );
}

/**
 * Answer one case once, against one corpus.
 *
 * `articles` is passed in rather than read here, so the caller decides which
 * corpus a run answered (R4) and this module stays free of the database
 * entirely — which is the property R12 rests on.
 *
 * The **gates come first, and they come first here for the same reason they come
 * first in the job**: a ticket a machine may not answer must not cost a model
 * call. Three of the nine decline reasons are decided by them and by nothing
 * else, so before the extraction they were unreachable from this seam and a case
 * set claiming to cover all nine would have been lying about three of them.
 */
export async function answerCase(
  articles: KbArticle[],
  evalCase: AutoReplyCase,
  signal?: AbortSignal,
): Promise<EvalVerdict> {
  const gated = gateDecline({
    category: evalCase.preflight.category,
    hasOutbound: evalCase.preflight.answered,
    // A case is one email. `hasInbound: false` is the state a ticket cannot
    // reach through ingestion and the only way the `noText` gate is observable
    // at all — see the note on `no-inbound-message` in the case set.
    inboundCount: evalCase.preflight.hasInbound ? 1 : 0,
  });

  if (gated !== null) {
    return {
      outcome: PIPELINE_OUTCOME.declined,
      decline: gated,
      matched: matches(evalCase, PIPELINE_OUTCOME.declined, gated),
      // Free, and honestly so: no provider was asked.
      usd: 0,
      cached: false,
    };
  }

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
    matched: matches(evalCase, outcome, decline),
    // Counted on every verdict, not only the answers. A reply thrown out by
    // check 5 cost exactly what one that was sent would have, and a run that
    // priced only its successes would understate itself by however often the
    // safety checks fired — which is most of the time, by design.
    usd: usdFor(result.usage),
    cached: (result.usage?.cachedInputTokens ?? 0) > 0,
  };
}

/**
 * Answer one case `repeats` times and tally what happened.
 *
 * **Serial, not parallel**, and that is two decisions in one. Concurrent calls
 * against one provider account would race the prompt cache — the first repeat is
 * what puts the corpus in it, and four requests leaving together would all miss
 * — and they would make a run's cost arrive in a burst rather than at the pace
 * an admin is watching it on a screen.
 *
 * Nothing between the repeats varies. See the header: that is what the cache
 * measurement rests on.
 */
export async function runCase(
  articles: KbArticle[],
  evalCase: AutoReplyCase,
  repeats: number = EVAL_REPEATS,
  signal?: AbortSignal,
): Promise<EvalCaseOutcome> {
  const verdicts: EvalVerdict[] = [];

  for (let repeat = 0; repeat < repeats; repeat += 1) {
    verdicts.push(await answerCase(articles, evalCase, signal));
  }

  return {
    verdicts,
    repeats,
    matches: verdicts.filter((v) => v.matched).length,
    abandoned: verdicts.filter((v) => v.outcome === PIPELINE_OUTCOME.abandoned)
      .length,
    usd: verdicts.reduce((total, v) => total + v.usd, 0),
    // The first repeat is what warms the cache, so it is never counted as a hit
    // — including it would make a cold run look 20% cached forever.
    cachedRepeats: verdicts.slice(1).filter((v) => v.cached).length,
  };
}
