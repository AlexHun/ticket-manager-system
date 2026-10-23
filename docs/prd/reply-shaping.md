# PRD: The auto-reply's text is shaped in one place, in one order

**Status:** Shipped · **Author:** Aleksei Hunich · **Date:** 2026-10-16

## Problem

The model does not write the whole auto-reply. It returns paragraphs and
steps, and `apps/api/src/ai/auto-reply.ts` turns them into the reply. It
flattens line breaks, strips the greeting and sign-off the model added anyway
(`withoutBookends`), adds our own greeting and sign-off (`composeReply`), and
then takes out every em and en dash (`withoutDashes`, from `ai/provider.ts`).
The dash pass runs last, over the assembled text, and that order is never
written down as a rule.

Four of the last six commits on the file fix that one stretch:

- **#513** (6f327d3, 7d80b34). A sign-off naming the product was not
  recognised, and the reply went out signed twice.
- **#547** (88a960c, ba745ba). A sign-off led by a dash was not recognised,
  because every pattern anchors on the closer's first word. `withoutDashes`
  then took the dash off and shipped the rest under our own sign-off.

#547 fixed sign-offs. The same order still misshapes greetings and steps, and
a probe through `autoReply` on 2026-10-16 found three live cases:

| The model wrote                                     | The customer gets                         |
| --------------------------------------------------- | ----------------------------------------- |
| a step `— Set the quality to Auto`                  | `1., Set the quality to Auto`             |
| `Hi Marta — buffering is almost always the setting` | `Hi Marta,` then `Hi Marta, buffering is` |
| `— Hi Marta,` as its own paragraph                  | `Hi Marta,` twice                         |

None of these is a safety hole. Checks 4–6 still run over the assembled text.
All three reach a customer's inbox once mail sends.

The tests make each fix expensive. Shaping is reachable only through
`autoReply`, so the 23 composing and bookend tests in `ai/auto-reply.test.ts`
(lines 465–931) each script the model through `mock.module("ai")` to test a
string transform.

## Users

The developer and the agents working tickets here. The job: when a new
misshaped reply turns up, add one row to a table and fix it in one module,
without scripting a model call. Customers benefit indirectly: they get one
greeting, one sign-off and clean steps.

## Success metrics

| Metric                                                                     | Today      | Target    |
| -------------------------------------------------------------------------- | ---------- | --------- |
| Known misshaped replies (the three above)                                  | 3          | 0         |
| Composing and bookend tests that mock the `ai` package                     | 23         | 0         |
| _Guardrail:_ every other expected reply in today's composing tests         | green      | unchanged |
| _Guardrail:_ checks 4–6 and the length limit run over the text that's sent | true today | true      |

## Scope

### In this pass

| #   | Requirement                                                                                                                                                                                                                                                                                                                   | Priority |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| R1  | One module turns the model's paragraphs, its steps and the customer's display name into the finished reply text, or into nothing when no content is left. It owns the order of every step, and it adds the greeting and sign-off. `autoReply` composes no text of its own.                                                    | Must     |
| R2  | The three cases above each come out with one greeting, no stray comma and no dash. The step reads `1. Set the quality to Auto`. The welded greeting keeps its sentence, recapitalised, as a comma-closed greeting does today.                                                                                                 | Must     |
| R3  | A table test crosses every greeting and closer the module strips with a hyphen, en dash, em dash and `--`. Each one is tried leading, trailing, welded to a sentence, as its own paragraph, and inside a step. Every row produces exactly one greeting, exactly one sign-off, no em or en dash, and the body sentence intact. | Must     |
| R4  | The length limit and checks 4–6 run over exactly the text the module returned, greeting and sign-off included. The eval harness's `payloadMarkers` are compared against that same text.                                                                                                                                       | Must     |
| R5  | The composing and bookend tests call the module directly, with no `ai` mock. The tests left on `autoReply` cover the prompt, the declines, the length limit, and checks 5 and 6 seeing the assembled text.                                                                                                                    | Must     |
| R6  | A body sentence that only opens with a dash, a greeting word, "Thanks" or the product's name is still kept, as today's tests pin.                                                                                                                                                                                             | Must     |

### Non-goals

- **Polish and summarise.** Both call `withoutDashes` too. Their prompts and
  output stay as they are, and `withoutDashes` stays shared in `ai/provider.ts`.
- **The prompt.** No wording changes. Shaping is code because the prompt
  measurably did not hold. This pass changes no prompt rule.
- **Checks 4–6.** `unbackedCommitments` and `unbackedReferences` and the
  citation resolution do not change, and neither does what they compare
  against (ADR-0004).
- **`greetingName`'s rule.** The display name is still reduced to one name
  token, or to no name, and is never sent to the model. It moves with the
  greeting, and its rule does not change.
- **The other candidates from the 2026-10-16 architecture review.** Each has
  its own PRD.

## Constraints

- **ADR-0004 and `security-auto-reply.md`.** Checks 5 and 6 run over the
  assembled reply, greeting and sign-off included, which is why our sign-off
  carries no address or URL. Moving the shaping must not move the checks onto
  anything earlier.
- **ADR-0017 is about input, not output.** It found that assembling a prompt's
  input is not a module, because deleting one would bring back a single
  `?.trim() || null`. This is the other end of the call. Deleting it brings
  back four ordered passes, and the two-ticket history above is that
  complexity getting out of order. The deletion test passes here.
- **`testing-api.md`.** A module the shaping tests call directly needs no
  `mock.module` registration, which removes one stateful `respond` from the
  registry hazard. The tests that stay on `autoReply` keep the existing
  registration.
- **`OUTPUT_CHECK_DECLINES`** in `@ticket/shared` lists the output checks. This
  pass adds none, so it does not change.

## Risks

| Risk                                                       | Impact                                            | Mitigation                                                                                           |
| ---------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Moving the dash pass earlier changes a reply nobody listed | A customer-visible change hidden in a refactor    | R3's table, plus every expected reply in today's tests held unchanged (guardrail)                    |
| A strip widened for dashes eats a real sentence            | Content lost from a reply that passes every check | R6, and the length guards (`SIGN_OFF_MAX`, the greeting's 30 characters) kept as rules               |
| The checks end up running over pre-shaping text            | A link in our own greeting or sign-off unchecked  | R4, and the existing "holds our own greeting and sign off to the same rule" test kept on `autoReply` |

## Open questions

- [x] Does the dash pass move ahead of the bookend strip, or do the strips
      learn dashes everywhere, as `SIGN_OFF_DASH` did for sign-offs? —
      _affects R1, R2_, decide in the plan. **Decided:** the strips learn the dash, renamed `DASH` (#573).
- [x] **Assumed:** a dash-led step should lose its dash the way a `-`, `*` or
      `•` bullet already does. Held (#573).
- [x] **Assumed:** a final dash pass over the assembled text stays as a
      backstop, so a dash in our own fixed text can never ship either. Held (#573).
- [x] **Assumed:** "reply shaping" needs no `GLOSSARY.md` entry. It is a code
      concept inside the **Auto-reply**, and the desk has no word for it. Held: none was added.
