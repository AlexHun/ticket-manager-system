import type { TicketCategory } from "@ticket/shared";
import type { AutoReplyCase } from "@ticket/core";
import { classifyTicket, type ClassifyResult } from "../ai/classify";
import { usdFor } from "../ai/provider";

/**
 * Asking the classifier where a case belongs, so the answer can be scored.
 *
 * The third metric (PRD R15), and the one measurement in this harness that is
 * not about the auto-reply at all. A case already declares which of the four
 * categories it is expected to be filed under — `preflight.category`, which the
 * gates read as though the classifier had already run — so the expectation is
 * written down and the only thing missing was ever asking.
 *
 * ## Why this is a module of its own
 *
 * Two reasons, and the second is the one that would be annoying to rediscover.
 *
 * It holds a rule with real content: **which cases can honestly be scored**,
 * below. That is a judgement about the case set, not plumbing, and it belongs
 * somewhere it can be read and argued with.
 *
 * And it gives `runner.test.ts` a seam of its own. `../ai/classify` is already
 * mocked by `jobs/activity-before-publish.test.ts`, with a stub that answers
 * `Technical` and nothing else; the runner's tests need to script a sequence of
 * answers, and `mock.module`'s registry is one process wide, so two factories
 * on that specifier means one of the two files is running against the other's
 * stub (`testing.md`). The narrow-seam answer is a specifier neither file has
 * to know about, which is this one — the same move `isPolishConfigured()` makes
 * for `../ai/provider`.
 */

/** What one case's classification cost and came to. */
export interface ClassifyCaseResult {
  /**
   * The category the classifier filed this under, or null when it could not be
   * asked or could not answer.
   *
   * Null is **not** a miss. See `categoryOf`.
   */
  category: TicketCategory | null;
  /** Estimated USD for the call. Zero when none was made. */
  usd: number;
}

/**
 * Whether the classifier can be scored against this case at all.
 *
 * Two exclusions, both because there is no right answer rather than because the
 * call would be inconvenient:
 *
 * - **`category: null`** is the `unclassified` case, whose whole expectation is
 *   that classification *failed*. Nothing the classifier could say would be
 *   right, and scoring it would mean asking the model to reproduce an outage.
 * - **`hasInbound: false`** is the `no-inbound-message` case, which carries a
 *   placeholder body precisely because nothing reads it. There is no email to
 *   classify, and on the real path there is no ticket either — classification
 *   runs off an inbound email arriving.
 *
 * Everything else is in, **including the three gated cases that are left**
 * (`refund`, `double-charge`, `already-answered` — the other two gated cases
 * are the two exclusions above). That is the deliberate half: the category gate
 * is the only thing standing between a refund request and an unattended reply,
 * and what it reads is the classifier's answer. A harness that skipped
 * classification wherever the gate was going to fire would be measuring the
 * classifier exactly where its answer does not matter, and skipping it where
 * it does.
 *
 * It costs a call per repeat on those three, which used to be free — see the
 * note in `./runner.ts` on what a gated case now spends.
 */
export function isClassifiable(evalCase: AutoReplyCase): boolean {
  return evalCase.preflight.category !== null && evalCase.preflight.hasInbound;
}

/**
 * The category a result names, or null when there is none.
 *
 * Null covers every way the call did not produce an answer — the provider was
 * unreachable, the key is wrong, the model spent its budget reasoning — and it
 * is counted as the **denominator shrinking**, never as a miss. That is the
 * same split the auto-reply half already draws between `abandoned` and
 * `declined`, for the same reason: an outage is not the model getting things
 * wrong, and a metric that cannot tell them apart is one nobody trusts twice.
 *
 * The end of that thread is `EvalMetricRow.value`, which is null on a zero
 * denominator: a run where the classifier answered nothing reports no
 * classifier accuracy rather than a catastrophic zero.
 */
export function categoryOf(result: ClassifyResult): TicketCategory | null {
  return result.ok ? result.category : null;
}

/**
 * Classify one case's email, priced.
 *
 * The context is built from the case's own values exactly as
 * `jobs/classify-ticket.ts` builds it from the ticket — subject and the first
 * inbound message's plain text, and nothing else. `htmlBody` is not in it and
 * never will be: ADR-0008's "never render email HTML" rule reaches into
 * prompts.
 *
 * A case this cannot honestly score makes no call and costs nothing.
 */
export async function classifyCase(
  evalCase: AutoReplyCase,
  signal?: AbortSignal,
): Promise<ClassifyCaseResult> {
  if (!isClassifiable(evalCase)) return { category: null, usd: 0 };

  const result = await classifyTicket(
    {
      subject: evalCase.values.subject,
      // `|| null` rather than `?? null`, the same reading `answerCase` and
      // `jobs/classify-ticket.ts` take: an empty body and an absent one are the
      // same thing to a prompt, and both have a branch written for them.
      text: evalCase.values.textBody.trim() || null,
    },
    signal,
  );

  return { category: categoryOf(result), usd: usdFor(result.usage) };
}
