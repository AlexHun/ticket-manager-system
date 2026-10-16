# PRD: One scripted model for every API test that needs an answer

**Status:** Draft · **Author:** Aleksei Hunich · **Date:** 2026-10-16

## Problem

Four features call the model: classify, auto-reply, polish and summarise. Each
gets it from `openaiModel` in `apps/api/src/ai/provider.ts`. A test that needs
the model to answer stubs something different every time, at a different
depth:

| Test file                                    | Registers                               | Stands for                                   |
| -------------------------------------------- | --------------------------------------- | -------------------------------------------- |
| `ai/auto-reply.test.ts`, `ai/polish.test.ts` | `"ai"`, with `generateText` replaced    | the model's raw answer                       |
| `jobs/activity-before-publish.test.ts`       | `../ai/classify`                        | the classifier's result                      |
| `routes/ai.test.ts`                          | `../ai/polish-reply`, `../ai/summarize` | polish's and summarise's result              |
| `evals/runner.test.ts`                       | `./reply-to-case`, `./classify-case`    | the auto-reply's and the classifier's result |
| `jobs/auto-reply-ticket.test.ts`             | `./auto-reply-steps`                    | the auto-reply's result                      |

That is eight registrations for one fact, "the model answered X". `mock.module`'s
registry is one process wide, so two files that stub the same specifier with
stateful stubs leave one of them inert (#174). The fix each time has been a new
one-function shim, so each test owns a specifier nothing else loads:
`ai/polish-reply.ts`, `evals/reply-to-case.ts`, and the `draftReply` half of
`jobs/auto-reply-steps.ts`. Each is a function, never a re-export (#303), with
a docblock explaining the registry. #303 found 75 failures in reverse file
order, all but one from two registry collisions.

Two costs follow:

- **Tests above the model skip the code just above it.** A test that stubs
  `autoReply`'s result never runs `Output.object` parsing, usage logging, or
  the failure classification a real `generateText` error goes through.
- **`ai/classify.ts` has no test file.** ADR-0017 records why: a third `"ai"`
  registration beside two stateful ones is the registry hazard again.

## Users

The developer and the agents working tickets here. The job: write a test that
needs the model to say something, script the answer, and never think about the
module registry.

## Success metrics

| Metric                                                                         | Today      | Target    |
| ------------------------------------------------------------------------------ | ---------- | --------- |
| `mock.module` registrations that stand for a model answer, outside the preload | 8          | 0         |
| One-function shims that exist only for the registry (the three above)          | 3          | 0         |
| _Guardrail:_ the API suite in CI's forward and reverse file orders             | green      | green     |
| _Guardrail:_ what each moved test asserts                                      | as written | unchanged |

## Scope

### In this pass

| #   | Requirement                                                                                                                                                                                                                                 | Priority |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| R1  | One fake model is registered once, in the test preload, and every feature's model call in the API suite reaches it. A test scripts what the next call answers, or throws, and the script is reset between tests.                            | Must     |
| R2  | With nothing scripted, a model call fails loudly and names the feature that made it. No test silently gets an answer it did not ask for.                                                                                                    | Must     |
| R3  | A test can read what each call was sent: the system prompt, the user prompt and the provider options, so every assertion today's tests make on the prompt still has a home.                                                                 | Must     |
| R4  | The eight registrations in the table are gone. Each test scripts the model instead, and asserts what it asserted before.                                                                                                                    | Must     |
| R5  | `ai/polish-reply.ts`, `evals/reply-to-case.ts` and the `draftReply` half of `jobs/auto-reply-steps.ts` are deleted, and their callers import the feature directly. `readResolveState` stays, because a test interleaves a write through it. | Must     |
| R6  | The API suite is green in both of CI's file orders after each step.                                                                                                                                                                         | Must     |
| R7  | `ai/classify.ts` gets its own test file, covering the prompt and the classifier's result for each kind of answer and failure.                                                                                                               | Should   |
| R8  | `testing-api.md` says where the fake lives and that a model answer is scripted, never registered, and the shims' docblocks are gone with them.                                                                                              | Should   |

### Non-goals

- **The config guards.** `isPolishConfigured`, `isSummarizeConfigured` and
  `isEvalConfigured` stay as ADR-0016 decided. So does `jobs/sweeps.test.ts`'s
  registration of `../ai/provider`, which answers "is AI configured", not "what
  did the model say".
- **`evals/measure-case.ts`.** `jobs/eval-run.test.ts` stubs a whole eval case's
  outcome across many repeats. That is workflow, not a model answer.
- **The E2E suite's fake OpenAI** (`tests/e2e/fake-openai`). It is a separate
  process for a separate suite.
- **The other candidates from the 2026-10-16 architecture review.** Each has
  its own PRD.

## Constraints

- **ADR-0016 is not reopened.** It rejected threading a configuration answer
  through as a value, because "a preload works when there is one right answer
  for the whole process, and every test wants a different answer". The fake is
  that one right answer: one binding for the process, the model, whose script a
  test sets. It is the preload shape ADR-0014 took for the database. No config
  guard changes.
- **ADR-0014 and `testing-api.md`.** The preload already sets a fake
  `OPENAI_API_KEY` and points `OPENAI_BASE_URL` at a closed port, so a call that
  escapes the fake fails rather than reaching OpenAI. That stays.
- **`ai` 7.0.69 ships `MockLanguageModelV4` in `ai/test`**, checked in the
  installed package on 2026-10-16. context7 was unreachable, so its exact
  behaviour is unverified and the plan's first slice confirms it.
- **ADR-0004.** The auto-reply's checks and their tests do not change. Only how
  the test gets the model's answer changes.

## Risks

| Risk                                                                     | Impact                                                     | Mitigation                                                                                        |
| ------------------------------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `maxRetries` and `timeout` are `generateText` options a model never sees | Today's tests on those options lose their direct assertion | R3, plus a behaviour test: a scripted retryable failure is retried once, a slow answer is cut off |
| A scripted retryable failure waits out the SDK's real backoff            | A slower suite                                             | Measured in the first slice. The suite time is reported before and after                          |
| Tests that stubbed a result now script raw output and run more real code | A moved test fails for a reason it never covered           | That reason is a finding, not noise. It is fixed or filed, never hidden by re-stubbing            |
| A test forgets to script and inherits the previous test's answer         | A test passes for the wrong reason                         | R1's reset between tests and R2's loud failure                                                    |

## Open questions

- [ ] Where does the fake attach: `openaiModel`, or the provider object it
      builds? — _affects R1_, decide in the plan
- [ ] Is a call routed to its feature by the model id, or by order? Several
      tests make a classify call and an auto-reply call in one flow. —
      _affects R1, R4_, decide in the plan
- [ ] **Assumed:** a model call that escapes the fake still fails at the closed
      port, so nothing reaches OpenAI even if R1 has a gap.
- [ ] How does `provider.test.ts` still test the real `openaiModel` once the
      preload replaces the model for the whole process? — _affects R1_,
      decide in the plan
