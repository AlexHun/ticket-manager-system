import { AI_FAILURE, type AiFailure } from "../ai/provider";

/**
 * Which provider failures are worth another attempt.
 *
 * A `Record<AiFailure, boolean>` rather than a set or a list of cases, so that
 * adding a failure mode to `AI_FAILURE` is a compile error here until somebody
 * decides whether it is transient. Getting this wrong is expensive in both
 * directions: retrying a revoked key burns five calls to reach the same 401, and
 * giving up on a rate limit throws away a ticket over a hiccup.
 *
 * Shared by every AI job rather than declared per queue. The diagnosis is a
 * property of the *failure*, not of what was being generated — a 401 is a 401
 * whether it happened while classifying or while writing a reply — so one table
 * keeps the two from drifting apart, and keeps the compile error above
 * meaningful. A feature's own extra failure modes (`declined`, `ungrounded`,
 * `invented`) are not in here: they are judgements about an answer that arrived,
 * their handling belongs with the feature, and none of them is retryable.
 */
export const RETRYABLE_AI_FAILURE: Record<AiFailure, boolean> = {
  // The provider refused, or the network did. The whole reason the queue exists.
  [AI_FAILURE.provider]: true,
  // Rate-limited or overloaded. Clears on its own; that is what backoff is for.
  [AI_FAILURE.busy]: true,
  // A budget spent on reasoning, or an answer that was not the schema. Another
  // roll of the dice is a real remedy for both.
  [AI_FAILURE.empty]: true,
  // Out of credit. Does not refill on a timer, and five retries per ticket
  // across a morning's mail is a lot of calls to make into an empty account.
  [AI_FAILURE.quota]: false,
  // The key was rejected. It will be rejected identically in four minutes.
  [AI_FAILURE.auth]: false,
  // A bad model id or an unsupported parameter: a deployment bug that fails the
  // same way forever. Retrying it only delays the log line somebody needs to see.
  [AI_FAILURE.config]: false,
};

/**
 * Whether a failure — provider-level or feature-level — deserves a retry.
 *
 * Anything not in the table above is a feature's own verdict on an answer it
 * received, which never improves by asking again.
 */
export function isRetryable(reason: string): boolean {
  return RETRYABLE_AI_FAILURE[reason as AiFailure] === true;
}
