import { z } from "zod";
import { AUTO_REPLY_DECLINE, PIPELINE_OUTCOME } from "@ticket/shared";
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
  );

/**
 * The body of `POST /api/evals/runs`.
 *
 * Slice 1 answers **one** case, once, against the frozen corpus, so a request
 * says which case and nothing else. The corpus choice (R4) and the repeat count
 * (R3) arrive in slice 2; they are absent here rather than accepted and
 * ignored, so a caller cannot believe it asked for something it did not get.
 *
 * The id is not checked against the case set here: a schema in `@ticket/core`
 * that imported the data would make every consumer of any schema in this
 * package carry it. The route resolves it and answers 400 for an id nothing
 * names.
 */
export const startEvalRunSchema = z.object({
  caseId: z.string().min(1).optional(),
});

export type StartEvalRunValues = z.infer<typeof startEvalRunSchema>;
