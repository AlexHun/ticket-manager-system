import { beforeEach, describe, expect, mock, test } from "bun:test";
import { TICKET_CATEGORY, type TicketCategory } from "@ticket/shared";
import { Prisma, prisma, resetDb } from "../test/pg";

/**
 * Both halves of the classify worker, called directly — no pg-boss anywhere.
 *
 * That is the property under test as much as the outcomes are (#154). A
 * `WorkerSpec` is a value, so `handle` and `onExhausted` are plain functions
 * over the job payload: what used to be reachable only by standing up a queue —
 * in particular the terminal path, which by definition never runs on a good day
 * — is now a function call. `./boss` is imported by the module under test and
 * never started; `getBoss()` would throw, and nothing below reaches it.
 *
 * The database is real (`../test/pg`, ADR-0014), which is the half that matters
 * here: every write on both paths is a conditional `updateMany` whose `where` is
 * the whole argument for why at-least-once delivery is harmless — a ticket an
 * agent decided about while the model was thinking must survive untouched. A
 * hand-written fake would be asserting against its own re-implementation of that
 * clause.
 *
 * No model is called on any path below, and none is mocked: every case here is
 * one the guards settle before `classifyTicket` is reached, which is exactly
 * what makes them worth pinning down.
 */

mock.module("../db", () => ({ Prisma, prisma }));

const { CLASSIFY_WORKER } = await import("./classify-ticket");

/** One ticket, as `ingest.ts` would have left it: no verdict, no category. */
async function newTicket(
  overrides: { category?: TicketCategory; classifiedAt?: Date } = {},
): Promise<number> {
  const ticket = await prisma.ticket.create({
    data: {
      subject: "My login is broken",
      customerEmail: "customer@example.com",
      customerName: "Casey Customer",
      ...overrides,
    },
    select: { id: true },
  });
  return ticket.id;
}

async function verdictOn(id: number) {
  return prisma.ticket.findUnique({
    where: { id },
    select: { category: true, classifiedAt: true },
  });
}

beforeEach(async () => {
  await resetDb();
});

describe("handle", () => {
  test("leaves a ticket an agent has already categorised alone", async () => {
    const id = await newTicket({ category: TICKET_CATEGORY.Technical });

    await CLASSIFY_WORKER.handle({ ticketId: id });

    // No verdict stamped, which is the observable half of "no model was called":
    // every path that reaches `classifyTicket` writes `classifiedAt`, success or
    // give-up. A person got there first, and that is the system working.
    expect(await verdictOn(id)).toEqual({
      category: TICKET_CATEGORY.Technical,
      classifiedAt: null,
    });
  });

  test("does nothing on a second delivery after a verdict", async () => {
    const stamped = new Date("2026-01-01T00:00:00.000Z");
    const id = await newTicket({ classifiedAt: stamped });

    // Abandoned earlier — a terminal failure, or an exhausted ladder. The ticket
    // is not offered back, and this job arriving again must not re-open it.
    await CLASSIFY_WORKER.handle({ ticketId: id });

    expect(await verdictOn(id)).toEqual({ category: null, classifiedAt: stamped });
  });

  test("does nothing when the ticket is gone", async () => {
    // Deleted between the enqueue and the delivery. Returning rather than
    // throwing is what stops pg-boss retrying it five times over seven minutes.
    await CLASSIFY_WORKER.handle({ ticketId: 4_242 });
  });
});

describe("onExhausted", () => {
  test("stamps the ticket so the sweep stops offering it back", async () => {
    const id = await newTicket();

    await CLASSIFY_WORKER.onExhausted({ ticketId: id });

    // The stamp is the whole point: `classifiedAt` moves the ticket from "still
    // to be classified" to "abandoned", and without it `reconcile` would
    // re-enqueue this ticket every fifteen minutes for a day. The category stays
    // null — nothing was ever decided about what this ticket is.
    const verdict = await verdictOn(id);
    expect(verdict?.category).toBeNull();
    expect(verdict?.classifiedAt).toBeInstanceOf(Date);
  });

  test("never overwrites a verdict that already landed", async () => {
    const stamped = new Date("2026-01-01T00:00:00.000Z");
    const id = await newTicket({
      category: TICKET_CATEGORY.General,
      classifiedAt: stamped,
    });

    await CLASSIFY_WORKER.onExhausted({ ticketId: id });

    expect(await verdictOn(id)).toEqual({
      category: TICKET_CATEGORY.General,
      classifiedAt: stamped,
    });
  });

  test("does nothing when the ticket is gone", async () => {
    // `updateMany`, not `update`: a missing row must not fail the job and send
    // it round the dead-letter queue again.
    await CLASSIFY_WORKER.onExhausted({ ticketId: 4_242 });
  });
});
