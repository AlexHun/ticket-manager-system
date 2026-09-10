import {
  asAutoReplyDecline,
  asTicketCategory,
  PIPELINE_OUTCOME,
  type PipelineOutcome,
} from "@ticket/shared";
import type { EvalVerdict } from "./runner";

/**
 * The stored half of a repeat's verdict: projected on the way into the column,
 * parsed on the way back out.
 *
 * `EvalCaseResult.verdicts` is `Json`, and a `Json` column carries no shape
 * promise — not from Postgres, and not from the build that wrote the row. Both
 * halves of that were told at three separate sites before this module existed:
 * `../jobs/eval-run.ts` hand-listed six of `EvalVerdict`'s nine fields into the
 * column, and two hundred lines away `../routes/evals.ts` narrowed the same
 * fields back out of `unknown` through a generic tally helper, an
 * enum-narrowing fallback and a pair of inline casts — never importing the type
 * the writer had used. Nothing connected the two but the reviewer's memory.
 *
 * **The defensive reading is not paranoia and none of it is deleted here** —
 * it is moved. Rows written by older builds genuinely are shapes this code did
 * not write: a run from before slice 4 carries no `category` on any repeat, and
 * a run from before slice 3 carries no `caught`. The story that has to be told
 * about those rows is one story, and it is now told once, next to the
 * projection that says what a current row looks like.
 *
 * What that buys, beyond locality: dropping a field from `storedVerdict` is now
 * a compile error rather than a key that silently stops appearing on the read
 * side, and a read-model question — "what does a pre-slice-4 row read as?" —
 * is a value handed to a function rather than a row inserted into a database
 * and fetched back through a route.
 */

/**
 * What a repeat leaves behind on the row.
 *
 * A `Pick` over the runner's own verdict rather than six restated fields, so a
 * field renamed in `EvalVerdict` fails here rather than resolving to a key
 * nothing writes any more. It is the same discipline `MetricCounts` keeps over
 * `EvalRunCounters` one module along, applied to the other end of the write.
 *
 * Six of the verdict's nine fields, and the three that are missing are missing
 * on purpose. `usd` and `cached` are summed into columns of their own —
 * `EVAL_COUNTERS` is where that is argued — and `classifyMatched` is derivable
 * from `category` and the row's own `expectedCategory`, which is what
 * `filedFrom` does with it. What is here is what a **per-repeat** breakdown
 * needs and a per-case total cannot say: which of five went somewhere else, and
 * which check was the one that held.
 */
export type StoredVerdict = Pick<
  EvalVerdict,
  "outcome" | "decline" | "matched" | "caught" | "escaped" | "category"
>;

/**
 * A stored outcome string, narrowed to one this build has wording for.
 *
 * The mirror of `asAutoReplyDecline` and `asTicketCategory` for the third of
 * the three enums a stored eval row carries as text (see the note on
 * `EvalCaseResult`): the type on the wire is a promise this code keeps rather
 * than one Postgres keeps for it.
 *
 * `notOffered` is the fallback rather than null, because an outcome is not
 * nullable on the wire and "nothing is scheduled and nothing happened" is the
 * honest reading of a value this build cannot name — the same choice
 * `/pipeline` makes for its one known blind spot.
 *
 * It lives here rather than in the read model because the stored `verdicts`
 * array is the shape that needs it most, and one home is what
 * [#215](https://github.com/AlexHun/ticket-manager-system/issues/215) is meant
 * to grill: three modules derive a Stage from three different kinds of
 * evidence, and this is the only one of the three that falls back to a default.
 * The read model still calls it for the `expectedOutcome` column, which is the
 * same question asked of the same table.
 */
export function asPipelineOutcome(value: unknown): PipelineOutcome {
  return (
    Object.values(PIPELINE_OUTCOME).find((outcome) => outcome === value) ??
    PIPELINE_OUTCOME.notOffered
  );
}

/**
 * One repeat's verdict, as the column holds it.
 *
 * Written out field by field rather than handed the verdict whole, and the
 * explicitness is the feature twice over. `Pick` would accept `return verdict`
 * — excess properties survive an assignment from a variable — and the row would
 * quietly grow the `usd` and `cached` that already have columns of their own.
 * And a field deleted from this literal is a type error here, where somebody is
 * looking at the shape, rather than a key that stops being written and is
 * noticed a release later as a breakdown that has gone empty.
 */
export function storedVerdict(verdict: EvalVerdict): StoredVerdict {
  return {
    outcome: verdict.outcome,
    decline: verdict.decline,
    matched: verdict.matched,
    // Per repeat, not only as a total, because the per-check breakdown (R9) is
    // read out of this array: `caught` says a check held and `decline` beside
    // it says *which* one, which is the distinction the 7-of-9 and 10-of-10
    // measurements already drew.
    caught: verdict.caught,
    escaped: verdict.escaped,
    // Per repeat for the same reason `caught` is: the run's totals say four of
    // five were filed as expected, and only the array can say where the fifth
    // one went — which is the whole of the per-category breakdown (R15).
    category: verdict.category,
  };
}

/** Whether an array entry is something a field can be read off at all. */
function isRecord(entry: unknown): entry is Record<string, unknown> {
  return typeof entry === "object" && entry !== null && !Array.isArray(entry);
}

/**
 * The column, read back as repeats this build can say something about.
 *
 * Every field is narrowed and every fallback is chosen so that an unreadable
 * value is an **absence rather than a measurement**, which is the only reading
 * a screen whose whole job is saying what happened can afford:
 *
 * - A missing or unrecognised `category` reads as not-classified — null, the
 *   same value a repeat the classifier could not answer produces. That is what
 *   every row written before slice 4 carries, and it must never read as a
 *   filing that went wrong or as a zero on the classifier's rate.
 * - A missing `caught` or `escaped` reads false, so a row from before the catch
 *   rate existed contributes to neither side of it.
 * - A `decline` this build has no wording for reads null, because rendering a
 *   raw column at an admin is worse than saying nothing.
 * - An unrecognised `outcome` reads `notOffered`; see `asPipelineOutcome`.
 *
 * Anything that is not an array of objects yields no repeats at all. The column
 * is non-null and every build has written an array into it, so that covers a
 * hand-edited row and a future shape rather than anything in the history — but
 * a page that 500s on one row it cannot parse is a page that stops being able
 * to report the thirty rows it can.
 */
export function parseStoredVerdicts(value: unknown): StoredVerdict[] {
  if (!Array.isArray(value)) return [];

  return value.filter(isRecord).map((entry) => ({
    outcome: asPipelineOutcome(entry.outcome),
    decline: asAutoReplyDecline(
      typeof entry.decline === "string" ? entry.decline : null,
    ),
    matched: entry.matched === true,
    caught: entry.caught === true,
    escaped: entry.escaped === true,
    category: asTicketCategory(entry.category),
  }));
}
