# This app does not verify email addresses

`emailVerified` is set true when an account is created and is never read to
decide anything. There is no verification flow, no verification email, and no
badge on the roster. Sign-up is disabled, an admin creates every account, and
the address they type is one they already know — verification would prove
control of a mailbox that a colleague has already vouched for in person.

## Considered Options

**Building the flow** was rejected as ceremony: the only party who could fail
the check is an admin mistyping a colleague's address, which is caught the
moment that colleague says the invitation never arrived.

**Verifying only on an email *change*** is the defensible middle, and is the one
to revisit if this app ever opens sign-up. It was rejected for now because it
builds a whole flow for an action that happens roughly never.

## Consequences

The column stays because Better Auth owns the schema, and it is forced true so
it cannot mean anything by accident. Before this decision it defaulted **false**
on every account `POST /api/users` created and nothing anywhere could set it
true — so the roster drew a permanent "Unverified" warning against every real
colleague, and a clean "Verified" tick against the assistant, the one account
with no mailbox at all. That badge is gone.

Turning on Better Auth's `requireEmailVerification` against a database seeded
before this change would lock out every account created by the old route. If
this is ever revisited, backfill the column first.
