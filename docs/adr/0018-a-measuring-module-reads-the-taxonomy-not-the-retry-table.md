# A measuring module reads the failure taxonomy, not the retry table

The eval runner's interface stays as it is. It cannot usefully shrink, and the
reason is that the five vocabularies the issue counted are **imports, not
interface**: the module's one production caller learns three, and two of the
three it would have to learn anyway to call the module at all.

What changes is the import that was both a leak and **wrong**. `evals/runner.ts`
was asking `isRetryable` — the queue's retry table — to answer a question about
whether the model was asked, and the two questions disagree on three of the eight
failure reasons. Measured: an expired key, an exhausted account, or a knowledge
base with nothing auto-replyable left in it produced five `declined` repeats per
case, `abandoned: 0` beside them, and a board reporting a deployment fault as the
model getting everything wrong.

Answered from a spike ([#211](https://github.com/AlexHun/ticket-manager-system/issues/211)),
by walking the taxonomy rather than reading the comments. It is the speculative
one of the six, and the speculation was half right: nothing needed extracting,
and one of the two suspect imports was hiding a defect.

## The interface is three names, not five vocabularies

`evals/runner.ts` exports six things. The one module in production that imports
it, `jobs/eval-run.ts`, takes three:

| export               | production callers                                          | in a signature?                                                               |
| -------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `runCase`            | `jobs/eval-run.ts:215`                                      | `(KbArticle[], AutoReplyCase, number?, AbortSignal?) => EvalCaseOutcome`      |
| `expectedCategoryOf` | `jobs/eval-run.ts:230`                                      | `(AutoReplyCase) => TicketCategory \| null`                                   |
| `EVAL_REPEATS`       | `jobs/eval-run.ts:15`, re-exported at `:357`                | a number                                                                      |
| `EvalCaseOutcome`    | the type `runCase` returns                                  | `EvalCaseCounters` + `EvalVerdict[]`                                          |
| `EvalVerdict`        | reached through `EvalCaseOutcome.verdicts`                  | `PipelineOutcome`, `AutoReplyDecline`, `TicketCategory`, booleans, one number |
| `answerCase`         | **one**: `runCase`, twelve lines further down the same file | `(KbArticle[], AutoReplyCase, AbortSignal?) => EvalVerdict`                   |

Read the right-hand column. `AutoReplyResult` is not in it. Neither is `AiUsage`,
and neither is anything from `jobs/`. The module takes a corpus and a case and
answers in `@ticket/shared`'s own vocabulary — `PipelineOutcome`,
`AutoReplyDecline`, `TicketCategory`, and the counter block `EVAL_COUNTERS`
already names. Of the two types a caller must learn that are not
`@ticket/shared`'s, `KbArticle` is what `jobs/eval-run.ts` builds anyway in
`corpusFor` and `AutoReplyCase` is what it resolves anyway through
`autoReplyCaseById`. **A caller learns nothing to call this module that it did
not already have in its hands.**

So the concentration the issue was asking for is already done, and the place it
is done is `verdictOf` and the two tallies: three model-shaped failure modes and
a token count go in, `abandoned`/`declined`/`resolved` and a rate come out. That
is the module being deep. Counting its `import` lines measures how much of the
codebase it reaches into, which is a different property and not the one an
interface has.

### `answerCase` is a seam, and it stays exported

One production caller, in the same file, twelve lines down. Twenty-six call sites
in `runner.test.ts`. On the numbers it is a test-only export, and the narrowing
is mechanical — `await answerCase(A, c)` becomes
`(await runCase(A, c, 1)).verdicts[0]!` at every one of them.

Rejected, for a reason worth writing down rather than the tidiness one. What
`runner.test.ts` is about is the **translation** — an `AutoReplyResult` into an
outcome, an outcome into a match — and `answerCase` is that translation, one
repeat at a time. Routing twenty-six single-repeat assertions through a
five-repeat tally to reach `verdicts[0]` does not make the interface narrower for
anybody who is not already reading this file; it makes every assertion in it
indirect and buys one export. The genuine gain would be invariants 1 and 2 below
becoming unreachable by construction, and both of them are already unreachable
for the caller that exists.

## The four invariants, one at a time

**Repeats run in series.** Already structural, and not a caller's burden.
`runCase` owns the loop, the loop is `await` inside `for`, and there is no
parameter through which a caller could ask for anything else. The prose is not
holding the invariant up — it says _why_, which is the part that would otherwise
be lost: the prompt-cache measurement, not politeness to the provider. Keep it as
prose. `answerCase` being exported means a caller could in principle write a
parallel loop of its own; none does, and the section above is why that is not
worth closing.

**Nothing may vary between repeats.** Also already structural. `runCase` hands
`answerCase` the identical three arguments every iteration, and `answerCase`
derives its prompt from nothing else — no run id, no timestamp, no counter exists
in the module to leak into one. But the prose must stay, because it is a
**prohibition on future edits** rather than a description of the present, and no
type says "do not add a timestamp here." It is asserted rather than only argued:
`runner.test.ts`'s _"does not vary between repeats"_ compares three consecutive
contexts.

**The first repeat is never counted as a cache hit.** The one that is a real
interface hazard, and it is not in `runCase`'s signature — it is that the rule is
written **twice, in two modules, across a database**. `runCase` applies it with
`verdicts.slice(1)`; `routes/evals.ts:674` re-derives the matching denominator as
`Σ max(repeats − 1, 0)` over the stored rows, because the run-level `cacheable`
is summed after storage and cannot come from a per-case return value. Two
expressions of one rule that must agree and that nothing makes agree. Not
closeable by narrowing this interface; closeable by making `cacheable` a counter
the runner emits per case, which is a change to `EVAL_COUNTERS` and a migration,
not a change to a function. Filed as
[#223](https://github.com/AlexHun/ticket-manager-system/issues/223).

The second half of it — `EvalCaseOutcome` carrying both `cachedRepeats` and the
raw `verdicts[].cached` a reader could re-tally wrongly — is deliberate and
stays. The per-repeat flag is diagnostic and the verdicts are stored whole in a
column of their own precisely so a run can be read back repeat by repeat.

**`classifiedRepeats` is a shrinking denominator, not a miss count.** Not this
module's invariant, and the one of the four the issue miscounted. It is a fact
about what the counter _means_, it is written down once where the counter is
defined — `EVAL_COUNTERS` in `@ticket/shared`, which is where every consumer meets
it — and `runner.ts:126` already points a reader there rather than restating it
("each one is named and argued for once — including the two whose denominators
are not `repeats`"). Prose, in the right module, and nothing to move. The one
line in the runner is a comment on the expression that computes it, which is
where a comment about `filter(v => v.category !== null)` belongs.

## The import that was wrong

`verdictOf` decided `abandoned` against `declined` with
`isRetryable(result.reason)`. Every value of `AutoReplyFailure`, measured against
the runner as it stood:

| reason       | `isRetryable` | the model was asked?           | outcome it got |
| ------------ | ------------- | ------------------------------ | -------------- |
| `provider`   | yes           | no                             | `abandoned`    |
| `busy`       | yes           | no                             | `abandoned`    |
| `empty`      | yes           | asked, answered nothing usable | `abandoned`    |
| `quota`      | **no**        | **no**                         | **`declined`** |
| `auth`       | **no**        | **no**                         | **`declined`** |
| `config`     | **no**        | **no**                         | **`declined`** |
| `declined`   | no            | yes, and it said no            | `declined`     |
| `ungrounded` | no            | yes, and a check threw it out  | `declined`     |

Five agree and three do not, and the three are not an edge. `isRetryable` splits
the provider's six by **whether asking again could help** — that is what a queue
needs and `ai-features.md` says so in as many words: throw on
`provider`/`busy`/`empty`, return on `quota`/`auth`/`config`, "which will fail
identically forever." Nothing about _was the model asked_ turns on that. A
revoked key is exactly as much an outage as a 503; it is only a less hopeful one.

The reach is wider than an outage. `autoReply` answers
`config`/`unavailable` **before it builds a prompt** when the corpus it is handed
is empty (`ai/auto-reply.test.ts:276` pins that), and `jobs/eval-run.ts` puts no
guard in front of it — so a live-corpus run against a knowledge base whose
articles are all withheld reached the runner as a `config` failure per repeat,
with no provider involved at all. Measured end to end, five repeats of
`off-corpus` against an empty corpus, before the fix:

```
{"repeats":5,"matches":0,"abandoned":0,"usd":0,"cachedRepeats":0,
 "caught":0,"escaped":0,"classifiedRepeats":5,"classifyMatches":5}
```

Nought for five, and `abandoned` saying nothing went wrong. On `/evals` that is
"Unanswered: 0 — the provider answered everything" beside a decline accuracy of
zero.

Two things in the repo already said this could not happen. `DECLINE_COVERAGE` in
`@ticket/core` explains why no case expects `unavailable`: _"the provider could
not be reached **or the corpus was empty** — a property of the deployment on the
day, not of any case. A run during an outage records every repeat as
`abandoned`."_ And `categoryOf` in `evals/classify-case.ts` draws the split
correctly for the classifier half — _"Null covers every way the call did not
produce an answer — the provider was unreachable, **the key is wrong**, the model
spent its budget reasoning"_ — and then says it is _"the same split the auto-reply
half already draws between `abandoned` and `declined`."_ It was not the same
split. The two halves of one runner disagreed about what a rejected key means,
and the prose in each of them asserted that they agreed.

### What it reads instead

`isProviderFailure(reason)` in `ai/provider.ts`, a membership test over
`AI_FAILURE`. That is the line the taxonomy was already drawing and that nothing
had a name for: a feature that can fail its own way **spreads** `AI_FAILURE` and
adds to it — `AUTO_REPLY_FAILURE` adds `declined` and `ungrounded`,
`POLISH_FAILURE` adds `invented` — so "whose failure is this" is a question about
membership, and every caller that wanted it was working it out some other way.
Beside `classify` and `AI_FAILURE` rather than in the runner, because the answer
is a property of the taxonomy and a second reader will want the same one.

`runner.ts` loses its only `../jobs/` import in the process, which is the leak the
issue named — a module that measures now has no path to the queue at all. The
count of import lines goes from eight to seven, and that is the least interesting
thing about the change.

## The second suspect import: `AiUsage`

Not a leak, and not in the interface. `AutoReplyResult.usage` exists _for_ this
module — its own doc comment says so, `jobs/auto-reply-ticket.ts` ignores it, and
`EvalVerdict` publishes `usd: number` and `cached: boolean` rather than passing
the shape on. A module that has to report what a run cost is entitled to what a
call cost.

One line of it moved anyway, and for a sharper reason than tidiness.
`runner.ts:328` read `(result.usage?.cachedInputTokens ?? 0) > 0`, and a grep for
the fields of `AiUsage` across `apps/` and `packages/` returns exactly two
modules: `ai/provider.ts`, and that line. It was the **only** read of an `AiUsage`
field outside the module that owns the interface — which put the harness's one
cache alarm on the far side of the seam that exists to keep an SDK shape change
loud. `toAiUsage` is the single place `LanguageModelUsage` is named so that a
release moving a field breaks a compile instead of zeroing a number; a field read
that never passes through `provider.ts` is a field read that protection does not
cover. It would have gone on returning `false`, `cachedRepeats` would have read
zero on every run, and the harness's whole account of _why_ it watches that number
is a story about that exact failure printing `cached=0` across 350 calls.

So it is `wasCached(usage)` now, beside `usdFor`, which is the same shape of
question over the same value and is in that file for the same reason.

## The runner test's copy of the result type

Assessed, and it is worse than drift-prone: it is what kept the defect above
invisible.

The local `AutoReplyOutcome` was a structural twin of `AutoReplyResult` whose one
difference was `reason: string` in place of `reason: AutoReplyFailure`. Nothing in
the file needed the widening — all four reasons it ever scripted (`declined`,
`ungrounded`, `provider`, `busy`) are real members. What the widening cost is that
**no test could be exhaustive.** `Object.values(AI_FAILURE)` as a `test.each` table
is the natural way to ask "and what about the other four", it is the same trick
`RETRYABLE_AI_FAILURE`'s `Record<AiFailure, boolean>` uses one module up to make a
new failure mode a compile error — and against a `string` parameter it proves
nothing, because a typo compiles. So nobody wrote it, and the two tests that did
exist (`provider`, `busy`) happened to pick the two members on which the retry
table and the taxonomy agree.

It is `AutoReplyResult` now, and the tests that go with it are exhaustive by
construction: every member of `AI_FAILURE`, walked from the object, must be
`abandoned`; `declined` and `ungrounded` must be `declined`. A seventh failure
mode joins the loop the moment somebody adds it.

## Considered options

**Extract the outcome mapping into a module of its own** — a `verdictOf` that
`jobs/auto-reply-ticket.ts` and `evals/runner.ts` could share. Rejected: they do
not share it. The job branches on retryability to decide _throw against return_,
which is a queue decision; the runner branches on membership to decide how to
count. They read the same field for genuinely different reasons, and a shared
mapper would have to take a parameter saying which, at which point it is two
functions with a name in front of them. The one line they should share is the
membership test, and that is what moved.

**Narrow `AutoReplyResult.reason` so the two categories are separate branches** —
`{ ok: false; providerFailure: AiFailure }` against
`{ ok: false; verdict: "declined" | "ungrounded" }`. This is the version that
makes the defect a compile error rather than a test. Rejected as too large for
what it buys and for the wrong module: `reason` is documented as coarse _on
purpose_ ("it must stay coarse, because four of the checks below all mean exactly
'never try this again'"), both queue workers branch on it as one union, and
`ClassifyResult` and `PolishResult` would have to follow or the four features stop
looking alike. The membership test gets the same answer at the two call sites that
need it.

**Answer the issue's question with "no" and stop.** Rejected the way ADR-0015 and
ADR-0017 rejected it: the comparison found a real defect, and a spike that reports
a verdict and leaves the defect where it was has spent the measurement for
nothing.

## Consequences

**`quota`, `auth` and `config` are `abandoned`**, so an eval run through a revoked
key, an empty account, a bad model id or an emptied knowledge base reports what it
is — "the provider answered none of this" — rather than a case set the model
failed. `DECLINE_COVERAGE`'s claim about `unavailable` and `classify-case.ts`'s
claim about drawing "the same split" are both true now; neither needed editing,
which is the tell that the code was the thing that was wrong.

**The taxonomy is walked, not listed.** `runner.test.ts` and `provider.test.ts`
both build their tables from `Object.values(AI_FAILURE)`, so a seventh failure
mode is covered on both sides of the split the moment it exists — beside the
compile error it already causes in `jobs/ai-retry.ts`. `provider.test.ts` also
asserts the **disagreement** itself: the set of reasons on which `isRetryable` and
`isProviderFailure` differ is exactly `auth`, `config`, `quota`. If somebody ever
makes them agree, that test is where the argument in this ADR gets reopened rather
than quietly deleted.

**The interface is unchanged**, and reversing the rest of this costs two
one-line functions. Nothing was extracted, nothing moved out of the module, and
`answerCase` and `runCase` are exported exactly as they were. The evidence for
revisiting the question is a second production caller: today `runCase` has one and
`answerCase` has none, and a replay tool or a second harness arriving with a source
shape of its own is what would make the count of vocabularies worth measuring
again.
