import { expect, spyOn, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { PgBoss, Queue, WorkOptions } from "pg-boss";
import {
  registerSweep,
  registerWorker,
  type SweepSpec,
  type WorkerSpec,
} from "./boss";

/**
 * What `./boss` promises every consumer, tested against a fake backend.
 *
 * Three things live here. The first is the rule this directory cannot enforce by
 * types: **a queue's settings must be reconciled on boot, not merely created
 * once.** `boss.createQueue` is a no-op when the queue already exists, so a
 * consumer that calls it directly gets settings frozen at whatever the constants
 * said on the day the queue was first created — silently, and for as long as the
 * deployment lives. Four scheduled queues did exactly that until #144.
 *
 * The second is the registration recipe `registerWorker` took over from the
 * three worker files in #154: the pair of queues, the ladder, the poll interval
 * and the exhaustion path. Those used to be re-typed per consumer, where nothing
 * could assert them at all — a fake `PgBoss` is enough to assert all of them
 * here, because the recipe is entirely a matter of what gets *asked* of pg-boss.
 *
 * The third is `registerSweep`'s, which #158 took over from the same four
 * scheduled queues: the singleton policy, the deliberate absence of a ladder,
 * and the schedule that is re-asserted on every boot. Its last two tests are the
 * ones with teeth — they read the directory and fail on any job module that
 * reaches for pg-boss's own registration calls, which is the only way the
 * settings above can drift back out of this module. `ensureQueue` is no longer
 * exported and no longer has a test of its own: both registrars go through it,
 * so a create-then-update it skipped would fail here anyway, and testing the
 * contract beats testing the plumbing.
 */

/** Everything a `PgBoss` was asked to do, and nothing that needs a database. */
function fakeBoss() {
  const calls: string[] = [];
  const created = new Map<string, Omit<Queue, "name">>();
  const updated = new Map<string, Partial<Queue>>();
  const scheduled = new Map<string, string>();
  const workers = new Map<
    string,
    {
      options: WorkOptions;
      handler: (jobs: { data: unknown }[]) => Promise<unknown>;
    }
  >();

  const boss = {
    createQueue: async (name: string, options: Omit<Queue, "name">) => {
      calls.push(`create:${name}`);
      created.set(name, options);
    },
    updateQueue: async (name: string, options: Partial<Queue>) => {
      calls.push(`update:${name}`);
      updated.set(name, options);
    },
    work: async (
      name: string,
      options: WorkOptions,
      handler: (jobs: { data: unknown }[]) => Promise<unknown>,
    ) => {
      calls.push(`work:${name}`);
      workers.set(name, { options, handler });
      return name;
    },
    schedule: async (name: string, cron: string) => {
      calls.push(`schedule:${name}`);
      scheduled.set(name, cron);
    },
  } as unknown as PgBoss;

  return { boss, calls, created, updated, scheduled, workers };
}

/** A worker that records what it was handed and needs nothing to run. */
function fakeSpec() {
  const handled: { id: number }[] = [];
  const exhausted: { id: number }[] = [];

  const spec: WorkerSpec<{ id: number }> = {
    name: "demo",
    concurrency: 3,
    expireInSeconds: 90,
    handle: async (data) => {
      handled.push(data);
    },
    onExhausted: async (data) => {
      exhausted.push(data);
    },
  };

  return { spec, handled, exhausted };
}

/** A sweep that records every tick and needs nothing to run. */
function fakeSweep() {
  const ticks: number[] = [];

  const spec: SweepSpec = {
    name: "sweep",
    cron: "23 * * * *",
    expireInSeconds: 300,
    run: async () => {
      ticks.push(ticks.length + 1);
    },
  };

  return { spec, ticks };
}

test("registerWorker creates and reconciles both queues in the pair", async () => {
  const { boss, calls } = fakeBoss();
  const { spec } = fakeSpec();

  await registerWorker(boss, spec);

  // The dead-letter queue first — naming it on the live queue requires it to
  // exist — and *both* through `ensureQueue`, so #144's reconcile-on-boot holds
  // for the twin as well as for the queue everybody thinks about.
  expect(calls).toEqual([
    "create:demo-dead",
    "update:demo-dead",
    "create:demo",
    "update:demo",
    "work:demo",
    "work:demo-dead",
  ]);
});

test("registerWorker gives the live queue the ladder and its twin", async () => {
  const { boss, created, updated } = fakeBoss();
  const { spec } = fakeSpec();

  await registerWorker(boss, spec);

  // The whole recipe, in the one place it is now declared. `deadLetter` is
  // derived from the name rather than taken from the spec, so the pair cannot be
  // half declared.
  expect(created.get("demo")).toEqual({
    retryLimit: 4,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 90,
    deadLetter: "demo-dead",
    notify: true,
  });
  // Every one of those is reapplied on boot; none of them is create-only.
  expect(updated.get("demo")).toEqual(created.get("demo") as Partial<Queue>);

  // No retries of its own: a job arrives on the twin precisely because retrying
  // stopped being the answer.
  expect(created.get("demo-dead")).toEqual({ retryLimit: 0 });
});

test("registerWorker polls often enough for a due retry", async () => {
  const { boss, workers } = fakeBoss();
  const { spec } = fakeSpec();

  await registerWorker(boss, spec);

  // `notifyPollingIntervalSeconds` is the measured one: NOTIFY fires on insert,
  // not when a retry becomes due, so on pg-boss's 30s default every rung of the
  // ladder picks up an extra delay of up to a full poll. `batchSize: 1` with
  // `localConcurrency` is the other: a batch shares its fate, and one job's
  // transient failure must not drag its neighbours back through the ladder.
  expect(workers.get("demo")?.options).toEqual({
    batchSize: 1,
    localConcurrency: 3,
    notifyPollingIntervalSeconds: 5,
  });
  expect(workers.get("demo-dead")?.options).toEqual({ batchSize: 1 });
});

test("a delivered job reaches the handler", async () => {
  const { boss, workers } = fakeBoss();
  const { spec, handled, exhausted } = fakeSpec();

  await registerWorker(boss, spec);
  await workers.get("demo")!.handler([{ data: { id: 7 } }]);

  expect(handled).toEqual([{ id: 7 }]);
  expect(exhausted).toEqual([]);
});

test("an exhausted job reaches onExhausted", async () => {
  const { boss, workers } = fakeBoss();
  const { spec, handled, exhausted } = fakeSpec();

  // The alert is `registerWorker`'s, not the consumer's, and it logs on the way
  // through; silenced here so a passing run stays quiet. Counted before the
  // restore, which clears the record along with the implementation.
  const logged = spyOn(console, "error").mockImplementation(() => {});
  let lines = -1;
  try {
    await registerWorker(boss, spec);
    await workers.get("demo-dead")!.handler([{ data: { id: 7 } }]);
    lines = logged.mock.calls.length;
  } finally {
    logged.mockRestore();
  }

  // The repair runs, and the live handler does not: the dead-letter queue is
  // where retrying has stopped being the answer, not one more attempt.
  expect(exhausted).toEqual([{ id: 7 }]);
  expect(handled).toEqual([]);
  // One line for the whole exhaustion, from the one place that makes it. Two —
  // the module's and a consumer's own — is the noise that gets a filter written
  // for it, on the one event nobody should be filtering.
  expect(lines).toBe(1);
});

test("registerSweep creates the queue, works it, and puts it on the clock", async () => {
  const { boss, calls, scheduled } = fakeBoss();
  const { spec } = fakeSweep();

  await registerSweep(boss, spec);

  // Create then update, for #144's reason, then the worker, then the schedule.
  // `schedule` last is not cosmetic: pg-boss will happily put a cron on a queue
  // nothing is working, which is a tick that fires into an empty room.
  expect(calls).toEqual([
    "create:sweep",
    "update:sweep",
    "work:sweep",
    "schedule:sweep",
  ]);
  // Re-asserted on every boot, which is what makes an edited cron expression
  // take effect on deploy rather than never. pg-boss upserts rather than stacks.
  expect(scheduled.get("sweep")).toBe("23 * * * *");
});

test("registerSweep gives a sweep the singleton policy and no ladder", async () => {
  const { boss, created, updated } = fakeBoss();
  const { spec } = fakeSweep();

  await registerSweep(boss, spec);

  // The recipe the four scheduled queues used to write out by hand. `singleton`
  // is the reason a sweep needs no concurrency of its own; `retryLimit: 0` is
  // not a shorter ladder but the absence of one — the next tick sees the same
  // rows, so a retry would buy a duplicate rather than a recovery.
  expect(created.get("sweep")).toEqual({
    policy: "singleton",
    retryLimit: 0,
    expireInSeconds: 300,
  });

  // pg-boss refuses to change `policy` or `partition` on a live queue, so they
  // are create-only. Passing `policy` to `updateQueue` would fail the boot for
  // every scheduled sweep, all four of which are singletons — everything else
  // is reapplied.
  expect(updated.get("sweep")).toEqual({ retryLimit: 0, expireInSeconds: 300 });
});

test("registerSweep asks for one sweep at a time, and no dead-letter twin", async () => {
  const { boss, created, workers } = fakeBoss();
  const { spec } = fakeSweep();

  await registerSweep(boss, spec);

  expect(workers.get("sweep")?.options).toEqual({ batchSize: 1 });
  // No `-dead` queue anywhere: a dead-letter twin is where a ladder ends, and
  // this queue has no ladder. One would only collect jobs nothing would read.
  expect([...created.keys()]).toEqual(["sweep"]);
});

test("a tick reaches the sweep", async () => {
  const { boss, workers } = fakeBoss();
  const { spec, ticks } = fakeSweep();

  await registerSweep(boss, spec);
  // A cron tick carries no payload, which is the whole difference in the
  // handler: pg-boss still delivers a job, and `run` is called with nothing.
  await workers.get("sweep")!.handler([{ data: {} }]);

  expect(ticks).toEqual([1]);
});

test("no job module calls pg-boss's own registration functions", async () => {
  const dir = import.meta.dir;
  const files = (await readdir(dir)).filter(
    (file) =>
      file.endsWith(".ts") &&
      !file.endsWith(".test.ts") &&
      // The one legitimate caller: this module is the registration surface.
      file !== "boss.ts",
  );

  // Guard against the check silently passing because the directory moved.
  expect(files.length).toBeGreaterThan(0);

  // The four that make a queue what it is. `createQueue`/`updateQueue` are
  // #144's pair, and `work`/`schedule` joined them in #158 — a consumer that
  // calls either of those has taken back the settings that come with them, which
  // is exactly how the four scheduled queues ended up with a hand-typed
  // singleton policy each. `send` is deliberately absent: enqueueing is what a
  // consumer is *for*.
  const REGISTRATION = /\.(createQueue|updateQueue|work|schedule)\s*\(/;

  const offenders: string[] = [];
  for (const file of files) {
    const source = await Bun.file(join(dir, file)).text();
    // The call form, not the word — `boss.ts` discusses `createQueue` in prose
    // and a consumer may reasonably do the same.
    if (REGISTRATION.test(source)) offenders.push(file);
  }

  expect(offenders).toEqual([]);
});

test("no consumer declares a shared queue setting for itself", async () => {
  const dir = import.meta.dir;
  const files = (await readdir(dir)).filter(
    (file) =>
      file.endsWith(".ts") && !file.endsWith(".test.ts") && file !== "boss.ts",
  );

  // The settings #154 and #158 moved. A consumer that re-declares one has taken
  // a queue invariant back out of the module named for it — which is how they
  // drifted in the first place: three copies of a poll interval, each with its
  // own copy of the note explaining why it is not thirty, and four copies of a
  // singleton policy.
  //
  // `retryLimit` is now banned outright rather than only above zero. The `0` a
  // sweep used to set was the honest exception while sweeps wired their own
  // queues; now that `registerSweep` sets it, a consumer typing it again is a
  // consumer that has stopped going through the registrar.
  const RECIPE =
    /retryLimit|retryDelay|notifyPollingIntervalSeconds|policy:|deadLetter/;

  const offenders: string[] = [];
  for (const file of files) {
    const source = await Bun.file(join(dir, file)).text();
    if (RECIPE.test(source)) offenders.push(file);
  }

  expect(offenders).toEqual([]);
});
