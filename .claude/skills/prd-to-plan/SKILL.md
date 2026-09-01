---
name: prd-to-plan
description: Turn a PRD into a tracer-bullet implementation plan — an ordered sequence of thin end-to-end slices, each crossing every layer from UI to database and each proved by a passing E2E test — written to docs/plans/<slug>.md. Use when the user has a PRD or spec and wants an implementation plan, asks to break a feature into slices or milestones, mentions tracer bullets, walking skeletons or vertical slices, or asks "how should we build this" for a feature that already has requirements.
---

# PRD to plan, in tracer bullets

A tracer bullet is the **narrowest path that crosses every layer and actually
works**. You fire it early to see where it lands, then keep firing — each shot
wider than the last, all of them in real code you keep.

Output is one file: `docs/plans/<slug>.md`, from [TEMPLATE.md](TEMPLATE.md).
**Plan only** — building happens in a fresh conversation via `one-ticket`.

## What a tracer bullet is not

- **Not a prototype.** A prototype is thrown away; you keep tracer code and
  thicken it. So it ships with the repo's real standards — types, error
  handling, tests. Invoke `coding-standards` before proposing any of it.
- **Not a horizontal layer.** "Schema, then API, then UI" is the failure mode
  this exists to prevent: nothing works until the last step, and every
  integration assumption is discovered at the worst moment.
- **Not a spike.** It answers "do these pieces connect?", not "is this library
  any good?" If a slice's real risk is an unknown, that's a spike — call it one
  and time-box it.

**Slices narrow by breadth, never by depth.** One ticket type, one hardcoded
rule, one seeded user — but a real database, a real endpoint, a real rendered
page. Faking a layer defeats the whole point.

## Workflow

### 1. Read the PRD

```bash
ls docs/prd/                       # find it
cat docs/prd/<slug>.md
```

**No PRD? Stop.** Say so and offer `write-a-prd`. Planning against an
unwritten spec invents requirements, which is the expensive kind of wrong.

Then read `CONTEXT.md`, any ADR in the area, and `docs/standards/` for the
layers involved.

### 2. Map the layers this feature crosses

Only the ones it actually touches. In this repo that's typically:

```
web (React page + react-query)
  → api route (auth / validation)
    → packages/core (domain logic)
      → Prisma / Postgres
        → pg-boss job, outbox, or AI provider  ← if the feature is async
```

An async feature's tracer must reach the far side of the queue, not stop at
enqueue. That hop is exactly where integration assumptions break.

### 3. Design slice 1 — the skeleton

The thinnest observable path through every layer in that map. Ask: *what is the
smallest thing a user could see work end to end?* Hardcode everything else, and
list what you hardcoded — that list becomes slices 2..n.

### 4. Order the rest by risk retired

Earliest slices retire the **most dangerous unknown**, not the easiest work.
Each slice must be independently mergeable and leave `main` shippable.

### 5. Check coverage, then write

Every `Must` requirement in the PRD maps to at least one slice, cited by `R<n>`.
A requirement with no slice is a gap; a slice with no `R<n>` is scope creep —
resolve both before writing the file.

Land it on a branch: `git checkout -b docs/plan-<slug>`, then open a PR.

## The done bar for every slice

**A passing Playwright E2E spec in `tests/e2e/` that drives the whole path.**
Not a unit test, not a manual check — the tracer's value is that the thin path
stays provably alive as later slices thicken it. See the
`playwright-e2e-author` agent for the setup.

A slice you cannot write an E2E test for is not a tracer bullet. It is either
too thin to observe or it doesn't reach the UI — reshape it.

## After it merges

Offer to create an epic issue plus one child per slice, wired with native
dependencies so `one-ticket` can pick the frontier (see
`docs/agents/issue-tracker.md`). Don't create them unasked.
