/**
 * Unit tests for `apps/api/src/assistant-decisions.ts`: the window both screens
 * count over, the counts they both publish for it, and the override walk the
 * dashboard adds beside them (#563).
 *
 * `/pipeline` and the dashboard's effectiveness figures both take their window
 * and their classified, gave-up, resolved and per-reason decline counts from
 * here, so these are the tests for what each fact means. The routes' own test
 * files keep only what is theirs: how `pipelineCounts` splits the rest of the
 * rail, and how the effectiveness route turns the counts into rates.
 *
 * The counts run against the real in-process Postgres (`../test/pg`,
 * ADR-0014), since each is a Prisma `where` and only a database can say which
 * rows one matches. Nothing is mocked.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import {
  AUTO_REPLY_DECLINE,
  AUTO_REPLY_DECLINES,
  DASHBOARD_RANGE,
  TICKET_ACTOR_KIND,
  TICKET_CATEGORY,
  TICKET_STATUS,
  type DashboardRange,
} from "@ticket/shared";
import { resetDb } from "./test/pg";
import { COLLEAGUE, seedColleagues, seedTicket } from "./test/fixtures";

const { countCategoryOverrides, windowCounts, windowFor } =
  await import("./assistant-decisions");

/** Pinned, so the window's edges are literals rather than `Date.now()`. */
const TO = new Date("2026-09-10T12:00:00.000Z");
const AN_HOUR_AGO = new Date("2026-09-10T11:00:00.000Z");

beforeEach(async () => {
  await resetDb();
});

describe("windowFor", () => {
  test.each<[DashboardRange, string]>([
    [DASHBOARD_RANGE.d7, "2026-09-03T12:00:00.000Z"],
    [DASHBOARD_RANGE.d30, "2026-08-11T12:00:00.000Z"],
    [DASHBOARD_RANGE.d90, "2026-06-12T12:00:00.000Z"],
    [DASHBOARD_RANGE.m12, "2025-09-10T12:00:00.000Z"],
  ])("%s reaches back to %s from the instant it is given", (range, from) => {
    const window = windowFor(range, TO);

    expect(window.from.toISOString()).toBe(from);
    expect(window.to.toISOString()).toBe(TO.toISOString());
  });
});

describe("windowCounts", () => {
  const window = windowFor(DASHBOARD_RANGE.d30, TO);

  /** Filed by the classifier, as `handle` leaves a ticket. */
  const filed = {
    createdAt: AN_HOUR_AGO,
    category: TICKET_CATEGORY.Technical,
    classifierCategory: TICKET_CATEGORY.Technical,
    classifiedAt: AN_HOUR_AGO,
  };

  test("counts what the classifier filed, whatever an agent did to the category since", async () => {
    await seedTicket(filed);
    // R1: filed, then cleared by an agent.
    await seedTicket({ ...filed, category: null });
    // Filed, then re-filed under another category.
    await seedTicket({ ...filed, category: TICKET_CATEGORY.Refund });

    const counts = await windowCounts(window);

    expect(counts.classified).toBe(3);
    expect(counts.gaveUp).toBe(0);
  });

  test("counts what the classifier gave up on, whoever filed it since", async () => {
    // R2: the terminal path's stamp, untouched and then filed by a person.
    await seedTicket({ createdAt: AN_HOUR_AGO, classifiedAt: AN_HOUR_AGO });
    await seedTicket({
      createdAt: AN_HOUR_AGO,
      classifiedAt: AN_HOUR_AGO,
      category: TICKET_CATEGORY.Refund,
    });
    // Neither: not reached yet, or filed by a person before the classifier ran.
    await seedTicket({ createdAt: AN_HOUR_AGO });
    await seedTicket({
      createdAt: AN_HOUR_AGO,
      category: TICKET_CATEGORY.General,
    });

    const counts = await windowCounts(window);

    expect(counts.gaveUp).toBe(2);
    expect(counts.classified).toBe(0);
  });

  test("counts what carries the auto-resolve stamp, whoever holds the ticket now", async () => {
    await seedColleagues("agent", "assistant");
    // R3: resolved and still filed under the assistant; resolved and then
    // reassigned and closed by an agent.
    await seedTicket({
      ...filed,
      status: TICKET_STATUS.Resolved,
      autoResolvedAt: AN_HOUR_AGO,
      assignedToId: COLLEAGUE.assistant.id,
    });
    await seedTicket({
      ...filed,
      status: TICKET_STATUS.Closed,
      autoResolvedAt: AN_HOUR_AGO,
      assignedToId: COLLEAGUE.agent.id,
    });
    // Filed under the assistant with no stamp: a customer's reopen cleared it.
    await seedTicket({
      ...filed,
      status: TICKET_STATUS.Open,
      assignedToId: COLLEAGUE.assistant.id,
    });

    expect((await windowCounts(window)).resolved).toBe(2);
  });

  test("tallies every decline reason, the zeroes and the outage included", async () => {
    await seedTicket({
      ...filed,
      autoReplyDecline: AUTO_REPLY_DECLINE.notCovered,
    });
    await seedTicket({
      ...filed,
      autoReplyDecline: AUTO_REPLY_DECLINE.notCovered,
    });
    await seedTicket({
      ...filed,
      autoReplyDecline: AUTO_REPLY_DECLINE.unavailable,
    });

    const { declines } = await windowCounts(window);

    expect(Object.keys(declines).sort()).toEqual(
      [...AUTO_REPLY_DECLINES].sort(),
    );
    expect(declines[AUTO_REPLY_DECLINE.notCovered]).toBe(2);
    expect(declines[AUTO_REPLY_DECLINE.unavailable]).toBe(1);
    expect(declines[AUTO_REPLY_DECLINE.tooLong]).toBe(0);
  });

  test("counts tickets created in [from, to) and nothing either side", async () => {
    const decided = {
      ...filed,
      autoResolvedAt: AN_HOUR_AGO,
      autoReplyDecline: AUTO_REPLY_DECLINE.notCovered,
    };
    // Exactly at `from`: inside.
    await seedTicket({ ...decided, createdAt: window.from });
    // A millisecond before `from`, and exactly at `to`: outside.
    await seedTicket({
      ...decided,
      createdAt: new Date(window.from.getTime() - 1),
    });
    await seedTicket({ ...decided, createdAt: window.to });

    const counts = await windowCounts(window);

    expect(counts).toMatchObject({ classified: 1, resolved: 1 });
    expect(counts.declines[AUTO_REPLY_DECLINE.notCovered]).toBe(1);
  });
});

describe("countCategoryOverrides", () => {
  test("classifier filed it, an agent later changed it: counted", () => {
    const rows = [
      { ticketId: 1, actorKind: TICKET_ACTOR_KIND.assistant },
      { ticketId: 1, actorKind: TICKET_ACTOR_KIND.agent },
    ];
    expect(countCategoryOverrides(rows)).toBe(1);
  });

  test("classifier filed it, nobody touched it since: not counted", () => {
    const rows = [{ ticketId: 1, actorKind: TICKET_ACTOR_KIND.assistant }];
    expect(countCategoryOverrides(rows)).toBe(0);
  });

  test("an agent filed it directly — the classifier never set a category: not counted", () => {
    // No assistant-authored row exists for this ticket, so there is nothing on
    // record for the agent to have overridden.
    const rows = [{ ticketId: 1, actorKind: TICKET_ACTOR_KIND.agent }];
    expect(countCategoryOverrides(rows)).toBe(0);
  });

  test("an agent changed it twice after the classifier: counted once, not twice", () => {
    const rows = [
      { ticketId: 1, actorKind: TICKET_ACTOR_KIND.assistant },
      { ticketId: 1, actorKind: TICKET_ACTOR_KIND.agent },
      { ticketId: 1, actorKind: TICKET_ACTOR_KIND.agent },
    ];
    expect(countCategoryOverrides(rows)).toBe(1);
  });

  test("mixed tickets: only the ones with both an assistant and an agent row count", () => {
    const rows = [
      // Ticket 1: overridden.
      { ticketId: 1, actorKind: TICKET_ACTOR_KIND.assistant },
      { ticketId: 1, actorKind: TICKET_ACTOR_KIND.agent },
      // Ticket 2: classifier only.
      { ticketId: 2, actorKind: TICKET_ACTOR_KIND.assistant },
      // Ticket 3: agent only — the classifier never reached it.
      { ticketId: 3, actorKind: TICKET_ACTOR_KIND.agent },
      // Ticket 4: overridden too.
      { ticketId: 4, actorKind: TICKET_ACTOR_KIND.assistant },
      { ticketId: 4, actorKind: TICKET_ACTOR_KIND.agent },
    ];
    expect(countCategoryOverrides(rows)).toBe(2);
  });

  test("no rows: zero", () => {
    expect(countCategoryOverrides([])).toBe(0);
  });
});
