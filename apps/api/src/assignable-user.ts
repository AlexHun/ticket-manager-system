// Type-only, and erased at build: at runtime this module imports nothing, so
// no test ever has a reason to mock it (see the registry hazard in
// `docs/standards/testing-api.md`).
import type { Prisma } from "./db";

/**
 * Who a ticket may be handed to: every active user, whatever their role.
 * Admins work tickets alongside agents, so role doesn't narrow this.
 *
 * One definition, used both to build a picker and to validate what comes back
 * from it — otherwise the two drift and the UI offers a choice the API
 * refuses. There are two pickers that hand a ticket to somebody, and both read
 * this: the assignee on a ticket (`routes/tickets.ts`) and who inherits the
 * tickets the assistant hands back (`routes/automation.ts` when the setting is
 * written, `automation.ts` when it is resolved). They were separate copies
 * until #319, and a column added to one was missing from the others.
 *
 * Deleting a user is a soft delete that also bans them, so `deletedAt` already
 * covers "can't sign in". If a standalone ban ever lands, this is the predicate
 * to extend.
 *
 * The assistant is excluded, and that is a narrowing about meaning rather than
 * access. Assigning a ticket is asking somebody to deal with it; the assistant
 * deals with a ticket exactly once, unattended, at the moment it arrives, and
 * has no way to be asked again. It reaches the column from the other side —
 * `jobs/auto-reply-ticket.ts` files a ticket under it after answering — so a
 * ticket can *show* the assistant as its assignee while nobody can *choose* it.
 *
 * A demo visitor is excluded for a reason of its own (#319, R11). They can work
 * a ticket and even reassign one, but nobody may hand a ticket *to* one: every
 * visitor is called "Demo visitor", so a ticket filed under one would read as
 * a colleague's in every trail that names it.
 */
export const ASSIGNABLE_USER = {
  deletedAt: null,
  automated: false,
  isAnonymous: false,
} satisfies Prisma.UserWhereInput;
