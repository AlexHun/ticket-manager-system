/**
 * The one place a mail provider is spoken to.
 *
 * **This is the module Postmark plugs into, and it is meant to be the only
 * one.** Everything upstream — the auto-reply, an agent pressing Send, a
 * password reset — writes an `OutboundEmail` row and stops. This module turns
 * one of those rows into an HTTP call, and nothing else in the codebase knows a
 * provider exists. When Postmark is wired in, `deliver` below grows a body and
 * `isMailConfigured` reads a real key; no route, no job and no caller changes.
 *
 * Deliberately shaped like `ai/provider.ts`, because the problem is the same
 * one: an optional third-party integration whose absence has to be a supported
 * state rather than a crash. A deployment with no mail provider is the state
 * this app runs in today and must keep working in — see `MAIL_OUTCOME.unavailable`
 * and the `undeliverable` status it produces.
 *
 * What is deliberately *not* here: anything about tickets, threads, agents,
 * knowledge articles or auth. This module takes an addressed email and reports
 * what the provider said about it. The six safety checks that decide whether an
 * unattended reply may be composed at all live in `ai/auto-reply.ts` and must
 * never move here — by the time anything reaches this module the decision to
 * send has already been made, which is exactly the boundary
 * `docs/adr/0004-auto-reply-safety-rests-on-output-checks.md` draws.
 */

/**
 * Empty means this deployment has no mail provider, which is supported and is
 * currently the only state that exists.
 *
 * Read at import and checked per send, for the same reason `OPENAI_API_KEY` is:
 * no env file in this repo carries a mail credential, so throwing at import
 * would take down every `bun run dev`, every E2E run and CI, to protect a
 * feature nothing else depends on.
 */
const POSTMARK_SERVER_TOKEN = process.env.POSTMARK_SERVER_TOKEN ?? "";

/**
 * Whether this deployment can hand an email to anyone.
 *
 * False today, everywhere. The send worker asks before it tries, and marks the
 * row `undeliverable` rather than attempting and failing — the difference
 * between "there is nowhere to send this" and "sending it went wrong" is the
 * whole reason `OutboundEmailStatus` has both.
 */
export function isMailConfigured(): boolean {
  return POSTMARK_SERVER_TOKEN.length > 0;
}

/** An addressed email, with everything a provider needs and nothing else. */
export interface OutgoingEmail {
  toEmail: string;
  toName: string | null;
  subject: string;
  textBody: string;
  /**
   * RFC 5322 headers, stored and passed **without** angle brackets — the same
   * convention `ingest.ts` and `Message` use, because the customer's reply comes
   * back as `In-Reply-To: <this>` and `stripAngles` takes them off before
   * looking up the parent. A provider that wants brackets is the provider
   * adapter's problem, not the caller's.
   */
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
}

export const MAIL_OUTCOME = {
  /** The provider took it. It is theirs now; delivery is a later question. */
  accepted: "accepted",
  /**
   * The provider refused it and will refuse it again — a malformed address, a
   * suppressed recipient, a rejected sender signature. Retrying spends the
   * budget without changing the answer.
   */
  rejected: "rejected",
  /**
   * The attempt failed in a way that might not fail next time: a timeout, a 5xx,
   * a rate limit. This is the one worth retrying.
   */
  deferred: "deferred",
  /**
   * There is no provider configured, so nothing was attempted. Not a failure —
   * see `isMailConfigured`.
   */
  unavailable: "unavailable",
} as const;

export type MailOutcome = (typeof MAIL_OUTCOME)[keyof typeof MAIL_OUTCOME];

/**
 * Whether the send worker should throw and let pg-boss try again.
 *
 * A `Record` rather than a set or a switch, exactly as `RETRYABLE` is in
 * `jobs/classify-ticket.ts`: adding a fifth outcome is a compile error until
 * somebody says whether it is worth retrying. Getting this wrong in either
 * direction is expensive — a retried `rejected` burns the ladder on an answer
 * that cannot change, and a non-retried `deferred` silently drops a customer's
 * reply because the provider was busy for one second.
 */
export const RETRYABLE_OUTCOME: Record<MailOutcome, boolean> = {
  [MAIL_OUTCOME.accepted]: false,
  [MAIL_OUTCOME.rejected]: false,
  [MAIL_OUTCOME.deferred]: true,
  [MAIL_OUTCOME.unavailable]: false,
};

export type DeliveryResult =
  | {
      outcome: typeof MAIL_OUTCOME.accepted;
      /** The provider's own id, for the day somebody has to ask them about it. */
      providerMessageId: string | null;
    }
  | {
      outcome:
        | typeof MAIL_OUTCOME.rejected
        | typeof MAIL_OUTCOME.deferred
        | typeof MAIL_OUTCOME.unavailable;
      /** Prose for an admin reading the outbox. Nothing branches on it. */
      error: string;
    };

/**
 * Hand one email to the provider.
 *
 * **The Postmark implementation goes here and nowhere else.** It needs, in this
 * order: a POST to `/email` with `X-Postmark-Server-Token`, the headers above
 * re-wrapped in angle brackets, and Postmark's `ErrorCode` mapped onto
 * `MAIL_OUTCOME` — their `406` (inactive recipient) and `300` (invalid email)
 * are `rejected`, a `5xx` or a network error is `deferred`. Until then this
 * reports the honest thing, and the worker never calls it.
 */
export async function deliver(email: OutgoingEmail): Promise<DeliveryResult> {
  if (!isMailConfigured()) {
    return {
      outcome: MAIL_OUTCOME.unavailable,
      error: "No mail provider configured (POSTMARK_SERVER_TOKEN is unset)",
    };
  }

  // Unreachable today: `isMailConfigured()` is false on every deployment, and
  // the worker checks it before calling. Left as a throw rather than a stub that
  // returns `accepted`, because a stub that claims success is how an email
  // nobody sent gets recorded as sent.
  throw new Error(
    `Mail transport not implemented: POSTMARK_SERVER_TOKEN is set but deliver() has no provider bound (to ${email.toEmail})`,
  );
}
