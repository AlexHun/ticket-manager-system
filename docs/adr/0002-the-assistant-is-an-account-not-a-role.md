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
