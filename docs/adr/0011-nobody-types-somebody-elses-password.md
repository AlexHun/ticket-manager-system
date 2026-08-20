# Nobody types somebody else's password

Accounts are created without a credential, and the person who ends up knowing
the password is the person it belongs to. `POST /api/users` calls Better Auth's
`createUser` with no password at all and then triggers the password-reset flow;
the new colleague follows a link and chooses their own. Recovery is the same
mechanism through a different door, and so is the resend at
`POST /api/users/:id/invite`. There is no password field on either user form any
more, and `setUserPassword` is no longer reachable from the API.

## Considered Options

**Keeping the admin-typed field alongside an invitation flow** was rejected
because it makes the invitation decorative. Every account would still start life
with its password known to somebody who is not its owner, and every reset would
do it again — which is the whole problem being solved.

**A separate invitation token table** was rejected in favour of reusing the
reset token. Better Auth's own guidance for a user with no credential account is
to send them through the forgot-password flow, so the two flows are one
mechanism with different words. The cost is a shared
`resetPasswordTokenExpiresIn`, set to **24 hours** — an hour is right for a
reset and wrong for an invitation somebody reads the next morning, and a day is
unremarkable for a single-use token mailed to the account's own address.

## Consequences

**Which flow an email is, is derived rather than signalled.** An invited
colleague has no `credential` account row and someone who forgot their password
does; `sendResetPassword` reads that and picks the wording. No caller has to
carry the distinction, and it stays correct in the awkward case — an invited
user who never accepted and then clicks "forgot password" is still being
invited, and is still told so.

**This depends on the outbox being readable.** With no mail provider bound,
[ADR-0009](./0009-outbound-email-goes-through-a-transactional-outbox.md) makes
`/outbox` the delivery mechanism. Removing admin-typed passwords without that
screen would leave no way for anyone to obtain a password at all.

**It opened a hole in the assistant's isolation, which is closed in the same
place.** `/request-password-reset` is public, so anyone could type the
assistant's address and mint a link that creates the credential row that account
deliberately lacks — making it signable-in, which is exactly what
[ADR-0002](./0002-the-assistant-is-an-account-not-a-role.md) exists to prevent,
reached by a route that never touches `routes/users.ts`. `sendResetPassword`
therefore refuses any account that is `automated` or soft-deleted. That guard is
load-bearing; do not remove it when refactoring the callback.
