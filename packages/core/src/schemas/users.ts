import { z } from "zod";
import { USER_ROLE } from "@ticket/shared";

/**
 * Making a colleague an account.
 *
 * **No password field, deliberately.** An admin used to type one here and tell
 * the new person out of band, which meant every account started life with its
 * password known to somebody who was not its owner — and the same was true again
 * every time one was reset. `POST /api/users` now creates the account without a
 * credential and sends an invitation link, so the first person to know the
 * password is the person it belongs to.
 *
 * That is only survivable because the invitation is written to the outbox
 * whether or not a mail provider is configured; on a deployment with none, an
 * admin reads the link off the screen. See `sendResetPassword` in
 * `apps/api/src/auth.ts`.
 */
export const createUserSchema = z.object({
  name: z.string().trim().min(3, "Name must be at least 3 characters"),
  email: z.email("Enter a valid email"),
});

export type CreateUserValues = z.infer<typeof createUserSchema>;

/**
 * Editing a colleague's account.
 *
 * No password field either, for the same reason, and the replacement is not a
 * different field on this form: it is the invitation link being sent again. A
 * locked-out colleague gets a link to choose their own password rather than an
 * admin choosing one for them.
 *
 * **`role` is required, and only here.** It rides along with name and email
 * rather than getting a partial-update path of its own, so one PATCH is one
 * reading of the whole account and the route can diff every field the same way
 * — which is what keeps the audit trail's "only log what actually moved" rule
 * a single rule (see `userEditChanges`). `createUserSchema` deliberately has no
 * counterpart: a new account is always an `agent` and is promoted, if ever, by
 * a later edit.
 *
 * Who may set it to what is *not* decided here — an admin cannot change their
 * own role, and that is enforced in `PATCH /api/users/:id`, which is the only
 * place that knows who is asking.
 */
export const updateUserSchema = z.object({
  name: z.string().trim().min(3, "Name must be at least 3 characters"),
  email: z.email("Enter a valid email"),
  role: z.enum(USER_ROLE, { error: "Choose a role" }),
});

export type UpdateUserValues = z.infer<typeof updateUserSchema>;
