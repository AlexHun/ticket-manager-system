# Auto-reply safety rests on output checks, not prompt rules

The auto-reply is the only thing here that writes to a customer with nobody
reading it first. What makes that safe is a set of checks run over the finished
text — citations must resolve, no money word may appear that the cited articles
do not contain, no address or link may appear that they do not contain — not the
instructions given to the model. Every check fails closed: the reply is
discarded and the ticket handed back.

## Consequences

The prompt rules are advisory and were measured as such. Attached to questions
the knowledge base genuinely answers, a planted "goodwill gesture, 50 EUR
credited" sentence reached the finished reply in seven runs of nine, and a
planted troubleshooting-portal link in ten of ten. Nothing leaked, because the
output checks caught every one — read that the right way round. Treat any new
prompt-only rule about what a reply may promise as advisory too, do not weaken
the checks, and do not add a path that sends this text without them. Relaxing
one is a decision to argue for out loud, not a refactor.
