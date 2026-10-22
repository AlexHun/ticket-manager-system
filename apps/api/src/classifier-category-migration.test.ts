import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  TICKET_ACTIVITY_ACTION,
  TICKET_ACTOR_KIND,
  TICKET_CATEGORY,
  type TicketActorKind,
  type TicketCategory,
} from "@ticket/shared";
import { seedTicket } from "./test/fixtures";
import { execSql, prisma, resetDb } from "./test/pg";

/**
 * #561: the classifier records the category it filed in `classifierCategory`,
 * and the migration that adds the column backfills it for tickets that already
 * exist, so they read correctly from the day it ships (R6).
 *
 * Every migration has already run against an empty database by the time this
 * file loads, so the file is replayed here against rows seeded as the
 * classifier and agents left them before the column (`execSql`), as
 * `tutorial-wording-migration.test.ts` does.
 */
const MIGRATION = readFileSync(
  join(
    import.meta.dir,
    "..",
    "prisma",
    "migrations",
    "20261023120000_ticket_classifier_category",
    "migration.sql",
  ),
  "utf8",
);

const STAMPED = new Date("2026-10-01T09:00:12.000Z");

/** A `category_changed` entry, as the classifier or an agent writes one. */
async function categoryChanged(
  ticketId: number,
  actorKind: TicketActorKind,
  fromValue: TicketCategory | null,
  toValue: TicketCategory | null,
) {
  await prisma.ticketActivity.create({
    data: {
      ticketId,
      action: TICKET_ACTIVITY_ACTION.category_changed,
      actorKind,
      actorName:
        actorKind === TICKET_ACTOR_KIND.assistant ? "Assistant" : "Alex Agent",
      fromValue,
      toValue,
    },
  });
}

async function recorded(ticketId: number) {
  const row = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    select: { classifierCategory: true },
  });
  return row.classifierCategory;
}

beforeEach(async () => {
  await resetDb();
});

describe("the #561 classifier-category backfill", () => {
  test("reads what the classifier filed off its own trail, after an agent cleared it", async () => {
    // R1's ticket from before the column: the clear left `category` null.
    const { id } = await seedTicket({ classifiedAt: STAMPED });
    await categoryChanged(
      id,
      TICKET_ACTOR_KIND.assistant,
      null,
      TICKET_CATEGORY.Technical,
    );
    await categoryChanged(
      id,
      TICKET_ACTOR_KIND.agent,
      TICKET_CATEGORY.Technical,
      null,
    );

    await execSql(MIGRATION);

    expect(await recorded(id)).toBe(TICKET_CATEGORY.Technical);
  });

  test("records the classifier's category, not an agent's re-filing", async () => {
    const { id } = await seedTicket({
      classifiedAt: STAMPED,
      category: TICKET_CATEGORY.Refund,
    });
    await categoryChanged(
      id,
      TICKET_ACTOR_KIND.assistant,
      null,
      TICKET_CATEGORY.General,
    );
    await categoryChanged(
      id,
      TICKET_ACTOR_KIND.agent,
      TICKET_CATEGORY.General,
      TICKET_CATEGORY.Refund,
    );

    await execSql(MIGRATION);

    expect(await recorded(id)).toBe(TICKET_CATEGORY.General);
  });

  test("leaves a ticket the classifier gave up on unrecorded", async () => {
    // R2: stamped by the terminal path, nothing filed, no trail.
    const { id } = await seedTicket({ classifiedAt: STAMPED });

    await execSql(MIGRATION);

    expect(await recorded(id)).toBeNull();
  });

  test("leaves a ticket the classifier never stamped unrecorded", async () => {
    // Filed by a person before the classifier got to it.
    const { id } = await seedTicket({ category: TICKET_CATEGORY.Technical });
    await categoryChanged(
      id,
      TICKET_ACTOR_KIND.agent,
      null,
      TICKET_CATEGORY.Technical,
    );

    await execSql(MIGRATION);

    expect(await recorded(id)).toBeNull();
  });

  test("a stamped, categorised ticket with no trail keeps today's reading", async () => {
    // Activity is pruned after a year (ADR-0012). Before the column this read
    // as filed by the classifier, and it still does.
    const { id } = await seedTicket({
      classifiedAt: STAMPED,
      category: TICKET_CATEGORY.Other,
    });

    await execSql(MIGRATION);

    expect(await recorded(id)).toBe(TICKET_CATEGORY.Other);
  });

  test("never overwrites a record the classifier already wrote, and a second run changes nothing", async () => {
    const { id } = await seedTicket({
      classifiedAt: STAMPED,
      category: TICKET_CATEGORY.Refund,
      classifierCategory: TICKET_CATEGORY.Technical,
    });
    await categoryChanged(
      id,
      TICKET_ACTOR_KIND.assistant,
      null,
      TICKET_CATEGORY.General,
    );

    await execSql(MIGRATION);
    await execSql(MIGRATION);

    expect(await recorded(id)).toBe(TICKET_CATEGORY.Technical);
  });
});
