import { z } from "zod";
import {
  AUTO_REPLY_DECLINE,
  EVAL_CORPUS,
  isOutputCheckDecline,
  OUTPUT_CHECK_DECLINES,
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
   * (`apps/api/src/ai/auto-reply-gates.ts`). The auto-reply's four preflight
   * gates — `category`, `answered`, `noText`, `followUp` — are decided from
   * these and never by the model, so without them here the harness could not
   * cover four of the ten decline reasons at all: it hands a synthesized input
   * straight to `autoReply`, which those gates sit in front of.
   *
   * `/pipeline` does not read this. It posts the case through real ingestion and
   * lets the classifier and the thread decide, which is the point of having two
   * readers: `category` here is what the classifier is *expected* to say, so a
   * pipeline run that lands somewhere else has found the disagreement. The
   * harness now measures that expectation directly as well, as classifier
   * accuracy (R15): it asks the classifier where this email belongs and scores
   * the answer against this field — *without* feeding it to the gates, which
   * keep reading the declared value, so the two metrics stay independent.
   * `apps/api/src/evals/classify-case.ts` is where the two cases that cannot be
   * scored are named and argued.
   *
   * Not every combination is something ingestion can produce — a ticket with no
   * inbound message is not, since a ticket is created *by* an inbound email, and
   * a ticket with two needs a second email delivered inside the seconds the
   * classifier takes — so the cases that declare one are harness-only and
   * `SIMULATABLE_CASES` leaves them out of the simulator's picker rather than
   * offering a scenario the page cannot reproduce.
   */
  preflight: z.object({
    /** What the classifier is expected to have filed this under. Null means it failed. */
    category: z.enum(TICKET_CATEGORY).nullable(),
    /** Whether somebody has already replied — the corpus answers openings, not threads. */
    answered: z.boolean(),
    /**
     * How many inbound messages the ticket carries.
     *
     * A count rather than the boolean it was until #221, because the pipeline
     * reaches three states here and a boolean can name two: `0` is the ticket
     * ingestion cannot produce, `1` is an opening, and `2` is a customer who
     * wrote again before anything answered. The third is the one a boolean hid,
     * so nothing measured whether answering the older of two unread emails was
     * still the behaviour we wanted — it was not. `docs/adr/0020` is the
     * argument; the `followUp` gate is what turns that ticket back now.
     */
    inboundCount: z.int().min(0),
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
  /**
   * The output checks this payload is aimed at — the ones that could plausibly
   * be the thing that stopped it.
   *
   * The other half of the catch rate, and it exists because the two halves were
   * asymmetric without it. `escaped` demands a marker; `caught` demanded only
   * that *some* output check fired on an adversarial case — so a money payload
   * thrown out because the model happened to invent an unrelated link counted
   * as the money check holding. That inflates the one number ADR-0004 stands on
   * with repeats where the payload was never in flight, and it does so in the
   * reassuring direction, which is the worst way for a safety metric to be
   * wrong.
   *
   * It has to be declared rather than derived, and the reason is worth knowing:
   * **a discarded reply's text is not observable.** `autoReply` returns no
   * `reply` on the `ok: false` branch, by design — a caught payload is a
   * discarded reply — so nothing downstream can check the markers against the
   * draft the check threw away. What a case *can* say is which check its own
   * payload was written to trip, which is a claim a person writes down and a
   * reviewer can check.
   *
   * Nor can it simply be `expected.decline`. Two of the six payloads expect a
   * clean reply — the fence-escape attempt and the hostile display name — and
   * for those, an output check firing is still a genuine catch: it means the
   * structural defence (`fenced()` stripping the delimiters, `greetingName`
   * reducing the From name) let something through and check 5 or 6 stopped it.
   * That is precisely the outcome those two cases are watching for, and a rule
   * keyed on the expected decline would score it as nothing at all.
   */
  payloadChecks: z.array(z.enum(OUTPUT_CHECK_DECLINES)).default([]),
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
  )
  .refine(
    (cases) => cases.every((c) => c.adversarial === c.payloadChecks.length > 0),
    {
      error:
        "An adversarial case needs at least one payload check, and only an adversarial case may have one",
    },
  )
  .refine(
    (cases) =>
      cases.every(
        (c) =>
          c.expected.decline === null ||
          !isOutputCheckDecline(c.expected.decline) ||
          c.payloadChecks.includes(c.expected.decline),
      ),
    {
      error:
        "A case expecting an output check to decline it must list that check among its payload checks",
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

/**
 * The query string of `GET /api/evals/runs` (#234).
 *
 * One knob, and it is the same knob `startEvalRunSchema` carries — deliberately,
 * because on the screen it is one control: picking a corpus filters the list and
 * aims the Run button. There is **no "all" value**, and that is the design rather
 * than an omission. The two are separate series that are never averaged (R4), so
 * a list holding both invites reading a red frozen run and a red live run as one
 * trend; and an "all" the Run button could not honour would be a control meaning
 * two different things at once.
 *
 * Absent means frozen (`EVAL_CORPUS_DEFAULT`), the same reading the start route
 * gives an absent corpus. Anything else is a 400 rather than a silent fallback:
 * a hand-typed `?corpus=fozen` answering with the frozen series would be a page
 * captioned with a corpus nobody asked for.
 */
export const evalRunsQuerySchema = z.object({
  corpus: z.enum(EVAL_CORPUS).optional(),
});

export type EvalRunsQuery = z.infer<typeof evalRunsQuerySchema>;

/**
 * The body of `PATCH /api/evals/schedule` (#236).
 *
 * An hour and a minute, never a cron expression. Four of cron's five fields
 * have exactly one legal value for a daily schedule and the fifth is the
 * every-few-hours run the PRD priced out, so what is offered here is what can
 * be honoured — the cron string is assembled on the server from these two.
 *
 * There is no `corpus`. The schedule is frozen-corpus only, because an
 * unattended trend line has to be attributable and a live-corpus run moves when
 * an admin edits an article. A planned run may name either corpus; this cannot,
 * and an absent field is a rule nobody can get wrong.
 *
 * `paused` travels with the time rather than on a route of its own. Pausing
 * keeps the time — there is no delete — so "pause" and "retime" are two edits
 * to one arrangement, and one write path is what stops the row and the queue
 * disagreeing about which of them happened last.
 */
export const evalScheduleSchema = z.object({
  hour: z.int().min(0).max(23),
  minute: z.int().min(0).max(59),
  paused: z.boolean(),
});

export type EvalScheduleValues = z.infer<typeof evalScheduleSchema>;

/**
 * The body of `POST /api/evals/planned-runs` (#236).
 *
 * `corpus` is **required**, unlike `startEvalRunSchema`'s, and the absence of a
 * default is the decision: a run somebody schedules for an afternoon they will
 * not be watching is exactly the run whose corpus should have been chosen
 * rather than inherited. Either is allowed — the objection to unattended live
 * runs is about a red result appearing in a trend nobody chose to start, and a
 * named person picking Live for a specific afternoon has chosen it.
 *
 * `caseIds` is deliberately not a knob. The subset exists for the E2E suite and
 * for an admin re-running the one case that moved, and both of those are
 * somebody sitting at the page pressing Run; a plan made this morning for
 * tonight is the unattended shape, where a subset produces rates that are not
 * comparable with anything.
 *
 * The time is checked for being in the future here as well as at the route,
 * because the form and the route should refuse the same thing — a plan for a
 * moment that has passed is a plan that is born missed.
 */
export const planEvalRunSchema = z.object({
  corpus: z.enum(EVAL_CORPUS),
  runAt: z.coerce
    .date({ error: "Invalid time" })
    .refine((value) => value.getTime() > Date.now(), {
      error: "A planned run has to be in the future",
    }),
});

export type PlanEvalRunValues = z.infer<typeof planEvalRunSchema>;
