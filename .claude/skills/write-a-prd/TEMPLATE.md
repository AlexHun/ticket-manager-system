# PRD: <Feature name>

**Status:** Draft · **Author:** <name> · **Date:** <YYYY-MM-DD>

## Problem

Two to four sentences. Who hurts today, what they do instead, and what that
workaround costs. No solution language here.

## Users

Which role this is for (`admin`, `agent`, …) and the job they are trying to
finish. If a change affects two roles differently, say how for each.

## Success metrics

| Metric | Today | Target |
| ------ | ----- | ------ |
| <the one number that moves> | <baseline, or `unknown`> | <target, or `TBD — needs <who>`> |

One primary metric. At most two supporting ones. A guardrail metric — the thing
that must *not* get worse — if there is an obvious one.

## Scope

### In this pass

| # | Requirement | Priority |
| - | ----------- | -------- |
| R1 | <one testable sentence a QA engineer could pass or fail> | Must |
| R2 | … | Must |
| R3 | … | Should |

### Non-goals

- <thing a reader would reasonably expect here> — because <reason>
- …

Be specific. "Out of scope: everything else" tells a reader nothing; naming the
three things they were about to assume saves the argument later.

## Constraints

Anything that narrows the solution space and is *not* negotiable: an existing
ADR, a compliance rule, a deadline, a system the feature must not touch. Skip
the section if there are none — don't pad it.

## Risks

| Risk | Impact | Mitigation |
| ---- | ------ | ---------- |
| <what could go wrong> | <who it hurts, how badly> | <what we'd do> |

## Open questions

- [ ] <question> — *blocks R2*, needs <who>
- [ ] **Assumed:** <assumption made because it went unanswered> — confirm with <who>

Every unanswered interview question and every assumption you made lands here.
An empty section means every question was actually answered, not that none were
asked.
