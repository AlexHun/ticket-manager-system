---
name: to-tickets
description: Break a plan, PRD or the current conversation into tracer-bullet GitHub issues for this repo, each with native blocking edges and a forecast label. Use when the user wants tickets, issues or a breakdown cut from a plan in docs/plans/ or a PRD, or accepts the offer at the end of prd-to-plan.
---

# To Tickets

Break a plan, spec or conversation into **tickets**, which are tracer-bullet
vertical slices. Each one declares the tickets that **block** it. Adapted from
`mattpocock-skills:to-tickets`, a local copy that the agent and other skills
can invoke and that publishes to this repo's tracker, GitHub
(`docs/agents/issue-tracker.md`).

## 1. Gather context

Work from what is already in the conversation. If the user passes a reference
(a plan path, an issue number or URL), fetch it and read its full body and
comments.

## 2. Explore the codebase

If you haven't already, explore the code the work touches. Ticket titles and
descriptions use the glossary in `GLOSSARY.md` and respect the ADRs in that
area. Look for prefactoring that makes the rest easy: "make the change easy,
then make the easy change."

## 3. Draft vertical slices

<vertical-slice-rules>

- Each slice cuts a narrow but COMPLETE path through every layer (schema, API, UI, tests).
- A completed slice is demoable or verifiable on its own.
- Each slice fits in a single fresh context window: its implementing worker is forecast under 200k tokens of context (below).
- Prefactoring comes first.

</vertical-slice-rules>

Give each ticket its **blocking edges**: the other tickets that must be done
before it can start. A ticket with no blockers can start immediately.

**A wide refactor is the exception to vertical slicing.** It is one mechanical
change, such as renaming a column or retyping a shared symbol, whose blast
radius breaks every call site at once. Sequence it as **expand–contract**:
1. **Expand:** add the new form beside the old.
2. **Migrate:** move call sites over in batches sized by blast radius. Each
   batch is its own ticket, blocked by the expand.
3. **Contract:** delete the old form, in a ticket blocked by every batch.

**Forecast** each ticket's size in turns, the API responses its worker will
make, then size it twice from `docs/agents/issue-tracker.md` (Forecasting an
issue's size): read its peak context off the turns, and split the ticket if
that passes the ceiling, whatever its output band; then read its
`forecast/S|M|L` label off the same turns.

**A ticket that grants an agent permissions is the user's to land.** Auto mode
refuses an agent's edit to the `permissions` rules in `.claude/settings.json`
as self-modification: in #524 the worker's edit and the conductor's were both
refused, while a hook registration in the same file went through. Mark such a
ticket `ready-for-human`, and put the exact rules in its body, so the user can
paste them.

## 4. Quiz the user

Present the breakdown as a numbered list. For each ticket, give:
- **Title**
- **Blocked by**
- **Forecast**
- **What it delivers:** the end-to-end behaviour it makes work

Then ask whether the granularity is right, whether each blocking edge truly
gates its ticket, and whether any ticket should be merged or split. Iterate
until the user approves. Nothing is published before that approval.

## 5. Publish

Publish in dependency order, blockers first, so every edge can name a real
issue:

1. Write each body to a file from the template below. Create the issue with
   `gh issue create --title "..." --body-file <file> --label ready-for-agent --label forecast/<S|M|L>`,
   with `ready-for-human` in place of `ready-for-agent` for a ticket that
   grants an agent permissions.
2. Add each blocking edge as a native dependency, using the command in
   `docs/agents/issue-tracker.md` (Blocking). The id it takes is the blocker's
   numeric database id, not its `#number`.
3. Read the edges back with
   `(gh issue list --json number,blockedBy | ConvertFrom-Json) | Select-Object number, @{n='blockers';e={$_.blockedBy.nodes.number}}`.

If the source was an existing issue, attach each ticket to it as a sub-issue
(`docs/agents/issue-tracker.md`, Make an issue a sub-issue of a parent), and
otherwise leave that issue as it is.

Done when every approved ticket exists with both labels and a body that is not
`@-`, and its blockers read back exactly as the approved list. Report the
frontier: the tickets with no open blocker.

<issue-template>

## Parent

The parent issue or plan (`docs/plans/<slug>.md`), if there is one.

## What to build

The end-to-end behaviour this ticket makes work, from the user's point of view,
not layer by layer.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] The slice's **Budget:** line as the plan states it, when it has one: the
      volume, the first-load target and the INP target, each with its `R<n>`

## Blocked by

- #<n> for each blocking ticket, or "None — can start immediately".

</issue-template>

Leave out file paths and code snippets, which go stale fast. Two exceptions: a
snippet from a prototype that encodes a decision (a state machine, a schema, a
type shape) more precisely than prose can, and the rules a `ready-for-human`
ticket asks the user to paste. Inline only the parts that carry the decision,
and note where a prototype snippet came from.
