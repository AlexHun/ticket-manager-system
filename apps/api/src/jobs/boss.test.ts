import { expect, spyOn, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { PgBoss, Queue, WorkOptions } from "pg-boss";
import { ensureQueue, registerWorker, type WorkerSpec } from "./boss";

/**
 * What `./boss` promises every consumer, tested against a fake backend.
 *
 * Two things live here. The first is the rule this directory cannot enforce by
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
 */

/** Everything a `PgBoss` was asked to do, and nothing that needs a database. */
function fakeBoss() {
  const calls: string[] = [];
  const created = new Map<string, Omit<Queue, "name">>();
  const updated = new Map<string, Partial<Queue>>();
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
  } as unknown as PgBoss;

  return { boss, calls, created, updated, workers };
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

test("ensureQueue creates the queue and then reapplies its settings", async () => {
  const { boss, calls } = fakeBoss();

  await ensureQueue(boss, "some-queue", { retryLimit: 0, expireInSeconds: 300 });

  // Order matters: `updateQueue` is what makes the source authoritative, and it
  // only reaches an existing queue if the create ran first.
  expect(calls).toEqual(["create:some-queue", "update:some-queue"]);
});

test("ensureQueue keeps policy out of the update", async () => {
  const { boss, updated } = fakeBoss();

  await ensureQueue(boss, "sweep", {
    policy: "singleton",
    retryLimit: 0,
    expireInSeconds: 300,
  });

  // pg-boss refuses to change `policy` or `partition` on a live queue, so they
  // are create-only. Passing them to `updateQueue` would fail the boot for
  // every scheduled sweep, all four of which are singletons.
  expect(updated.get("sweep")).toEqual({ retryLimit: 0, expireInSeconds: 300 });
});

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

test("no job module calls createQueue directly", async () => {
  const dir = import.meta.dir;
  const files = (await readdir(dir)).filter(
    (file) =>
      file.endsWith(".ts") &&
      !file.endsWith(".test.ts") &&
      // The one legitimate caller: `ensureQueue` itself.
      file !== "boss.ts",
  );

  // Guard against the check silently passing because the directory moved.
  expect(files.length).toBeGreaterThan(0);

  const offenders: string[] = [];
  for (const file of files) {
    const source = await Bun.file(join(dir, file)).text();
    // The call form, not the word — `boss.ts` discusses `createQueue` in prose
    // and a consumer may reasonably do the same.
    if (/\.createQueue\s*\(/.test(source)) offenders.push(file);
  }

  expect(offenders).toEqual([]);
});

test("no worker declares the shared recipe for itself", async () => {
  const dir = import.meta.dir;
  const files = (await readdir(dir)).filter(
    (file) =>
      file.endsWith(".ts") && !file.endsWith(".test.ts") && file !== "boss.ts",
  );

  // The three settings #154 moved. A consumer that re-declares one has taken a
  // queue invariant back out of the module named for it — which is how they
  // drifted in the first place: three copies of a poll interval, each with its
  // own copy of the note explaining why it is not thirty.
  const RECIPE = /retryLimit:\s*[1-9]|retryDelay|notifyPollingIntervalSeconds/;

  const offenders: string[] = [];
  for (const file of files) {
    const source = await Bun.file(join(dir, file)).text();
    if (RECIPE.test(source)) offenders.push(file);
  }

  // `retryLimit: 0` is deliberately allowed: the cron sweeps set it, and a sweep
  // that does not retry is not a queue with a ladder of its own.
  expect(offenders).toEqual([]);
});
