/**
 * Unit tests for `apps/api/src/demo/showcase.ts` — the code behind both
 * `db:seed:tickets` and the nightly reset (#323).
 *
 * What the nightly asks of it is asserted in `jobs/demo-reset.test.ts`; this
 * file is the plain mode, which only the command line runs, and the one thing
 * both modes owe every row: a date that has already happened.
 *
 * Nothing is mocked; the database is real (`../test/pg`, ADR-0014). Seeding is
 * a hundred tickets and their threads, ~4s on a Windows dev machine, so one
 * scenario is arranged in `beforeAll` and each test reads one consequence.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { TICKET_STATUS } from "@ticket/shared";
import { seedColleagues } from "../test/fixtures";
import { prisma, resetDb } from "../test/pg";

const { seedShowcase } = await import("./showcase");

const SCENARIO_TIMEOUT_MS = 60_000;

/**
 * 00:00:30 UTC today — the moment the nightly runs. A seeded ticket's hour is
 * set in business hours, and every business hour of "today" is still ahead.
 */
const MIDNIGHT = (() => {
  const at = new Date();
  at.setUTCHours(0, 0, 30, 0);
  return at.getTime();
})();

describe("seedShowcase, plain, over a showcase somebody has used", () => {
  let first: Awaited<ReturnType<typeof seedShowcase>>;
  let again: Awaited<ReturnType<typeof seedShowcase>>;
  let worked: { id: number };
  let removed: { subject: string; customerEmail: string };
  let emptied: { id: number };

  beforeAll(async () => {
    await resetDb();
    await seedColleagues("admin", "agent");
    first = await seedShowcase({ now: MIDNIGHT });

    const [a, b, c] = await prisma.ticket.findMany({
      where: { status: TICKET_STATUS.Open },
      orderBy: { id: "asc" },
      take: 3,
      select: { id: true, subject: true, customerEmail: true },
    });
    worked = a;
    await prisma.ticket.update({
      where: { id: a.id },
      data: { status: TICKET_STATUS.Closed },
    });
    removed = { subject: b.subject, customerEmail: b.customerEmail };
    await prisma.ticket.delete({ where: { id: b.id } });
    emptied = c;
    await prisma.message.deleteMany({ where: { ticketId: c.id } });

    again = await seedShowcase({ now: MIDNIGHT });
  }, SCENARIO_TIMEOUT_MS);

  test("the first run writes a hundred tickets, each with a thread", async () => {
    expect(first.created).toBe(100);
    expect(first.removed).toBe(0);
    expect(
      await prisma.ticket.count({ where: { messages: { none: {} } } }),
    ).toBe(0);
  });

  test("puts back only the ticket that is missing", async () => {
    expect(again.created).toBe(1);
    expect(again.removed).toBe(0);
    expect(await prisma.ticket.count({ where: removed })).toBe(1);
    expect(await prisma.ticket.count()).toBe(100);
  });

  test("leaves a ticket somebody worked as they left it", async () => {
    const ticket = await prisma.ticket.findUniqueOrThrow({
      where: { id: worked.id },
      select: { status: true },
    });
    expect(ticket.status).toBe(TICKET_STATUS.Closed);
  });

  test("backfills a thread onto a demo ticket that has none", async () => {
    expect(again.backfilledTickets).toBe(1);
    expect(
      await prisma.message.count({ where: { ticketId: emptied.id } }),
    ).toBeGreaterThan(0);
  });

  // The nightly runs at 00:00 UTC, and "today at 08:00" is still ahead then.
  // A ticket from the future sorts above everything in the list and drops out
  // of every window that slices on `createdAt < to`.
  test("dates nothing in the future, even when it runs at midnight", async () => {
    const future = { gt: new Date(MIDNIGHT) };
    expect(
      await prisma.ticket.count({
        where: { OR: [{ createdAt: future }, { lastMessageAt: future }] },
      }),
    ).toBe(0);
    expect(await prisma.message.count({ where: { createdAt: future } })).toBe(
      0,
    );
  });
});

test("refuses to seed a desk with nobody to assign to", async () => {
  await resetDb();
  await seedColleagues("demoVisitor");

  await expect(seedShowcase()).rejects.toThrow("No users found");
  expect(await prisma.ticket.count()).toBe(0);
});
