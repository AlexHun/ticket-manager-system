/**
 * How long an auth link works for — the one number `auth.ts` and the outbox
 * retention sweep have to agree on, in a module either can load.
 *
 * **Why it is not in `auth.ts`.** It was, and the coupling below is the whole
 * point of it being one constant rather than two. But `auth.ts` calls
 * `betterAuth()` at import and throws without `TRUSTED_ORIGINS` and a 32-char
 * `BETTER_AUTH_SECRET`, so no unit test can load it — `routes/users.test.ts`
 * replaces the whole module with a fake, and `mock.module`'s registry is one
 * process wide. Any module that reached this constant through `auth.ts` was
 * therefore one file-ordering away from linking against that fake and failing
 * with `SyntaxError: Export named 'RESET_TOKEN_TTL_SECONDS' not found` — which
 * is exactly what `jobs/prune-outbox.ts` did the first time a test imported it
 * (#158), green locally and red on CI, because the two disagreed about which
 * file ran first.
 *
 * A leaf with no imports cannot be worth mocking, so nothing mocks it, so this
 * cannot happen again. Keep it that way: no dependencies here, ever.
 */

/**
 * How long a password-reset or invitation link works for.
 *
 * Twenty-four hours, and the number is a compromise between two flows that
 * share one setting. Better Auth has a single `resetPasswordTokenExpiresIn`,
 * and this app puts two things through it — a password reset and an invitation
 * (see `sendResetPassword` in `auth.ts`, which is both). An hour is the
 * sensible default for a reset and plainly wrong for an invitation: a new
 * colleague who reads their mail the next morning would find their first
 * contact with this system is a dead link. A day is unremarkable for a
 * single-use token mailed to the account's own address, and it keeps the two
 * flows on one mechanism rather than growing a second token table to hold a
 * different number.
 *
 * **The outbox retention sweep is measured against it.** The body of an
 * invitation row is that link and nothing else, so the row stops being useful
 * at exactly the moment the token dies — see `AUTH_MAIL_RETENTION_MS` in
 * `jobs/prune-outbox.ts`, which reads this rather than restating it. Raising
 * the number here lengthens how long those rows are kept, automatically, which
 * is the correct coupling: a link that still works must still be readable.
 */
export const RESET_TOKEN_TTL_SECONDS = 60 * 60 * 24;
