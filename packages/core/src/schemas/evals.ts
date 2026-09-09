import { z } from "zod";
import {
  AUTO_REPLY_DECLINE,
  EVAL_CORPUS,
  PIPELINE_OUTCOME,
  TICKET_CATEGORY,
} from "@ticket/shared";
import { caseEmailSchema } from "./pipeline";

/**
 * One case: an email, and where it is expected to land.
 *
 * The schema for the set in `../cases/auto-reply-cases`, which is read by two
 * completely different things — `/pipeline`, which posts a case through the
 * real ingestion path and watches one ticket descend the rail, and the eval
 * harness, which hands the same case straight to `autoReply` and records
 * whether the verdict was the expected one. **That is the whole point of it
 * living here** (PRD R1): two entry points, one set of expectations, so the two
 * can never disagree about where a case is supposed to end up, and a
 * disagreement between them localises the fault to the half neither shares.
 *
 * A zod schema rather than a bare `interface`, and the data is parsed against
 * it at module load, so a malformed case fails the build rather than a run —
 * see the note in `../cases/auto-reply-cases`.
 */
export const autoReplyCaseSchema = z.object({
  /** Stable, and what a stored result names. Never reused. */
  id: z.string().min(1),
  /** What to call it in the picker, and in a result row. */
  name: z.string().min(1),
  /** One line on why it goes where it goes. */
  note: z.string().min(1),
  /**
   * The state the ticket would be in when the auto-reply job picks it up.
   *
   * Three facts and no more, because they are exactly what `gateDecline` reads
   * (`apps/api/src/ai/auto-reply-gates.ts`). The auto-reply's three preflight
   * gates — `category`, `answered`, `noText` — are decided from these and never
   * by the model, so without them here the harness could not cover three of the
   * nine decline reasons at all: it hands a synthesized input straight to
   * `autoReply`, which those gates sit in front of.
   *
   * `/pipeline` does not read this. It posts the case through real ingestion and
   * lets the classifier and the thread decide, which is the point of having two
   * readers: `category` here is what the classifier is *expected* to say, so a
   * pipeline run that lands somewhere else has found the disagreement. (Slice 4
   * measures that expectation directly, as classifier accuracy.)
   *
   * Not every combination is something ingestion can produce — a ticket with no
   * inbound message is not, since a ticket is created *by* an inbound email — so
   * the cases that declare one are harness-only and `SIMULATABLE_CASES` leaves
   * them out of the simulator's picker rather than offering a scenario the page
   * cannot reproduce.
   */
  preflight: z.object({
    /** What the classifier is expected to have filed this under. Null means it failed. */
    category: z.enum(TICKET_CATEGORY).nullable(),
    /** Whether somebody has already replied — the corpus answers openings, not threads. */
    answered: z.boolean(),
    /** Whether the ticket carries an inbound message at all. */
    hasInbound: z.boolean(),
  }),
  /**
   * Where this should end up, if the corpus is what it was when this was
   * written.
   *
   * `decline` is required exactly when the outcome is `declined`, and refined
   * below rather than left to a comment: a declined case with no expected
   * reason would silently measure half of what it claims to, and "expected
   * declined, got declined for a completely different reason" is the finding
   * this harness exists to surface.
   */
  expected: z.object({
    outcome: z.enum(PIPELINE_OUTCOME),
    decline: z.enum(AUTO_REPLY_DECLINE).nullable(),
  }),
  /**
   * What a mismatch actually means for this case, when the generic reading
   * would be wrong.
   *
   * The default reading of "expected X, got Y" is "your knowledge base has
   * moved". For the adversarial payloads that is precisely backwards: a payload
   * that reaches `resolved` means the *model* declined to obey it that run,
   * which is a pass and not a finding.
   */
  mismatchNote: z.string().min(1).nullable(),
  /**
   * Marks the payloads, which the picker sets apart and which the harness
   * aggregates separately — the catch rate is its own metric, not a slice of
   * decline accuracy.
   */
  adversarial: z.boolean(),
  /**
   * Text from this case's payload that must never appear in an accepted reply.
   *
   * The one thing the harness could not otherwise see. Every check in
   * `ai/auto-reply.ts` fails **closed** — a caught payload is a discarded reply
   * — so from the outside a repeat where the model ignored the payload and a
   * repeat where the check that should have caught it has been weakened look
   * identical: both end in a reply. The difference is whether the payload is
   * *in* that reply, and that is a string comparison over the assembled text.
   *
   * So an adversarial repeat lands in one of three places, and only the first
   * two are on the catch rate (R9):
   *
   * - **caught** — declined by check 5 or check 6, which is the payload
   *   reaching a draft and an output check discarding it;
   * - **escaped** — a reply was accepted and one of these strings is in it.
   *   That is ADR-0004's claim failing, and it is the only number on that
   *   screen that is a bug rather than a measurement;
   * - neither — the model ignored the payload this run, so there was nothing to
   *   catch. On neither side of the rate, which is what makes it read the way
   *   the hand-measured 7-of-9 and 10-of-10 runs read: caught over *attempted*,
   *   never over repeats.
   *
   * Compared case-insensitively as a substring, so an entry has to be something
   * only the payload could have put there — a planted URL, an address, the sum
   * of money. Never a phrase the corpus itself uses, or every clean reply would
   * read as an escape and the metric would be inverted.
   *
   * Defaulted to empty rather than restated on all thirty non-adversarial
   * cases; the set-level refinement below is what keeps the pair honest, since
   * an adversarial case with nothing to look for would report a catch rate over
   * a payload it cannot detect — worse than not measuring it at all.
   */
  payloadMarkers: z.array(z.string().min(1)).default([]),
  /** The email itself, validated the same way the simulator validates one. */
  values: caseEmailSchema,
});

export type AutoReplyCase = z.infer<typeof autoReplyCaseSchema>;

/**
 * The whole set, with the two rules a single case cannot state about itself.
 *
 * Ids are unique because a stored result names a case by id and two cases
 * sharing one would make every historical row ambiguous; a `declined` case
 * carries a reason for the reason above.
 */
export const autoReplyCasesSchema = z
  .array(autoReplyCaseSchema)
  .min(1)
  .refine((cases) => new Set(cases.map((c) => c.id)).size === cases.length, {
    error: "Two cases share an id",
  })
  .refine(
    (cases) =>
      cases.every(
        (c) =>
          (c.expected.outcome === PIPELINE_OUTCOME.declined) ===
          (c.expected.decline !== null),
      ),
    {
      error:
        "A declined case needs an expected reason, and only a declined case may have one",
    },
  )
  .refine(
    (cases) =>
      cases.every((c) => c.adversarial === c.payloadMarkers.length > 0),
    {
      error:
        "An adversarial case needs at least one payload marker, and only an adversarial case may have one",
    },
  );

/**
 * The body of `POST /api/evals/runs`.
 *
 * Two knobs, and the count of repeats is deliberately not one of them. Five is
 * fixed in code (`EVAL_REPEATS`) because a configurable count makes runs
 * incomparable — a 3-repeat run and a 5-repeat run produce rates that look like
 * the same number and are not, and the whole value of storing a run is reading
 * it against the ones before it.
 *
 * - `corpus` decides which knowledge base answers (R4). Absent means frozen,
 *   which is the one whose trend line moves only when the code does.
 * - `caseIds` pins the run to a subset. It exists for the E2E suite, which must
 *   exercise the real runner without paying for the whole set on every push
 *   (R11), and for an admin re-running the one case that moved. Absent means
 *   every case.
 *
 * Ids are not checked against the case set here: a schema in `@ticket/core` that
 * imported the data would make every consumer of any schema in this package
 * carry it. The route resolves them and answers 400 for an id nothing names.
 */
export const startEvalRunSchema = z.object({
  corpus: z.enum(EVAL_CORPUS).optional(),
  caseIds: z.array(z.string().min(1)).min(1).optional(),
});

export type StartEvalRunValues = z.infer<typeof startEvalRunSchema>;
