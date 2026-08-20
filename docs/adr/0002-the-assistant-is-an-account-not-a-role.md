# The assistant is an account, not a role

Work the desk does by itself is filed under the assistant, which is a user
record flagged as automated rather than a third value alongside admin and agent.
A role decides what an identity may do, and this one may do nothing: it has no
credentials, cannot sign in, cannot be chosen as an assignee, and cannot be
edited or deleted.

## Considered Options

Widening the role union was the obvious path and was rejected: it would have put
a machine into every place the code asks "admin or agent?", the auth
configuration included, in order to describe something that is not a permission
level.

## Consequences

Exactly one such account may exist, and only the seed creates it — the database
cannot express that constraint through the ORM, so the single writer is what
enforces it. Being the assignee of a reply is a different fact from having
written it: machine-written messages record no author, so an agent reading the
thread is told nobody wrote it.

## Amendment (2026-08-20)

"It has no credential record" is no longer a property unique to this account.
Since [ADR-0011](./0011-nobody-types-somebody-elses-password.md), every colleague
is created without one too and gains it by accepting an invitation, so an
invited-but-not-yet-accepted agent looks the same by that test. Nothing above
changes — the controls that actually hold are the `automated` flag, the 403s on
the mutating user routes, and the exclusion from the assignee picker — but the
absent credential is now evidence rather than a guarantee.

That same change opened a route to *creating* the missing credential:
`/request-password-reset` is public, so anyone could name the assistant's
address and mint a link that sets a password on it. `sendResetPassword` in
`auth.ts` refuses `automated` accounts for exactly this reason, and that guard is
the thing standing where "no credential record" used to stand.
