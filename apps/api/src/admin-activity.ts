import { ADMIN_ACTIVITY_ACTION } from "@ticket/shared";
import type { AdminActivityAction, UserRole } from "@ticket/shared";
import { diffToEntries } from "./activity-diff";
import { prisma } from "./db";

/**
 * The account-management audit trail: one row per admin action, written
 * beside the change itself. See the `AdminActivity` model for the shape;
 * this module is only the writer, kept thin because — unlike
 * `ticket-activity.ts` — there is exactly one kind of actor here. Every route
 * that calls into this sits behind `requireAdmin`, so there is no
 * `assistantActor`/`customerActor` split to make.
 *
 * Every row `routes/users.ts` writes goes through `writeAdminActivity`. The
 * four actions used to assemble their own `data` objects at the call sites,
 * which is how the one property this trail has to keep — the target is the
 * account *as it was before the mutation* — came to be enforced by nobody, and
 * how a rename came to be filed under the name it was renamed to.
 */

/** Anything that can write rows: the client, or a transaction handle. */
type ActivityDb = Pick<typeof prisma, "adminActivity">;

/** The admin making the change. Pass `sessionOf(res).user`. */
export interface AdminActor {
  actorId: string;
  actorName: string;
  actorEmail: string;
}

export function adminActor(user: {
  id: string;
  name: string;
  email: string;
}): AdminActor {
  return { actorId: user.id, actorName: user.name, actorEmail: user.email };
}

export interface AdminActivityEntry {
  action: AdminActivityAction;
  fromValue?: string | null;
  toValue?: string | null;
}

/**
 * Write the entries for one admin action.
 *
 * Plural because every real action is: a create writes two rows (the account,
 * and the invitation that goes with it), an edit writes one per field that
 * moved, a resend and a delete write one each. A singular writer left three of
 * the four call sites to build their own `createMany` beside it.
 *
 * `target` is the **account row**, not the two columns the trail stores — the
 * same row the route had to read anyway to decide whether it may act at all.
 * That is the point: what a caller has in hand at that moment is the account
 * before the mutation, which is what the trail is supposed to name. Passing
 * `targetUserId`/`targetUserName` instead let a call site hand over a name off
 * the request body, and `PATCH` did, so a rename was filed against the new name
 * with no way to tell from the row that it had been.
 *
 * Returns the `createMany` rather than awaiting it, so `DELETE` can put it in
 * the `$transaction([…])` that carries the change it describes. The other three
 * callers `await` it like any other write.
 */
export function writeAdminActivity(
  db: ActivityDb,
  actor: AdminActor,
  target: { id: string; name: string },
  entries: AdminActivityEntry[],
) {
  return db.adminActivity.createMany({
    data: entries.map((entry) => ({
      action: entry.action,
      fromValue: entry.fromValue ?? null,
      toValue: entry.toValue ?? null,
      ...actor,
      targetUserId: target.id,
      targetUserName: target.name,
    })),
  });
}

/** The three mutable fields one edit can move, as the trail stores them. */
export interface AdminUserFields {
  name: string;
  email: string;
  role: UserRole;
}

/**
 * What changed between two readings of a colleague's account, as entries.
 *
 * One row per changed field, same reasoning as `ticketChanges`: a PATCH that
 * re-sends the name, email and role a user already has changes nothing, and
 * should write nothing.
 *
 * Two of the three fields share the one `user_edited` action, so their
 * `fromValue`/`toValue` carry the field label inline (`"Name: …"` / `"Email:
 * …"`) to say which one moved. `role` has an action of its own,
 * `role_changed`, so there is nothing left for a label to disambiguate and the
 * bare role reads better in the feed (`agent → admin`) — the same split
 * `TicketActivity` makes, where status/category/assignee each get an action
 * and let the value stand alone.
 */
export function userEditChanges(
  before: AdminUserFields,
  after: AdminUserFields,
): AdminActivityEntry[] {
  return diffToEntries<AdminUserFields, AdminActivityAction>(before, after, [
    { field: "name", action: ADMIN_ACTIVITY_ACTION.user_edited, label: "Name" },
    { field: "email", action: ADMIN_ACTIVITY_ACTION.user_edited, label: "Email" },
    { field: "role", action: ADMIN_ACTIVITY_ACTION.role_changed },
  ]);
}
