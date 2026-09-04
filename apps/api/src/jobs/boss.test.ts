import { expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { PgBoss, Queue } from "pg-boss";
import { ensureQueue } from "./boss";

/**
 * The one rule this directory cannot enforce by types: a queue's settings must
 * be reconciled on boot, not merely created once.
 *
 * `boss.createQueue` is a no-op when the queue already exists, so a consumer
 * that calls it directly gets settings frozen at whatever the constants said on
 * the day the queue was first created — silently, and for as long as the
 * deployment lives. Four scheduled queues did exactly that until #144.
 *
 * Two halves, and both are needed. The first proves `ensureQueue` still does
 * the reconciling; the second proves nothing goes around it. Either one alone
 * can be satisfied while the bug is present.
 */

/** A `PgBoss` that records the two calls `ensureQueue` is supposed to make. */
function fakeBoss() {
  const calls: string[] = [];
  let updatedWith: Partial<Queue> | undefined;

  const boss = {
    createQueue: async (name: string, _options: Omit<Queue, "name">) => {
      calls.push(`create:${name}`);
    },
    updateQueue: async (name: string, options: Partial<Queue>) => {
      calls.push(`update:${name}`);
      updatedWith = options;
    },
  } as unknown as PgBoss;

  return { boss, calls, updated: () => updatedWith };
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
  expect(updated()).toEqual({ retryLimit: 0, expireInSeconds: 300 });
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
