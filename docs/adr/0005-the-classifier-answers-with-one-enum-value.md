# The classifier answers with one enum value

Classification is the only AI feature with no person present at the moment it
runs, on text a stranger emailed in. Its entire output is one category from a
fixed set, enforced by the provider's own strict schema, so total failure of the
prompt equals one mis-filed ticket: nothing anyone reads, nothing sent to a
customer, no change to status, assignee or content, and one click to correct.

## Consequences

Do not widen this output. A free-text field here — a reason, a suggested reply,
a tag — would hand unattended stranger-written text a way into the product, and
the argument for running this with nobody watching collapses. Two further
properties belong to the same decision and must survive any rewrite: a human's
filing is never overwritten, and the ticket row rather than the job is the
source of truth, which is what makes at-least-once job delivery harmless.
