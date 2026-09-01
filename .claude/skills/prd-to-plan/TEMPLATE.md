# Plan: <Feature name>

**PRD:** [docs/prd/\<slug\>.md](../prd/<slug>.md) · **Status:** Draft · **Date:** <YYYY-MM-DD>

## Layers crossed

```
web (<page or component>)
  → api (<route>)
    → core (<module>)
      → db (<model>)
        → <queue / outbox / provider, if async>
```

Name the actual files or modules where they already exist. If a layer doesn't
exist yet, say `new:` — that's where the risk is.

## Slice 1 — <the skeleton, in five words>

**Retires:** <the riskiest unknown this proves or kills>
**Covers:** R1

The thinnest observable path through every layer above.

- <what a user can do at the end of this slice, in one sentence>

**Hardcoded for now:** <each shortcut, one per line — this list is slices 2..n>

**E2E:** `tests/e2e/<name>.spec.ts` — <the assertion that proves the path is alive>

## Slice 2 — <name>

**Retires:** <unknown> · **Covers:** R2, R3
**Un-hardcodes:** <which slice-1 shortcut this removes>

- <observable change>

**E2E:** <spec + assertion, or "extends slice 1's spec with …">

## Slice 3 — <name>

…

## Requirement coverage

| Req | Slice | Note |
| --- | ----- | ---- |
| R1 | 1 | |
| R2 | 2 | |
| R3 | 2 | |
| R4 | — | **Gap** — needs a slice, or moves to a follow-up PRD |

Every `Must` needs a slice. Every slice needs a requirement.

## Spikes

Time-boxed unknowns that are *not* slices — a question to answer, not a path to
build. Drop the section if there are none.

- **<question>** — timebox <n>h, blocks slice <n>

## Deferred

What this plan deliberately does not build, and which PRD non-goal or
requirement it maps to. Keeps the next reader from assuming it was forgotten.
