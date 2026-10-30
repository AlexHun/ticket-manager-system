import type { EvalCorpus } from "./evals.ts";

/**
 * The standing arrangement that opens a run unattended (#236).
 *
 * One row, never more: a schedule is a property of the deployment, not a list
 * an admin curates. It is seeded with the time the nightly sweep was hard-coded
 * to before this existed, so the arrangement in force did not change on the
 * deploy that made it editable.
 *
 * **Frozen corpus only, and that is not a field.** An unattended trend line has
 * to be attributable: a live-corpus run moves when an admin edits an article,
 * which is a fine thing to ask for on purpose (a planned run may name either
 * corpus) and a terrible thing to receive unasked. So there is no `corpus` here
 * to get wrong — see `GLOSSARY.md`'s **Schedule**.
 *
 * The time is an hour and a minute rather than a cron expression, on both
 * sides. A cron string an admin could type is five fields of which four have
 * exactly one legal value here, and the fifth is the every-few-hours run the
 * PRD priced out. What is offered is what can be honoured.
 */
export interface EvalScheduleRow {
  /** Local hour of the run, 0–23. */
  hour: number;
  /** Minute past the hour, 0–59. */
  minute: number;
  /**
   * Paused keeps the time. There is no delete: an arrangement that is off is
   * still the arrangement, and an admin turning it back on should not have to
   * remember what it used to say.
   */
  paused: boolean;
  /** When the schedule was last retimed, paused or resumed. */
  updatedAt: string;
  /**
   * Who did it, denormalised the way `KnowledgeArticleRevision.editorName` is —
   * the panel says who last changed the schedule, and it has to keep saying so
   * after that colleague's account is gone. Null only for the seeded row, which
   * nobody changed.
   */
  updatedByName: string | null;
}

/**
 * Where a planned run got to.
 *
 * A planned run is **not** a run (`docs/adr/0021`), so it does not borrow
 * `EVAL_RUN_STATUS`: it has measured nothing, and the words that fit it are
 * about whether it happened rather than about how it went.
 *
 * - `planned` — asked for, not yet fired. The only cancellable state.
 * - `cancelled` — an admin cancelled it; it never becomes a run. Re-timing is
 *   cancel-and-plan-again, so this is also what the first half of a re-time
 *   leaves behind.
 * - `fired` — its time came and it opened a run. `runId` names it.
 * - `missed` — its time passed while nothing was there to fire it, by more than
 *   the grace window. It started nothing and spent nothing.
 */
export const EVAL_PLANNED_RUN_STATUS = {
  planned: "planned",
  cancelled: "cancelled",
  fired: "fired",
  missed: "missed",
} as const;

export type EvalPlannedRunStatus =
  (typeof EVAL_PLANNED_RUN_STATUS)[keyof typeof EVAL_PLANNED_RUN_STATUS];

/**
 * How late a planned run may still fire.
 *
 * Fifteen minutes, and the ceiling is the point rather than the number. A job
 * deferred to 14:00 that the queue only delivers at 19:00 — the app was down,
 * a deploy overran — would charge for a full set at a moment nobody chose and
 * stamp a trend point whose date means nothing. Beyond the window the plan is
 * marked `missed`, which spends nothing and says so.
 *
 * Long enough to absorb an ordinary restart or a deploy; short enough that a
 * run which fires inside it is still recognisably the run somebody asked for.
 */
export const EVAL_PLANNED_RUN_GRACE_MINUTES = 15;

/** One planned run, as the panel reads it. */
export interface EvalPlannedRunRow {
  id: number;
  /**
   * Either corpus, unlike the schedule. The objection to an unattended live run
   * is about a red result appearing in a trend nobody chose to start; a named
   * person picking Live for a specific afternoon has chosen it.
   */
  corpus: EvalCorpus;
  /** When it is due, as an ISO string. */
  runAt: string;
  status: EvalPlannedRunStatus;
  /** Who asked for it, denormalised for the reason `updatedByName` is. */
  plannedByName: string | null;
  /** The run it opened, once it has fired. Null in every other state. */
  runId: number | null;
}

/**
 * How many planned runs `GET /api/evals/schedule` carries.
 *
 * A cap rather than a limit on how many may be planned: there is deliberately
 * no guard against planning a run close to another (the worker takes one at a
 * time, so a second waits its turn), so the list is bounded on the way out
 * instead of the way in.
 */
export const EVAL_PLANNED_RUN_LIMIT = 20;

/**
 * How far ahead a run may be planned.
 *
 * A week, and the ceiling is the queue rather than a product opinion: a
 * deferred job sits in pg-boss in the `created` state, and a queue deletes a
 * created job after its `retentionSeconds` — **14 days by default**, which is
 * what this deployment runs. A plan three weeks out would have its job quietly
 * swept away and would then sit `planned` forever with nothing coming for it.
 *
 * Half the retention rather than all of it, so the margin absorbs a queue
 * setting somebody lowers later without turning a plan into a row that never
 * fires and never says why.
 */
export const EVAL_PLAN_HORIZON_DAYS = 7;

/**
 * `GET /api/evals/schedule`: the standing arrangement, and what is coming.
 *
 * The two halves are different things on purpose and are never merged into one
 * list — a schedule fires forever and a planned run fires once. Neither is
 * drawn as a run: `runs` on the page above means measurements that happened.
 */
export interface EvalScheduleResponse {
  /**
   * Whether this deployment can run an eval at all, the same presence boolean
   * `EvalRunsResponse` carries. A schedule on a keyless deployment would fire
   * into a queue with no worker registered on it.
   */
  evalConfigured: boolean;
  schedule: EvalScheduleRow;
  /**
   * What is coming, soonest first — and the recently missed, which is the only
   * way an admin learns that a plan did not happen. Cancelled and fired plans
   * are not here: one is a decision already taken and the other is a run, which
   * the list above draws.
   */
  plannedRuns: EvalPlannedRunRow[];
}

/**
 * How long a `missed` plan stays in the list above.
 *
 * A day, because the news it carries is "the run you expected this morning did
 * not happen" and that is worth a morning. After it, the row is history and the
 * page is about what is coming.
 */
export const EVAL_MISSED_PLAN_WINDOW_HOURS = 24;
