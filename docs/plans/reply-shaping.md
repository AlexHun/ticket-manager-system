# Plan: The auto-reply's text is shaped in one place, in one order

**PRD:** [docs/prd/reply-shaping.md](../prd/reply-shaping.md) · **Status:** Draft · **Date:** 2026-10-16

## Layers crossed

```
jobs/auto-reply-ticket.ts, evals/runner.ts       (callers, unchanged)
  → ai/auto-reply.ts  autoReply: prompt, model call, length limit, checks 4–6
    → new: ai/reply-shape.ts  shapeReply(customerName, paragraphs, steps) → string | null
                              greetingName, flatten, withoutBookends, composeReply, final dash pass
      → ai/provider.ts  withoutDashes (shared with polish and summarise, unchanged)
```

No route, schema, database or UI layer is involved. The reply text a ticket's
thread receives is the only output that changes, and only for the PRD's three
cases.

## The done bar, and why it changes here

The skill's bar is a Playwright spec per slice. No spec can drive this path:
the auto-reply runs only after a real model call, and the E2E stack runs with no
model. `testing-api.md`'s preload points `OPENAI_BASE_URL` at a closed port for
the same reason. The module is pure, so its tests are the strongest bar
available, and `pre-push` runs them. Each slice is done when:

- `bun test src/ai` is green, and the full API suite passes on `git push`;
- every expected reply in today's composing and bookend tests is unchanged,
  apart from the rows the PRD names (the guardrail);
- an eval run from `/evals` is not required. The harness calls the same
  `autoReply`, and R4's test holds that it sees the shaped text.

## Slice 1 — The shaping moves into one module, unchanged

**Retires:** whether the shaping comes out cleanly. Do checks 4–6 and the eval
harness still see the exact text they see today? **Covers:** R1, R4, R5

- `ai/reply-shape.ts` exports one function, `shapeReply`. It takes the
  customer's display name, the model's paragraphs and its steps, and returns
  the finished reply or `null`. `greetingName`, `flatten`, `withoutBookends`,
  `composeReply`, their patterns and the `withoutDashes` call on the assembled
  text move into it, in today's order. Nothing else is exported.
- `autoReply` calls `shapeReply` where it calls `composeReply` and `withoutDashes`
  today. The `null` branch, the length limit and checks 4–6 stay in
  `autoReply`, over the returned string.
- Of the 23 tests in the composing and bookend blocks, these move to
  `ai/reply-shape.test.ts`, with no `ai` mock and their expected strings
  unchanged: every test that asserts on `result.reply`, and the "bookends were
  the whole of the answer" case as `shapeReply` returning `null`.
- Three stay on `autoReply`, because they test the prompt or a decline:
  "tells the model not to sign as the product either", "declines when it said
  yes and then wrote nothing", and "discards a reply longer than a message may
  be". So does one end-to-end case per kind: a reply whose greeting comes from
  `customerName`, and check 6's "holds our own greeting and sign off to the same
  rule" (R4).
- `security-auto-reply.md` names `composeReply` and `greetingName` and says the
  hostile-name cases are pinned in `ai/auto-reply.test.ts`. Those references
  move to the new files in the same PR.

**Hardcoded for now:** today's order, and with it the PRD's three misshaped
replies.

**Done:** the bar above. The moved tests pass with byte-identical expected
strings, and the `ai/auto-reply.test.ts` composing blocks shrink to the cases
listed.

## Slice 2 — One order, and the table that holds it

**Retires:** the class #513 and #547 belong to. **Covers:** R2, R3, R6

- **The open question, decided:** the strips learn the dash. The dash pass does
  not move ahead of them. Measured by hand against `TRAILING_SIGN_OFF`: run
  first, `withoutDashes` turns "…closer look. — Best regards" into "…closer
  look., Best regards". That no longer matches the sentence-end anchor, and the
  welded sign-off would ship. So `SIGN_OFF_DASH` reaches the places it does
  not reach yet. A leading dash is looked past before the greeting test. A dash
  closes a greeting, as a comma does. A dash-led step loses it the way a `-`,
  `*` or `•` bullet does. The final `withoutDashes` over the assembled text
  stays as the backstop (PRD assumption).
- The PRD's three cases are written as failing tests first, then fixed.
- R3's table is one test in `ai/reply-shape.test.ts`. It crosses every greeting
  `GREETING_LINE` names and every closer the existing dash test lists with
  hyphen, en dash, em dash and `--`. It tries each one leading, trailing,
  welded to a sentence, as its own paragraph, and inside a step. Each row
  asserts one greeting, one sign-off, no em or en dash, and the body sentence
  intact. It replaces the per-shape dash tests it subsumes, and those tests'
  rows join the table.
- R6's keep-cases (a sentence that opens with a dash, a greeting word,
  "Thanks" or the product's name) stay as named tests, because a table row
  failing says less than a named test failing.

**Done:** the bar above, with the three PRD cases red before and green after.
The table is mutation-checked: removing one dash form from a pattern turns it
red, and the PR records which row it named.

## Requirement coverage

| Req | Slice | Note                                         |
| --- | ----- | -------------------------------------------- |
| R1  | 1     |                                              |
| R2  | 2     | red first                                    |
| R3  | 2     | one table test                               |
| R4  | 1     | the check-6 own-sign-off test on `autoReply` |
| R5  | 1     |                                              |
| R6  | 2     | named tests, not table rows                  |

## Spikes

None. The open question was settled by reading `TRAILING_SIGN_OFF` against
`withoutDashes`, above. Slice 2's first red test confirms it.

## Deferred

- **Polish and summarise** (PRD non-goal). Their `withoutDashes` calls are
  untouched.
- **A seam for a scripted model** in the tests left on `autoReply`. That is the
  next PRD's subject (candidate 4), and it takes those tests as they are.
