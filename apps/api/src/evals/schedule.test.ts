/**
 * Unit tests for `apps/api/src/evals/schedule.ts`.
 *
 * Two claims, and both of them are about a value that used to be a constant in
 * the source (#236): the string the queue is handed, and what is read when the
 * database has nothing to say.
 *
 * No mocks at all. The module reads one row through `../db`, which the preload
 * has already bound to the in-process Postgres (ADR-0014), and formats a
 * string — so there is nothing here worth standing in for.
 */

import { beforeEach, expect, test } from "bun:test";
import { prisma, resetDb } from "../test/pg";
import {
  EVAL_SCHEDULE_DEFAULT,
  EVAL_SCHEDULE_ID,
  evalScheduleCron,
  readEvalSchedule,
} from "./schedule";

beforeEach(async () => {
  await resetDb();
});

test("formats a daily time as cron, minute first", () => {
  // The field order is the one thing a hand-written cron gets wrong, and it
  // fails silently: "3 47 * * *" is a perfectly valid expression that runs at
  // 47 minutes past 3am's *opposite* — 03:47 becomes 47:03, which cron reads as
  // hour 47 and never fires at all.
  expect(evalScheduleCron(3, 47)).toBe("47 3 * * *");
  expect(evalScheduleCron(0, 0)).toBe("0 0 * * *");
});

test("reads the stored schedule", async () => {
  await prisma.evalSchedule.create({
    data: { id: EVAL_SCHEDULE_ID, hour: 5, minute: 15, paused: true },
  });

  expect(await readEvalSchedule()).toEqual({
    hour: 5,
    minute: 15,
    paused: true,
  });
});

test("falls back to the time the sweep was written with", async () => {
  // The seeded row is what a migrated database has, so this is the answer for a
  // database whose row was deleted — and for the API suite, where `resetDb()`
  // empties every table before each file. A read that answered `null` would
  // push "what time is it then" out to the boot path and the route alike.
  expect(await readEvalSchedule()).toEqual(EVAL_SCHEDULE_DEFAULT);
  expect(EVAL_SCHEDULE_DEFAULT).toEqual({ hour: 3, minute: 47, paused: false });
});
