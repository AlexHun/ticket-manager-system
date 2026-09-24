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
descriptions use the glossary in `CONTEXT.md` and respect the ADRs in that
area. Look for prefactoring that makes the rest easy: "make the change easy,
then make the easy change."

## 3. Draft vertical slices

<vertical-slice-rules>

- Each slice cuts a narrow but COMPLETE path through every layer (schema, API, UI, tests).
- A completed slice is demoable or verifiable on its own.
- Each slice fits in a single fresh context window. Its forecast (below) is at most `L`.
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

**Forecast** each ticket's size in turns, then read its `forecast/S|M|L` band
off the table in `docs/agents/issue-tracker.md`. If a ticket forecasts above
`L`, split it.

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
   `gh issue create --title "..." --body-file <file> --label ready-for-agent --label forecast/<S|M|L>`.
2. Add each blocking edge as a native dependency, using the command in
   `docs/agents/issue-tracker.md` (Blocking). The id it takes is the blocker's
   numeric database id, not its `#number`.
3. Read the edges back with
   `gh issue list --json number,blockedBy --jq '.[] | {number, blockers: (.blockedBy.nodes | map(.number))}'`.

Leave any parent issue as it is.

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

## Blocked by

- #<n> for each blocking ticket, or "None — can start immediately".

</issue-template>

Leave out file paths and code snippets, which go stale fast. One exception: a
snippet from a prototype that encodes a decision (a state machine, a schema, a
type shape) more precisely than prose can. Inline only the parts that carry the
decision, and note that it came from a prototype.
