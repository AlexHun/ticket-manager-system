# Plan: One scripted model for every API test that needs an answer

**PRD:** [docs/prd/scripted-model.md](../prd/scripted-model.md) · **Status:** Draft · **Date:** 2026-10-16

## Layers crossed

```
test files  ai/*.test.ts, routes/ai.test.ts, jobs/*.test.ts, evals/runner.test.ts
  → new: src/test/model.ts   the fake: script(), calls(), reset; one registration, in the preload
    → ai/provider.ts  openaiModel(id) → the fake's MockLanguageModelV4 (ai/test) in tests
      → real generateText, Output.object, usage, retries   (classify, auto-reply, polish, summarise)
```

No route, schema, database or UI layer changes. Production code changes in
only two ways: the shims R5 deletes, and whatever `provider.ts` needs so the
preload can attach.

## The done bar, and why it changes here

The skill's bar is a Playwright spec per slice. This is the API suite's own
machinery, with nothing a browser can see, so as in
`docs/plans/doc-citations.md` each slice is done when:

- the API suite is green in CI's forward and reverse file orders (R6). The
  reverse order is the one that caught #303;
- every moved test asserts what it asserted before. Where an assertion
  changed shape, the PR lists it, old line beside new;
- the suite's wall time is reported before and after.

## Slice 1 — The fake, and polish on it

**Retires:** what `MockLanguageModelV4` does in this SDK. How does a scripted
retryable failure interact with the real backoff? How do `maxRetries` and
`timeout` get asserted once nothing sees them? How does `provider.test.ts`
keep the real `openaiModel`? **Covers:** R1, R2, R3, R6, and R4 and R5 for
polish

- **The attach point, decided:** `openaiModel`. It is the one function all four
  features call, and replacing what it returns leaves `generateText` real. The
  preload replaces `../ai/provider` with the real module spread, plus
  `openaiModel` returning the fake. `jobs/sweeps.test.ts` already registers
  that specifier, with state, so the slice moves its `isAiConfigured` switch
  onto the preload's registration as well. Two boxes on one specifier is #174.
  The plan accepts that this touches a config switch's home and leaves its
  answer alone, which ADR-0016 allows. If the spike finds a cleaner seam
  (a test-only setter on `provider.ts`), take it and say why in the PR.
- **Routing, decided:** by model id. Each feature calls `openaiModel` with its
  own id, so a test scripts per feature (`script("classify", …)`), and a flow
  that makes two calls gets each one's answer whatever the order.
- `src/test/model.ts` owns the script, the recorded calls (prompt, system,
  provider options) and a reset the preload runs before every test. An
  unscripted call throws an error naming the model id (R2).
- `ai/polish.test.ts` drops its `"ai"` registration. `routes/ai.test.ts`'s
  `../ai/polish-reply` registration shrinks to `isPolishReplyConfigured`, and
  `polishReply` is deleted. The route calls `polishDraft` directly.
- `provider.test.ts` tests the real `openaiModel`, through whatever the spike
  chose: the module's own import before the preload's replacement, or the
  test-only setter.

**Hardcoded for now:** auto-reply, classify and summarise keep their stubs.

**Done:** the bar above. The PR records three spike answers: the
`MockLanguageModelV4` shape used, the measured retry delay with what was done
about it, and how `maxRetries` and `timeout` are now proven.

## Slice 2 — The auto-reply on the fake

**Retires:** whether the fake can carry `ai/auto-reply.test.ts`, the file that
scripts the most answers. **Covers:** R4 and R5 for the auto-reply

- Starts after #572 merges. That ticket moves the composing tests out of
  `ai/auto-reply.test.ts`, and the two would otherwise edit the same blocks.
- `ai/auto-reply.test.ts` drops its `"ai"` registration and scripts the fake.
- `jobs/auto-reply-ticket.test.ts`'s registration shrinks to the
  `readResolveState` wrapper. `draftReply` is deleted, and the job calls
  `autoReply` directly.
- `evals/runner.test.ts` drops `./reply-to-case`, and `evals/reply-to-case.ts`
  is deleted.

**Done:** the bar above.

## Slice 3 — Classify and summarise on the fake

**Retires:** a flow that calls two features, which is the runner's classify,
then reply. **Covers:** R4 for the rest, R7, R8

- `evals/runner.test.ts` drops `./classify-case`. `classify-case.ts` stays,
  since it holds real logic (`isClassifiable`, `categoryOf`).
- `jobs/activity-before-publish.test.ts` drops `../ai/classify` and scripts
  the classifier's answer.
- `routes/ai.test.ts`'s `../ai/summarize` registration shrinks to
  `isSummarizeConfigured`.
- `ai/classify.test.ts` is written: the prompt, and the result for an answer, a
  refusal, an empty output and each provider failure (R7).
- `testing-api.md` gains the fake's section, and the deleted shims' docblocks
  go with them (R8).

**Done:** the bar above, with the PRD's metric at 0 and its three shims gone.

## Requirement coverage

| Req | Slice   | Note                                            |
| --- | ------- | ----------------------------------------------- |
| R1  | 1       | attach at `openaiModel`                         |
| R2  | 1       |                                                 |
| R3  | 1       |                                                 |
| R4  | 1, 2, 3 | polish, auto-reply, then classify and summarise |
| R5  | 1, 2    | `polishReply`; `draftReply` and `reply-to-case` |
| R6  | 1, 2, 3 | every slice                                     |
| R7  | 3       | Should                                          |
| R8  | 3       | Should                                          |

## Spikes

- **`MockLanguageModelV4` against `generateText` with `Output.object`, a
  thrown `APICallError` and a slow answer.** Timebox 1h, the first hour of
  slice 1. context7 was unreachable when the PRD was written, so nothing about
  the class has been verified past its presence in `ai/test`. If it cannot
  carry a structured answer, the fake is a hand-written `LanguageModelV4`
  instead, and the PR says why.

## Deferred

- **`evals/measure-case.ts`** and `jobs/eval-run.test.ts` (PRD non-goal).
- **The config guards' own registrations** (ADR-0016).
