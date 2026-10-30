---
name: write-a-prd
description: Interview the user, then write a lean one-page PRD to docs/prd/<slug>.md — problem, users, success metrics, scope and non-goals, requirements as testable acceptance criteria, a page's data volume and load and interaction budgets, risks, open questions. Use when the user asks for a PRD, a product requirements doc, a feature spec, a product plan or one-pager, wants to scope or shape a feature before building it, or says "plan out <feature>" before any code exists.
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
cat GLOSSARY.md 2>/dev/null        # glossary: use its terms, don't invent synonyms
ls docs/adr/                      # read any ADR touching this area
```

Then grep the code for the feature's nouns. **Whatever already exists is not a
requirement** — the PRD covers the gap, not the whole surface.

Where a requirement's feasibility rests on what a library or provider actually
supports (can Postmark do this? does Better Auth expose that?), check the
**`context7` MCP** — `resolve-library-id` → `query-docs`, preferred over web
search, per `conventions.md`. A PRD is not the place to specify *how*, but
writing a `Must` the platform cannot do is how a plan dies at slice 1. If
`context7` is unreachable or the answer is genuinely unclear, that goes in
**Open questions** rather than being assumed either way.

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
5. **Volume and budgets**, for a PRD that adds or changes a page: how much
   data the page holds, typical and worst case, and how fast it must first
   load and answer its main interaction (INP). Measure the volume where you
   can, by counting today's rows or files, before you ask. The Sessions page
   was specified with no volume and no budget, passed every check on a
   handful of fixture sessions, and on this machine's 256 a fold blocked for
   1.3 s (#611, #626).

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

A page's budgets are requirements too: each is a `Must` that names the volume
it holds at, and the template's **Volume and budgets** section cites it. That
is what carries a budget into the plan, whose every `Must` maps to a slice,
and from there into a ticket's acceptance criteria.

```
✅ With 300 sessions on the page, folding one answers in under 200 ms (INP).
❌ The page stays fast.                         ← no volume, no number
```

### 4. Land it on a branch

```bash
git checkout -b docs/prd-<slug>
# write docs/prd/<slug>.md
gh pr create --title "docs(prd): <feature>" --body "..."
```

Never commit a PRD straight to `develop` or `main` — it is a proposal until
someone reviews it. Branch from `origin/develop` and open the PR into it.

## Rules

- **Open questions is never empty by omission.** Every assumption you made
  because the user didn't answer goes there, named as an assumption.
- **No invented metrics.** If the user won't commit to a number, write
  `TBD — needs <who>` rather than a plausible-looking one.
- **A PRD that adds or changes a page has its Volume and budgets section
  filled**: the typical and worst-case volume, each marked measured or
  estimated, and a first-load and an INP budget, each an `R<n>`. A number
  nobody will set is `TBD — needs <who>`; the row is never dropped.
- **One PRD, one problem.** If the interview surfaces two, say so and write the
  first; the second becomes its own PRD.
- **Contradicts an ADR?** Surface it in the doc rather than quietly overriding:
  _"Contradicts ADR-0007 — worth reopening because…"_
- Under ~150 lines. If it's longer, it's two PRDs or it's leaking design.

## After it merges

The PRD is the input to the plan, not a substitute for it. Offer `prd-to-plan`
next: it turns each `Must` into a tracer-bullet slice, and tickets are cut from
those slices rather than straight from the PRD. Don't run it unasked.
