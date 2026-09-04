import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  AUTO_REPLY_DECLINE,
  TICKET_ACTIVITY_ACTION,
  TICKET_CATEGORY,
  TICKET_STATUS,
  type TicketEventField,
  type TicketStatus,
} from "@ticket/shared";
import { Prisma, prisma, resetDb } from "../test/pg";

/**
 * The two background sites that publish `ticket_updated` and write an Activity
 * row, held to the order those two things have to happen in (#176).
 *
 * **Why one file for two workers.** ADR-0015 decided there is no shared owner
 * for "a conditional write earns an entry and an event, and the event goes
 * last" — the six sites differ too much for an interface, and the rule stays
 * hand-kept at each. This is the cheap half of that bargain: the sites do not
 * share code, so they share a test. A seventh site that publishes
 * `ticket_updated` after a `recordActivity` belongs in the list below.
 *
 * **What the client does with the event, and why the order is not cosmetic.**
 * `EVENT_EFFECT` in `apps/web/src/lib/realtime-events.ts` invalidates
 * `ticketKeys.activity(ticketId)` on `ticket_updated`, so an open detail pane
 * refetches the trail the moment one lands. Published before the row is
 * written, that refetch can read the trail without the new entry, cache it, and
 * never be told again — the event that would have corrected it has already
 * fired. The window is two round trips wide: `recordActivity` awaits
 * `assistantActor()`, an uncached `findFirst` on the user table, before the
 * insert. `pipeline_changed` is not part of this — it invalidates
 * `pipelineKeys` only, and nothing under that prefix reads the trail.
 *
 * **How the assertion reproduces that.** `publishTicketUpdated` is replaced
 * below with something that does what a subscriber does: read the trail, at the
 * moment the event fires. Prisma promises are lazy, so the read is forced with
 * an explicit `.then` rather than left to be awaited later — awaited later it
 * would report the settled state and pass either way. Both directions are then
 * decided rather than raced: with the row written first the insert has already
 * returned, and with the publish first the read is *issued* before the insert
 * exists at all.
 */

mock.module("../db", () => ({ Prisma, prisma }));

/** The trail as it stood each time `ticket_updated` went out, in order. */
let trailAtPublish: Promise<{ action: string }[]>[] = [];

// Spread into a plain object *now*, before the mock is registered. `mock.module`
// replaces the live namespace, so a factory that spreads the import binding — or
// a wrapper that calls through it — is spreading and calling itself. The real
// function has to be held by value.
const events = { ...(await import("../events/ticket-events")) };
mock.module("../events/ticket-events", () => ({
  ...events,
  publishTicketUpdated: (ticketId: number, fields: TicketEventField[]) => {
    // `.then` rather than a bare call: this has to run now, not when the test
    // gets round to awaiting it. See the header.
    trailAtPublish.push(
      prisma.ticketActivity
        .findMany({ where: { ticketId }, select: { action: true } })
        .then((rows) => rows),
    );
    events.publishTicketUpdated(ticketId, fields);
  },
}));

const classify = { ...(await import("../ai/classify")) };
mock.module("../ai/classify", () => ({
  ...classify,
  // The one path that reaches the classifier's activity write. Nothing here is
  // about the model, so it answers immediately and always the same way.
  classifyTicket: async () => ({
    ok: true as const,
    category: TICKET_CATEGORY.Technical,
  }),
}));

const { CLASSIFY_WORKER } = await import("./classify-ticket");
const { AUTO_REPLY_WORKER } = await import("./auto-reply-ticket");

async function newTicket(status?: TicketStatus): Promise<number> {
  const ticket = await prisma.ticket.create({
    data: {
      subject: "My login is broken",
      customerEmail: "customer@example.com",
      customerName: "Casey Customer",
      ...(status ? { status } : {}),
    },
    select: { id: true },
  });
  return ticket.id;
}

beforeEach(async () => {
  trailAtPublish = [];
  await resetDb();
});

describe("the Activity row lands before ticket_updated", () => {
  test("classification: the category entry is on the trail when the event fires", async () => {
    const id = await newTicket();

    await CLASSIFY_WORKER.handle({ ticketId: id });

    expect(trailAtPublish).toHaveLength(1);
    expect(await trailAtPublish[0]).toEqual([
      { action: TICKET_ACTIVITY_ACTION.category_changed },
    ]);
  });

  test("auto-reply release: the decline entry is on the trail when the event fires", async () => {
    // `onExhausted` is the release path reached without a model: the retry
    // ladder ran out, so the ticket is handed back to `Open` stamped
    // `unavailable`. `release` is the same function every other exit calls.
    const id = await newTicket(TICKET_STATUS.Processing);

    await AUTO_REPLY_WORKER.onExhausted({ ticketId: id });

    expect(trailAtPublish).toHaveLength(1);
    expect(await trailAtPublish[0]).toEqual([
      { action: TICKET_ACTIVITY_ACTION.auto_declined },
    ]);
    // And the entry says which decline it was — the thing the trail exists to
    // carry, and the reason this event is worth publishing at all.
    const entry = await prisma.ticketActivity.findFirst({
      where: { ticketId: id },
      select: { toValue: true },
    });
    expect(entry?.toValue).toBe(AUTO_REPLY_DECLINE.unavailable);
  });

  test("a release that matched nothing publishes nothing and records nothing", async () => {
    // The other half of the invariant, and what makes the ordering worth
    // getting right rather than merely worth having: both the entry and the
    // event are below `count > 0`, so a ticket a recovery sweep already
    // released is neither annotated nor announced. Ordering two things that
    // should not have happened at all would be the wrong fix.
    const id = await newTicket(TICKET_STATUS.Open);

    await AUTO_REPLY_WORKER.onExhausted({ ticketId: id });

    expect(trailAtPublish).toEqual([]);
    expect(await prisma.ticketActivity.count({ where: { ticketId: id } })).toBe(
      0,
    );
  });
});
