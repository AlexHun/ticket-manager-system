import type { PgBoss } from "pg-boss";
import { EVAL_CORPUS } from "@ticket/shared";
import { startEvalRun } from "../evals/start-run";
import {
  EVAL_SCHEDULE_DEFAULT,
  evalScheduleCron,
  readEvalSchedule,
} from "../evals/schedule";
import { applySweepSchedule, registerSweep, type SweepSpec } from "./boss";
import { ALL_EVAL_CASE_IDS } from "./eval-run";

/**
 * The eval harness, running itself once a night (PRD R13).
 *
 * A harness that only measures when somebody remembers to press a button
 * measures the days somebody was already worried. The value of this one is the
 * *series*: a rate is a small sample and a single run is barely evidence, so
 * what a threshold is actually read against is the trend of the runs before it
 * — and a trend needs points nobody had to ask for.
 *
 * **Frozen, always, and never the live corpus.** The two are separate series
 * that are never averaged (R4), and only one of them can carry an unattended
 * trend line: a live-corpus run answers from the articles an admin edits at
 * `/knowledge`, so a move in it is ambiguous between a prompt regression and
 * somebody rewording KB-014 that morning. The frozen corpus is a file in this
 * repository, so a move in *this* line means the code moved and a diff can say
 * how. A live run stays something a person asks for, on purpose.
 *
 * **The whole set, never a subset.** Pinned ids exist for the E2E suite and for
 * an admin re-running the one case that moved; a nightly answering a subset
 * would produce numbers that are not comparable with the night before, which is
 * the one property a stored series has to have.
 *
 * ## What this file deliberately does not do
 *
 * It does not open the transaction, stamp the thresholds, or publish the event
 * — `../evals/start-run` does, and the route goes through the same door. Two
 * callers each writing out that order is how the two drift.
 *
 * It does not check for a key either. `jobs/index.ts` registers this only when
 * `isEvalConfigured()`, which is the same line `enqueueEvalRun` keeps for
 * itself, and a third copy would be a third thing to keep in step.
 *
 * And it takes **no lock against a run already in flight**. It does not need
 * one: `registerSweep` makes this queue a singleton so a tick cannot overlap
 * its predecessor, and the eval-run worker's concurrency is one, so a nightly
 * arriving while an admin's run is going simply waits its turn. Two runs a few
 * minutes apart is a fair description of what happened, which is better than a
 * night with no measurement because somebody clicked Run at 03:58.
 */

const NIGHTLY_QUEUE = "eval-nightly";

/**
 * The time to sweep at when nothing has been stored — 03:47.
 *
 * **The time is a row now, not this constant** (#236). What the constant
 * became is the seed and the fallback: the migration wrote it into
 * `eval_schedule`, `EVAL_SCHEDULE_DEFAULT` is what a read falls back to, and
 * this is what the spec below carries so a `SweepSpec` is still a complete
 * value that a test can read without a database.
 *
 * The reasoning behind those two numbers has not moved and is still the
 * reasoning. **Nightly**, not hourly and not every few hours: a full set is
 * ~175 calls against a real provider and somebody pays for every one of them
 * (R10 records the figure and the PRD deliberately sets no ceiling). One point
 * a day is also the granularity the trend is read at. **A minute nobody else
 * uses**, the same rule `prune-outbox` follows: the two pruning sweeps sit at
 * :23 and 03:41, and a run holds one worker for minutes.
 *
 * An admin may now retime it to something that breaks the second half. That is
 * the trade the ticket makes on purpose — the first half is the expensive one,
 * and an hourly nightly is not offered at all, because the control takes an
 * hour and a minute rather than a cron expression.
 */
const NIGHTLY_CRON = evalScheduleCron(
  EVAL_SCHEDULE_DEFAULT.hour,
  EVAL_SCHEDULE_DEFAULT.minute,
);

/**
 * How long one tick may be active before pg-boss assumes the process died.
 *
 * A minute, and it is small on purpose: this sweep writes one row and hands the
 * work to a queue. The forty minutes a *run* may take belongs to
 * `EVAL_RUN_WORKER`, which is what actually does it — putting a run's ceiling
 * here would be describing somebody else's job.
 */
const EXPIRE_IN_SECONDS = 60;

/** Open tonight's run. */
async function startNightlyRun(): Promise<void> {
  const runId = await startEvalRun(EVAL_CORPUS.frozen, ALL_EVAL_CASE_IDS);

  // One line, unconditionally, unlike the pruning sweeps that stay silent on a
  // quiet night. A nightly eval spends money every time it fires, so "it fired"
  // is itself worth being able to grep for — and an unexplained charge with no
  // line beside it is the risk the PRD names.
  console.log(
    `[evals] nightly run ${runId} queued: frozen corpus, ${ALL_EVAL_CASE_IDS.length} cases`,
  );
}

/**
 * What `./boss` needs to run this sweep, and how `startNightlyRun` is reached
 * without a queue backend.
 *
 * **Exported**, for the reason all four of the others are: what a scheduled job
 * does is invisible in production until it has been doing the wrong thing for a
 * month, and a spec is a value whose `run` is a function call in a test.
 */
export const EVAL_NIGHTLY_SWEEP: SweepSpec = {
  name: NIGHTLY_QUEUE,
  cron: NIGHTLY_CRON,
  expireInSeconds: EXPIRE_IN_SECONDS,
  run: startNightlyRun,
};

/**
 * Create the queue and start the sweep, at the time the deployment says.
 * Called once, from `./index`.
 *
 * **The stored schedule wins over the constant, and that is the whole point of
 * the boot path being different from the other four sweeps'** (#236).
 * `registerSweep` re-asserts a spec's cron on every boot — which is what makes
 * an edited constant take effect on deploy — and here that is precisely the
 * behaviour to avoid: an admin retimed this to 05:00 and the next deploy would
 * quietly put it back to 03:47. So the spec is registered carrying the time in
 * force rather than the default it was written with.
 *
 * The second call is not redundant with the first. `registerSweep` schedules
 * unconditionally, because no other sweep can be paused; this is where a paused
 * schedule is taken back off the clock, and both halves are idempotent, so
 * asserting a cron and then unscheduling it costs one statement on a boot that
 * happens once.
 */
export async function registerEvalNightly(boss: PgBoss): Promise<void> {
  const schedule = await readEvalSchedule();
  const cron = evalScheduleCron(schedule.hour, schedule.minute);

  await registerSweep(boss, { ...EVAL_NIGHTLY_SWEEP, cron });
  await applySweepSchedule(
    boss,
    EVAL_NIGHTLY_SWEEP.name,
    cron,
    schedule.paused,
  );
}
