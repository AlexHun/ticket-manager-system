import { EVAL_NIGHTLY_SWEEP } from "../jobs/eval-nightly";
import { applySweepSchedule, getBoss } from "../jobs/boss";
import { evalScheduleCron, type EvalScheduleTime } from "./schedule";

/**
 * Tell the queue what the schedule now says (#236).
 *
 * One line of work, and a module of its own for a measured reason rather than a
 * stylistic one — the same reason `isEvalConfigured()` is its own leaf
 * (`docs/adr/0016`, testing-api.md). A route that imported `../jobs/boss`
 * directly would force `routes/eval-schedule.test.ts` onto the `./boss`
 * specifier, which `jobs/sweeps.test.ts` already owns with a **stateful** stub.
 * Two stateful copies are two boxes, of which the process-wide `mock.module`
 * registry keeps one, leaving the other file's switch inert. A guard of its own
 * gives the route's test a specifier nothing else touches.
 *
 * The architectural half is the other reason it is here and not inlined:
 * `jobs/boss.ts` is the only place in this codebase allowed to speak to
 * pg-boss's own registration API, and `jobs/boss.test.ts` enforces that by
 * reading the jobs directory. This does not reach past it — it hands over which
 * sweep and whether, and `applySweepSchedule` still owns how.
 */
export async function applyEvalSchedule(
  schedule: EvalScheduleTime,
): Promise<void> {
  await applySweepSchedule(
    getBoss(),
    EVAL_NIGHTLY_SWEEP.name,
    evalScheduleCron(schedule.hour, schedule.minute),
    schedule.paused,
  );
}
