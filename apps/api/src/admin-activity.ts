import { ADMIN_ACTIVITY_ACTION } from "@ticket/shared";
import type { AdminActivityAction } from "@ticket/shared";
import { diffToEntries } from "./activity-diff";
import { prisma } from "./db";

/**
 * The account-management audit trail: one row per admin action, written
 * beside the change itself. See the `AdminActivity` model for the shape;
 * this module is only the writer, kept thin because — unlike
 * `ticket-activity.ts` — there is exactly one kind of actor here. Every route
 * that calls into this sits behind `requireAdmin`, so there is no
 * `assistantActor`/`customerActor` split to make.
 */

/** Anything that can write a row: the client, or a transaction handle. */
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

/** The account acted on, captured before the mutation touches it. */
export interface AdminActivityTarget {
  targetUserId: string;
  targetUserName: string;
}

export interface AdminActivityEntry {
  action: AdminActivityAction;
  fromValue?: string | null;
  toValue?: string | null;
}

/** Write one entry. */
export async function writeAdminActivity(
  db: ActivityDb,
  actor: AdminActor,
  target: AdminActivityTarget,
  entry: AdminActivityEntry,
): Promise<void> {
  await db.adminActivity.create({
    data: {
      action: entry.action,
      fromValue: entry.fromValue ?? null,
      toValue: entry.toValue ?? null,
      ...actor,
      ...target,
    },
  });
}

/** The two mutable fields `user_edited` covers, as the trail stores them. */
export interface AdminUserFields {
  name: string;
  email: string;
}

/**
 * What changed between two readings of a colleague's account, as entries.
 *
 * One row per changed field, same reasoning as `ticketChanges`: a PATCH that
 * re-sends the name and email a user already has changes nothing, and should
 * write nothing. `fromValue`/`toValue` carry the field label inline (`"Name:
 * …"` / `"Email: …"`) because both fields share the one `user_edited` action —
 * unlike `TicketActivity`, which gives status/category/assignee their own
 * action each and lets the value stand alone.
 */
export function userEditChanges(
  before: AdminUserFields,
  after: AdminUserFields,
): AdminActivityEntry[] {
  return diffToEntries<AdminUserFields, AdminActivityAction>(before, after, [
    { field: "name", action: ADMIN_ACTIVITY_ACTION.user_edited, label: "Name" },
    { field: "email", action: ADMIN_ACTIVITY_ACTION.user_edited, label: "Email" },
  ]);
}
