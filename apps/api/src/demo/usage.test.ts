import { beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "../test/pg";
import {
  demoUsageThisWeek,
  markDemoTicketOpened,
  recordDemoStart,
} from "./usage";

/**
 * The admin's weekly demo figures (#327, PRD R14), over the real in-process
 * Postgres. What is asserted is what the admin would read, through the same
 * three calls `auth.ts`, `GET /api/tickets/:id` and `GET /api/demo/usage` make.
 */

// 2026-09-21 is a Monday: the week these tests read runs from its 00:00 UTC.
const MONDAY = new Date("2026-09-21T00:00:00.000Z");
const WEDNESDAY = new Date("2026-09-23T12:00:00.000Z");
const SUNDAY_LAST_SECOND = new Date("2026-09-27T23:59:59.999Z");
const PREVIOUS_SUNDAY_LAST_SECOND = new Date("2026-09-20T23:59:59.999Z");

beforeEach(async () => {
  await resetDb();
});

describe("demoUsageThisWeek", () => {
  test("a week nobody used the demo in reads zero and zero", async () => {
    expect(await demoUsageThisWeek(WEDNESDAY)).toEqual({
      weekStartsAt: MONDAY,
      started: 0,
      openedTicket: 0,
    });
  });

  test("counts every start, and only the sessions that opened a ticket", async () => {
    await recordDemoStart("visitor-a", MONDAY);
    await recordDemoStart("visitor-b", WEDNESDAY);
    await recordDemoStart("visitor-c", WEDNESDAY);
    await markDemoTicketOpened("visitor-b");

    expect(await demoUsageThisWeek(WEDNESDAY)).toMatchObject({
      started: 3,
      openedTicket: 1,
    });
  });

  // R14 asks how many sessions opened *at least one* ticket, not how many
  // tickets were opened.
  test("a session that opens many tickets counts once", async () => {
    await recordDemoStart("visitor-a", WEDNESDAY);
    for (let i = 0; i < 3; i += 1) await markDemoTicketOpened("visitor-a");

    expect(await demoUsageThisWeek(WEDNESDAY)).toMatchObject({
      started: 1,
      openedTicket: 1,
    });
  });

  test("the week starts at 00:00 UTC on Monday", async () => {
    await recordDemoStart("last-week", PREVIOUS_SUNDAY_LAST_SECOND);
    await markDemoTicketOpened("last-week");
    await recordDemoStart("this-week", MONDAY);

    expect(await demoUsageThisWeek(SUNDAY_LAST_SECOND)).toEqual({
      weekStartsAt: MONDAY,
      started: 1,
      openedTicket: 0,
    });
    expect(await demoUsageThisWeek(PREVIOUS_SUNDAY_LAST_SECOND)).toMatchObject({
      started: 1,
      openedTicket: 1,
    });
  });

  // The session is counted in the week it started, so the second figure is
  // always a share of the first.
  test("a ticket opened after the week turned counts toward the week the session started", async () => {
    await recordDemoStart("late-night", PREVIOUS_SUNDAY_LAST_SECOND);
    await markDemoTicketOpened("late-night");

    expect(await demoUsageThisWeek(WEDNESDAY)).toMatchObject({
      started: 0,
      openedTicket: 0,
    });
  });
});

describe("recordDemoStart", () => {
  // Better Auth's hooks are at-least-once from where this sits: a retried
  // create must not count a visitor twice.
  test("records an identity once", async () => {
    await recordDemoStart("visitor-a", WEDNESDAY);
    await recordDemoStart("visitor-a", WEDNESDAY);

    expect((await demoUsageThisWeek(WEDNESDAY)).started).toBe(1);
  });
});

describe("markDemoTicketOpened", () => {
  // An identity minted before the tally existed has no row to flag, and the
  // ticket it is reading must still load.
  test("an identity with no tally is a no-op", async () => {
    await markDemoTicketOpened("minted-before-the-tally");

    expect(await demoUsageThisWeek(WEDNESDAY)).toMatchObject({
      started: 0,
      openedTicket: 0,
    });
  });
});
