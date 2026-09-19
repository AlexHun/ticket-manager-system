---
max_turns: 10
allowed_tools: [Read, Glob, Grep, Skill]
---

How does this system send outbound email? Specifically: can a route handler call the email provider directly, or is there some kind of queue/outbox in front of it — and which module is the one that actually talks to Postmark?
