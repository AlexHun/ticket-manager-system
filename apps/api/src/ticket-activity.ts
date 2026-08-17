import {
  TICKET_ACTIVITY_ACTION,
  TICKET_ACTOR_KIND,
  type TicketActivityAction,
  type TicketActorKind,
} from "@ticket/shared";
import { ASSISTANT_NAME, assistantUser } from "./automation";
import { prisma } from "./db";

/**
 * The ticket audit trail: one row per change, written beside the change itself.
 *
 * Everything here exists to keep two properties, and both are easy to lose:
 *
 *   1. **An entry is written only when the change actually happened.** Most of
 *      the writers are conditional `updateMany` calls whose entire point is that
 *      they may match nothing — the classifier writes only while `category` is
 *      still null, the auto-reply claims only an unassigned ticket, the reopen
 *      fires only on a machine-resolved one. Every call site here is guarded on
 *      `count > 0` for that reason. A trail that records attempts rather than
 *      changes is worse than none: it would say an agent's category was
 *      overwritten by the classifier on precisely the tickets where it wasn't.
 *   2. **The trail outlives the accounts it names.** `actorName` is a copy, not
 *      a join, and an assignee is recorded by name rather than by id — the day
 *      somebody leaves is the day their tickets get read.
 */

/** Anything that can write a row: the client, or a transaction handle. */
type ActivityDb = Pick<typeof prisma, "ticketActivity">;

/**
 * Who is making the change, in the four columns the row stores them in.
 *
 * Built by one of the three constructors below rather than assembled at call
 * sites, because `actorKind` and `actorId` have to agree — an `assistant` entry
 * with an agent's id, or an `agent` entry with no id, is a trail that lies in a
 * way nothing would catch.
 */
export interface TicketActor {
  actorKind: TicketActorKind;
  actorId: string | null;
  actorName: string;
  actorEmail: string | null;
}

/** A signed-in person. Pass `sessionOf(res).user`. */
export function agentActor(user: {
  id: string;
  name: string;
  email: string;
}): TicketActor {
  return {
    actorKind: TICKET_ACTOR_KIND.agent,
    actorId: user.id,
    actorName: user.name,
    actorEmail: user.email,
  };
}

/**
 * The assistant.
 *
 * Falls back to the name alone when the account does not exist — a deployment
 * that has never been seeded still runs the classifier, and "the machine did
 * this, and there is no account row to point at" is both true and more useful
 * than refusing to record it. Same tolerance `assistantUser` itself documents.
 */
export async function assistantActor(): Promise<TicketActor> {
  const assistant = await assistantUser();
  return {
    actorKind: TICKET_ACTOR_KIND.assistant,
    actorId: assistant?.id ?? null,
    actorName: assistant?.name ?? ASSISTANT_NAME,
    actorEmail: assistant?.email ?? null,
  };
}

/**
 * An inbound email did it.
 *
 * No id and no address: there is no account, and the address is already on the
 * ticket and on every message the customer sent. A third copy is a third thing
 * to keep in step.
 */
export function customerActor(customerName: string): TicketActor {
  return {
    actorKind: TICKET_ACTOR_KIND.customer,
    actorId: null,
    actorName: customerName,
    actorEmail: null,
  };
}

export interface ActivityEntry {
  action: TicketActivityAction;
  fromValue?: string | null;
  toValue?: string | null;
}

/**
 * Write one entry.
 *
 * Never throws into the caller's path on its own account — see `recordActivity`
 * below for why that matters when the caller is a queue worker.
 */
export async function writeActivity(
  db: ActivityDb,
  ticketId: number,
  entry: ActivityEntry,
  actor: TicketActor,
): Promise<void> {
  await db.ticketActivity.create({
    data: {
      ticketId,
      action: entry.action,
      fromValue: entry.fromValue ?? null,
      toValue: entry.toValue ?? null,
      ...actor,
    },
  });
}

/**
 * Write one entry from a background job, where a failure must not undo the work.
 *
 * The difference from `writeActivity` is the `catch`, and it is deliberate in
 * exactly one direction. Inside a route the activity row shares a transaction
 * with the change, so both land or neither does and there is nothing to swallow.
 * A job has already resolved the ticket and appended a reply to a customer's
 * thread by the time it records what it did; throwing here would fail the job,
 * and pg-boss delivers at least once, so the retry would find the ticket already
 * resolved and either do nothing or — worse — reason about a state that has
 * moved. A missing audit line is a real cost; a second unattended reply is a
 * much larger one.
 */
export async function recordActivity(
  ticketId: number,
  entry: ActivityEntry,
  actor: TicketActor,
): Promise<void> {
  try {
    await writeActivity(prisma, ticketId, entry, actor);
  } catch (error) {
    console.error(
      `[activity] failed to record ${entry.action} on ticket ${ticketId}:`,
      error,
    );
  }
}

/** The three mutable fields, as the trail stores them: display strings. */
export interface TicketFields {
  status: string;
  category: string | null;
  /** The assignee's *name*, never their id. */
  assignee: string | null;
}

/**
 * What changed between two readings of a ticket, as entries.
 *
 * Returns nothing when nothing moved, which is what keeps a PATCH that re-sends
 * the status a ticket already has out of the trail. An agent pressing Save twice
 * has not changed anything, and a log that says otherwise trains people to
 * distrust it.
 *
 * An array because the shape allows it, not because a route sends two fields
 * today: each of the three PATCH sub-routes writes exactly one. If one ever
 * writes two, this already records both rather than silently picking the first.
 */
export function ticketChanges(
  before: TicketFields,
  after: TicketFields,
): ActivityEntry[] {
  const entries: ActivityEntry[] = [];

  if (before.status !== after.status) {
    entries.push({
      action: TICKET_ACTIVITY_ACTION.status_changed,
      fromValue: before.status,
      toValue: after.status,
    });
  }
  if (before.category !== after.category) {
    entries.push({
      action: TICKET_ACTIVITY_ACTION.category_changed,
      fromValue: before.category,
      toValue: after.category,
    });
  }
  if (before.assignee !== after.assignee) {
    entries.push({
      action: TICKET_ACTIVITY_ACTION.assignee_changed,
      fromValue: before.assignee,
      toValue: after.assignee,
    });
  }

  return entries;
}
