---
type: llm
weight: 1
---

The question is "how is X done here" — a question, not a change — so per the
skill's own process it should be answered by reading the single narrowest
matching file, `docs/standards/backend.md`'s "outbound mail" row, not every
standards file.

A successful response:

- Says every outbound email goes through an outbox — a route or job never
  calls the email provider directly.
- Names `enqueueEmail` (in `jobs/send-email.ts`) as what writes the
  `OutboundEmail` row inside the caller's own transaction, with a worker
  making the actual network call afterward.
- Names `mail/transport.ts` as the only module that ever speaks to Postmark.
- Does not claim any other module (a route handler, a job file other than
  `send-email.ts`) sends mail directly.

A response that answers generically from general web/framework knowledge
without grounding in this repo's actual file and function names should score
low, even if the shape of the answer ("use a queue") happens to be right.
