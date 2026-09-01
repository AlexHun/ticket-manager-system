---
name: write-a-prd
description: Interview the user, then write a lean one-page PRD to docs/prd/<slug>.md — problem, users, success metrics, scope and non-goals, requirements as testable acceptance criteria, risks, open questions. Use when the user asks for a PRD, a product requirements doc, a feature spec, a product plan or one-pager, wants to scope or shape a feature before building it, or says "plan out <feature>" before any code exists.
---

# Write a PRD

A PRD says **what** and **why**. It never says how. No schemas, endpoints,
component trees or library picks — those are the implementation's call, and
baking them in here freezes decisions before anyone has looked at the code.

Output is one file: `docs/prd/<slug>.md`, from [TEMPLATE.md](TEMPLATE.md).

## Workflow

### 1. Ground yourself before asking anything

Cheap reads first, so the interview isn't naive:

```bash
ls docs/prd/                      # prior PRDs — match their voice and slug style
cat CONTEXT.md 2>/dev/null        # glossary: use its terms, don't invent synonyms
ls docs/adr/                      # read any ADR touching this area
```

Then grep the code for the feature's nouns. **Whatever already exists is not a
requirement** — the PRD covers the gap, not the whole surface.

### 2. Interview — at most two rounds

Use `AskUserQuestion`, ≤4 questions a round, ≤2 rounds. Never open-ended
questionnaires; offer concrete options with a recommendation first. Ask only
what you could not answer from step 1.

Cover, in priority order:

1. **Problem** — who hurts today, and what does the pain cost?
2. **Users** — which role, and what are they trying to finish? This desk has
   exactly two (`admin`, `agent` — `USER_ROLE` in `@ticket/shared`, see
   `docs/standards/domain.md`); the automated assistant is a `User` row, not a
   role, so "the assistant does X" is a requirement about the pipeline.
3. **Success** — the one metric that moves. Push for a number.
4. **Boundaries** — what is explicitly *not* in this pass?

Then draft. Do not ask a third round; put what's left in **Open questions**.

### 3. Write the requirements as acceptance criteria

Every requirement is one testable sentence a QA engineer could pass or fail.

```
✅ An agent can reassign a ticket to any other agent from the ticket detail page.
✅ Reassigning notifies the new assignee by email within 60 seconds.
❌ Improve the assignment experience.          ← untestable
❌ Add an assigneeId column to the Ticket table. ← implementation
```

Number them `R1`, `R2`, … so issues and PRs can cite them. Mark each `Must` or
`Should`; a `Could` belongs in Non-goals this pass.

### 4. Land it on a branch

```bash
git checkout -b docs/prd-<slug>
# write docs/prd/<slug>.md
gh pr create --title "docs(prd): <feature>" --body "..."
```

Never commit a PRD straight to `main` — it is a proposal until someone reviews it.

## Rules

- **Open questions is never empty by omission.** Every assumption you made
  because the user didn't answer goes there, named as an assumption.
- **No invented metrics.** If the user won't commit to a number, write
  `TBD — needs <who>` rather than a plausible-looking one.
- **One PRD, one problem.** If the interview surfaces two, say so and write the
  first; the second becomes its own PRD.
- **Contradicts an ADR?** Surface it in the doc rather than quietly overriding:
  _"Contradicts ADR-0007 — worth reopening because…"_
- Under ~150 lines. If it's longer, it's two PRDs or it's leaking design.

## After it merges

The PRD is the input to tickets, not a substitute for them. Offer to split it
into issues — one per `Must` requirement, each citing its `R<n>` — per
`docs/agents/issue-tracker.md`. Don't create them unasked.
