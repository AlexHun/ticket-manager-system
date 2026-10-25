/**
 * Why the knowledge-base auto-reply left a ticket for a person.
 *
 * Declining is the designed, common outcome — most support mail is not a
 * knowledge-base question, and six checks fail closed on the rest. Until this
 * existed none of that reached anyone: a declined ticket and a ticket the
 * machine never looked at were the same `Open` row, so an agent could not learn
 * the system's edges and an admin could not tell a working knowledge base from
 * a broken one. The reason was written to a log line and nowhere else.
 *
 * Deliberately finer than `AutoReplyFailure` in the API, which drives *retries*
 * and must stay coarse — four different checks all mean "do not try again" to
 * pg-boss and four different things to a person reading the ticket. The two
 * travel together and neither replaces the other.
 *
 * The ordering below is the order they occur in: four gates before the model is
 * called, then its own verdict, then the checks over what it wrote.
 */
export const AUTO_REPLY_DECLINE = {
  /** Refund, or still unclassified. A machine may not answer either. */
  category: "category",
  /** Somebody had already replied — the corpus answers openings, not threads. */
  answered: "answered",
  /** The opening email had no plain text to read. */
  noText: "noText",
  /**
   * The customer wrote again before anything answered, so the machine would be
   * replying to the older of two unread emails and resolving the ticket on top
   * of the newer one. Same principle as `answered` from the other side: nobody
   * has replied, but this is no longer an opening.
   */
  followUp: "followUp",
  /** It read the corpus and said this is not covered. The common one. */
  notCovered: "notCovered",
  /** It answered, but cited nothing that resolves against the corpus. */
  noCitation: "noCitation",
  /** The reply promised money its cited articles do not mention. */
  unbackedCommitment: "unbackedCommitment",
  /** The reply carried a link or address its cited articles do not contain. */
  unbackedReference: "unbackedReference",
  /** Longer than a knowledge-base answer has any business being. */
  tooLong: "tooLong",
  /** The provider failed, or the retry ladder ran out. Not a judgement. */
  unavailable: "unavailable",
} as const;

export type AutoReplyDecline =
  (typeof AUTO_REPLY_DECLINE)[keyof typeof AUTO_REPLY_DECLINE];

/**
 * A stored decline reason, narrowed to one the client has wording for.
 *
 * `Ticket.autoReplyDecline` is a plain `text` column (see the note on the model
 * for why), so the type on the wire is a promise the API has to keep rather than
 * one Postgres keeps for it. Anything unrecognised becomes null: a reason the UI
 * cannot name is not better than silence, and the alternative is rendering a raw
 * database string at an agent.
 *
 * Here rather than in a route because two routes now need it — the ticket detail
 * and the pipeline — and a narrowing that exists twice is a narrowing that will
 * eventually disagree with itself.
 */
export function asAutoReplyDecline(
  value: string | null,
): AutoReplyDecline | null {
  if (value === null) return null;
  return Object.values(AUTO_REPLY_DECLINE).find((d) => d === value) ?? null;
}

/**
 * Render order for the declines within a stage, and the whole list elsewhere.
 *
 * `Object.keys` on the record above would order by insertion, which happens to
 * be right today and would silently stop being right the moment somebody sorted
 * the object. This is the list the rail iterates.
 */
export const AUTO_REPLY_DECLINES = [
  AUTO_REPLY_DECLINE.category,
  AUTO_REPLY_DECLINE.answered,
  AUTO_REPLY_DECLINE.noText,
  AUTO_REPLY_DECLINE.followUp,
  AUTO_REPLY_DECLINE.notCovered,
  AUTO_REPLY_DECLINE.unavailable,
  AUTO_REPLY_DECLINE.noCitation,
  AUTO_REPLY_DECLINE.unbackedCommitment,
  AUTO_REPLY_DECLINE.unbackedReference,
  AUTO_REPLY_DECLINE.tooLong,
] as const;

/**
 * The two checks that read a finished reply and threw it away.
 *
 * Checks 5 and 6 in `ai/auto-reply.ts` — `unbackedCommitments` and
 * `unbackedReferences` — and the reason they are a named pair rather than two
 * strings the eval harness happens to test for: they are the ones that were
 * *measured*, and the ones the whole unattended path rests on. The planted
 * money sentence reached the finished reply in 7 of 9 runs and the planted link
 * in 10 of 10; every one was caught here, and nowhere else. `security.md` puts
 * it plainly — every prompt rule above them is advisory and these two string
 * comparisons are the feature.
 *
 * Named apart from the other seven because only these two mean *a payload got
 * into a draft and was stopped*. `noCitation` and `tooLong` also fail closed,
 * and `notCovered` is the model declining to write anything at all — none of
 * them read a payload, so none of them belongs in a catch rate (PRD R9).
 *
 * Adding a seventh check to `auto-reply.ts` means adding it here too, or the
 * catch rate quietly stops counting what it catches.
 */
export const OUTPUT_CHECK_DECLINES = [
  AUTO_REPLY_DECLINE.unbackedCommitment,
  AUTO_REPLY_DECLINE.unbackedReference,
] as const;

/**
 * A decline that came from reading the finished reply.
 *
 * Narrower than `AutoReplyDecline` on purpose: a case's `payloadChecks` and the
 * per-check breakdown are both about these two and only these two, and a type
 * that admitted `noText` would let a gate reason into a safety number.
 */
export type OutputCheckDecline = (typeof OUTPUT_CHECK_DECLINES)[number];

/**
 * Whether a decline is one of the two output checks that read the reply.
 *
 * A type predicate rather than a bare boolean, so a caller that has asked the
 * question gets to keep the answer — `payloadChecks.includes(decline)` after
 * this guard is a type error without it, which is exactly the mistake worth
 * making impossible.
 */
export function isOutputCheckDecline(
  decline: AutoReplyDecline | null,
): decline is OutputCheckDecline {
  return OUTPUT_CHECK_DECLINES.some((check) => check === decline);
}
