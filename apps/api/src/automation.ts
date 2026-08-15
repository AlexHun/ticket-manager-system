import { HANDOFF_TARGET, USER_ROLE, type HandoffTarget } from "@ticket/shared";
import { prisma } from "./db";

/**
 * Who owns a ticket once the assistant is done with it.
 *
 * Two answers, and they are deliberately not symmetrical.
 *
 * **Success is a record.** A ticket the knowledge base answered is assigned to
 * the assistant's own account, always, with nothing to configure. That
 * assignment is not routing — nobody is being asked to do anything — it is the
 * queue saying who dealt with this, in the same column and the same shape as it
 * says a colleague dealt with one. Before it, the automated half of the desk was
 * the half with an empty Assignee cell, which is exactly what an untouched
 * ticket looks like.
 *
 * **A handoff is a decision**, so it is a setting. The auto-reply gives a ticket
 * back far more often than it answers one — most support mail is not a
 * knowledge-base question, six output checks fail closed on the rest, and the
 * provider is sometimes simply down — and until now every one of those landed
 * in `Open` with no owner. `resolveHandoff` is the one place that turns the
 * setting into a user id, because a second implementation would disagree with it
 * on exactly the day somebody was deleted.
 *
 * Neither function may throw. Both are called from a pg-boss handler where a
 * throw means "retry the whole job", and being unable to name an assignee is not
 * a reason to run a model call again — the ticket has already been answered or
 * already been declined by the time these are asked.
 */

/** The columns anything here needs about a user. Never role or ban state. */
const ASSIGNEE_SELECT = { id: true, name: true, email: true } as const;

/**
 * The assistant's identity as an account, which `prisma/seed.ts` creates.
 *
 * **Not** `SUPPORT_EMAIL` from `jobs/auto-reply-ticket.ts`, even though both
 * name the same actor. That one is the From address on the mail this desk will
 * send once Phase 3 lands — a real mailbox, eventually. This one is a login
 * identity for an account that must never be able to log in, so it is pinned to
 * `.invalid`, which RFC 2606 reserves precisely to guarantee it resolves
 * nowhere. Making them one string would mean the day support@ becomes a real
 * address is the day an account in this database is addressable by it.
 */
export const ASSISTANT_EMAIL = "assistant@automation.invalid";
export const ASSISTANT_NAME = "AI Assistant";

/** The singleton row's id. One row, and the default makes the upsert trivial. */
export const SETTINGS_ID = 1;

export interface AutomationUser {
  id: string;
  name: string;
  email: string;
}

/**
 * The assistant's account, or null if this deployment has never been seeded.
 *
 * Null is a real and survivable answer, not an error: the flag arrived after
 * these tickets did, and a database that predates `bun run db:seed` should leave
 * automated tickets unassigned rather than fail the job that resolved them. The
 * `/pipeline` screen reports the absence, which is the place it can be fixed.
 *
 * Ordered, though the seed only ever creates one — see the note on
 * `User.automated` for why the invariant is held by having a single writer
 * rather than by a partial unique index. An `orderBy` costs nothing here and
 * means a hand-inserted second row could not change which account tickets have
 * been filed under.
 */
export async function assistantUser(): Promise<AutomationUser | null> {
  return prisma.user.findFirst({
    where: { automated: true, deletedAt: null },
    select: ASSIGNEE_SELECT,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

/**
 * The longest-serving admin — what `admin` means, resolved when it is needed.
 *
 * By `createdAt`, so it is the account the deployment was seeded with until
 * somebody deliberately removes it, rather than whichever admin was added most
 * recently. `id` breaks the tie, because two admins created in the same
 * millisecond must not swap the target between two tickets.
 */
async function longestServingAdmin(): Promise<AutomationUser | null> {
  return prisma.user.findFirst({
    where: { role: USER_ROLE.admin, deletedAt: null, automated: false },
    select: ASSIGNEE_SELECT,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

export interface HandoffSettings {
  target: HandoffTarget;
  user: AutomationUser | null;
  updatedAt: Date | null;
  updatedByName: string | null;
}

/**
 * Read the settings, treating "no row" as the default.
 *
 * A deployment that has never opened `/pipeline` has no row, and that must mean
 * `admin` rather than an exception in a background worker. Nothing seeds this
 * table for the same reason: a default that only exists once somebody has
 * written it down is a default that can be missed.
 *
 * The named user is loaded through the relation but **not** filtered here. A
 * soft-deleted target still comes back, and `resolveHandoff` is where it is
 * discarded — the settings screen has to be able to say "the person you chose
 * has left", which it cannot do if the read pretends they were never chosen.
 */
export async function readHandoffSettings(): Promise<HandoffSettings> {
  const row = await prisma.automationSettings.findUnique({
    where: { id: SETTINGS_ID },
    select: {
      target: true,
      updatedAt: true,
      updatedByName: true,
      handoffUser: { select: ASSIGNEE_SELECT },
    },
  });

  if (!row) {
    return {
      target: HANDOFF_TARGET.admin,
      user: null,
      updatedAt: null,
      updatedByName: null,
    };
  }

  return {
    target: row.target,
    user: row.handoffUser,
    updatedAt: row.updatedAt,
    updatedByName: row.updatedByName,
  };
}

/**
 * Turn the setting into the person a handed-back ticket is assigned to.
 *
 * The fallbacks are the interesting part, and every one of them ends at an
 * admin or at nobody — never at a stranger and never at the assistant, which
 * would file work as done that nothing is going to do.
 *
 *   - `unassigned` is honoured exactly: the admin chose the old behaviour.
 *   - `user` naming somebody who has since been **soft-deleted** degrades to an
 *     admin. Users here are soft-deleted, so the foreign key's `SetNull` never
 *     fires and the id stays valid-looking forever; `routes/tickets.ts` already
 *     refuses to assign such a user, so honouring it would put tickets on a
 *     person the picker cannot show and the API would not accept.
 *   - `admin` with no admin left — every one soft-deleted — is nobody. It cannot
 *     happen through the API (`DELETE /api/users/:id` refuses admins) but it can
 *     happen in a database, and inventing an owner would be worse than an
 *     unowned ticket that somebody eventually notices.
 *
 * Returns the whole user rather than an id because the settings screen has to
 * show the *consequence* of the choice and not just the choice. `resolveHandoff`
 * below takes the id off it, so the two cannot walk different branches.
 */
export async function resolveHandoffUser(): Promise<AutomationUser | null> {
  const settings = await readHandoffSettings();

  if (settings.target === HANDOFF_TARGET.unassigned) return null;

  if (settings.target === HANDOFF_TARGET.user && settings.user) {
    const live = await prisma.user.findFirst({
      where: { id: settings.user.id, deletedAt: null, automated: false },
      select: ASSIGNEE_SELECT,
    });
    if (live) return live;
  }

  return longestServingAdmin();
}

/** The id of whoever `resolveHandoffUser` named. What the jobs actually write. */
export async function resolveHandoff(): Promise<string | null> {
  return (await resolveHandoffUser())?.id ?? null;
}
