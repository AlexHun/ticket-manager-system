import { DATABASE_URL, requireEnv } from "./env";

/**
 * Run tonight's demo reset now (#323): the nightly sweep's own exported `run`,
 * in this process, against the test database.
 *
 * Not by waiting for its cron, for the reason `evals.spec.ts` gives — a test
 * that waited for 00:00 UTC would wait a day. And not through an endpoint,
 * because there is none: the PRD rules out a "reset now" button (`--reset` by
 * hand is the answer to that), so the only way in is the function the queue
 * calls, which is also the thing worth testing.
 *
 * The API's own modules read the environment when they run, and this process
 * never had `apps/api/.env.test` loaded for it (see `./env`), so the two keys
 * the reset reads are copied in first: the database the app client opens at
 * import, and the switch the sweep asks on every run. Imported only after
 * that, dynamically, for the first of the two.
 */
export async function runDemoReset(): Promise<void> {
  process.env.DATABASE_URL = DATABASE_URL;
  process.env.DEMO_MODE_ENABLED = requireEnv("DEMO_MODE_ENABLED");

  const { DEMO_RESET_SWEEP } =
    await import("../../../apps/api/src/jobs/demo-reset");
  await DEMO_RESET_SWEEP.run();
}
