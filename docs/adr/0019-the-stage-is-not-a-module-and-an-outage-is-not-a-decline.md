# The Stage is not a module, and an outage is not a Decline

There will be no shared owner for "how far down the pipeline did this get".
_Stage_ is derived from evidence at exactly one site, so there is nothing to
share; the rule that maps an exit onto a stop already lives in one place
(`DECLINE_STAGE`) and is already enforced by exhaustiveness.

What the grilling found instead is a defect one level along, in the type the
issue mistook for _Stage_. **`Outcome` has two derivations, they encode one
rule, and one of them applies it wrongly**: `/pipeline` reports an outage as a
`declined` ticket — the model getting the answer wrong — on the one screen built
to teach that those are different things, and against the same rule four other
places in this repo state in prose. The same wrong inference has already spread
to a second site, where it inflates a published rate
(`routes/ticket-effectiveness.ts`). Filed as
[#226](https://github.com/AlexHun/ticket-manager-system/issues/226).

Answered from a grilling ([#215](https://github.com/AlexHun/ticket-manager-system/issues/215)),
after its blocker [#212](https://github.com/AlexHun/ticket-manager-system/issues/212)
landed, as the issue asked.

## The issue named the wrong type, and that is the first finding

[#215](https://github.com/AlexHun/ticket-manager-system/issues/215) opens with
"the pipeline outcome — a Stage, one of the six stops `CONTEXT.md` names". Those
are two types in `@ticket/shared` and they are not the same size or the same
question:

- **`PipelineStage`** — the six stops. Derived from evidence at **one** site:
  `toRun` in `apps/api/src/routes/pipeline.ts:202`, which computes an exit stop
  and a furthest-reached index and hands `/pipeline` a `PipelineStageResult`
  per stop. Every other reader — `PipelineRail.tsx`, `pipeline-labels.ts` —
  consumes `PIPELINE_STAGES` and `DECLINE_STAGE` for render order, labels and
  grouping. None of them derives a stage from anything.
- **`PipelineOutcome`** — five verdicts about one ticket. This is the type with
  more than one derivation, and the one the issue's argument is actually about.

So the module candidate as written has one implementation and cannot be
consolidated. It dissolves, which is what the issue predicted — but not for the
reason it predicted, and not before the comparison it asked for turned up
something else.

## The three readers, after #212

|                                                                    | evidence                                                                                                                    | outcomes it can produce             | fallback                      |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------- |
| `verdictOf` (`apps/api/src/evals/runner.ts:184`)                   | an `AutoReplyResult` in hand, one instant old                                                                               | `resolved`, `declined`, `abandoned` | none — total over the union   |
| `toRun` (`apps/api/src/routes/pipeline.ts:202`)                    | a ticket row (`autoResolvedAt`, `autoReplyDecline`, `classifiedAt`, `category`, `status`, messages) plus a `PipelineConfig` | all five                            | none — total over the columns |
| `parseStoredVerdicts` (`apps/api/src/evals/stored-verdict.ts:113`) | a `Json` column written by some past build                                                                                  | any, through `asPipelineOutcome`    | **`notOffered`**              |

The third one is not a derivation, and that is the whole of #212's effect on
this question. It **deserializes a value `verdictOf` already decided** — the row
was written from a verdict, and reading it back is a promise about a column's
shape, not a judgement about a ticket. Before #212 that was hard to see, because
the narrowing was scattered across `jobs/eval-run.ts` and `routes/evals.ts` and
looked like a third opinion. It now has one home next to the projection that
wrote it, and being able to name it as a parse is what makes the rest of this
answerable.

### The inconsistent fallback, settled

#215's third criterion: one reader defaults and the others do not, and the
difference is either justified in writing or removed. **It is justified, and
this is the writing.** It survives because the three are not three of a kind:

- The two derivations are **total functions over their evidence**. There is no
  unrecognised `AutoReplyResult` and no unrecognised ticket row; every branch is
  reachable from a value the type system already admits. Neither has a fallback
  because neither has anywhere to put one.
- The parse has an input the type system cannot vouch for, and
  `parseStoredVerdicts`' rule for all six of its fields is that **an unreadable
  value must read as an absence rather than as a measurement**. `notOffered` is
  the only member of `PipelineOutcome` that `verdictOf` can never return, so a
  row this build cannot read reads as a value no eval run could have produced.
  That is the absence the rule asks for, arrived at through the type rather than
  through a comment.
- `null` — the fallback its two siblings `asAutoReplyDecline` and
  `asTicketCategory` take — is not available: `PipelineRun.outcome` and
  `EvalCaseResult.expectedOutcome` are both non-nullable on the wire, and
  widening them so one parse can express doubt would make every reader handle a
  case no writer produces. `asPipelineOutcome`'s own comment already says this;
  what was missing was the reason it does not make the two derivations
  inconsistent.

Nothing to remove. The rule is that a **parse** may default and a
**derivation** may not, which is a sharper statement than the symmetry #215
went looking for.

## One rule or two? One — and `autoReply` already proves it

#215's second criterion. The two derivations partition the same reality through
two different keys, and the keys turn out to carry the same information.

`verdictOf` asks `isProviderFailure(result.reason)` over `AutoReplyFailure` —
`AI_FAILURE`'s six provider faults plus `declined` and `ungrounded`. That
taxonomy is **never persisted**. `toRun` has only `autoReplyDecline`, the
nine-member `AutoReplyDecline`. So the route looks like it is reasoning from
less evidence and having to guess.

It is not. Read the nine `ok: false` returns in `apps/api/src/ai/auto-reply.ts`:

| `reason`                                      | what the call site means by it        | `decline`                                                          | `isProviderFailure` |
| --------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------ | ------------------- |
| `config` (`:646`)                             | the corpus is empty                   | `unavailable`                                                      | true                |
| `empty` (`:706`)                              | the output budget went on reasoning   | `unavailable`                                                      | true                |
| `classifyFailure(err)` (`:713`)               | the provider could not be reached     | `unavailable`                                                      | true                |
| `declined` (`:721`, `:738`)                   | the model read the corpus and said no | `notCovered`                                                       | false               |
| `ungrounded` (`:749`, `:781`, `:816`, `:829`) | a reply was written and destroyed     | `tooLong`, `noCitation`, `unbackedCommitment`, `unbackedReference` | false               |

`isProviderFailure(reason)` and `decline === unavailable` agree at every one of
them, and the three gate reasons (`category`, `answered`, `noText`) never reach
`autoReply` at all — `gateDecline` answers first, and the runner reports those
as `declined` (`runner.ts:302`) exactly as the column does. **The persisted
taxonomy carries the whole distinction the unpersisted one draws.** `toRun` has
the evidence. It does not read it.

Read the middle column, though, because **`unavailable` is not only an outage**.
It is the one decline three unrelated causes share: an emptied corpus, a call
whose budget went on reasoning, and a provider that could not be reached. All
three satisfy `isProviderFailure` — `config` and `empty` are members of
`AI_FAILURE`, whatever the call site means by them — and all three are the same
fact at the level of the rule below: nothing was decided about this ticket. That
is what makes one table over the persisted taxonomy sufficient. It is also why
the wording on the screen cannot say "the provider could not be reached", which
is true of one cause in three.

So the rule both sites are reaching for, which `CONTEXT.md` now states as the
definition of _Outcome_:

> An **Outcome** says whether a verdict was reached about the ticket, and what
> it was. _Resolved_ and _declined_ are verdicts. _Abandoned_ is the absence of
> one — the machinery failed, so nothing was decided. _Pending_ is not yet;
> _not offered_ is never.

One rule, read from two kinds of evidence, which is the first of the two answers
#215 offered. Not "different rules that happen to share an enum".

### `abandoned` and `notOffered` on an empty corpus, which is not a third rule

An emptied knowledge base can produce either, and it is worth saying why that is
the rule working rather than a seam in it. A ticket the job **already picked up**
before the corpus went empty is stamped `unavailable` and reads `abandoned`: it
was offered, and no verdict came back. A ticket sitting there **while** the
corpus is empty is never enqueued at all, and `toRun`'s `autoReplyArticleCount`
gate reads it `notOffered`: nothing is scheduled, which is true.

Same operator mistake, two tickets, two different true statements — "this one
was tried and got nowhere" and "this one will not be tried". The rule asks
whether a verdict was reached, and only the first ticket ever went looking for
one. What would be wrong is the third reading, the one in place today: that
either ticket was _declined_.

### Where it is applied wrongly

`onExhausted` (`apps/api/src/jobs/auto-reply-ticket.ts:561`) hands the ticket
back and stamps `autoReplyDecline: "unavailable"`. `toRun` then reads
`decline !== null` and answers `declined`. An outage becomes a decline: it lands
in `/pipeline`'s decline breakdown, colours a stub on the rail, and reads to an
admin as the knowledge base having been consulted and found wanting.

Three places in this repo already say it must not:

- `DECLINE_STAGE`'s comment (`packages/shared/src/index.ts:1521`) — "it is the
  one entry here that is **not a verdict about the ticket** — the provider could
  not be reached, so nothing was ever decided".
- `onExhausted`'s own comment — "`unavailable`, not a judgement about the
  ticket… 'not covered by the knowledge base' would be a claim nobody made".
- The case set's coverage entry
  (`packages/core/src/cases/auto-reply-cases.ts:974`) — "a run during an outage
  records every repeat as `abandoned`, which is reported separately for exactly
  this reason: **an outage must not read as the model getting things wrong**".

And the two derivations are **diffed against each other on screen**. `RunVerdict`
(`apps/web/src/pages/PipelinePage.tsx:454`) checks
`expected.outcome === run.outcome`, where `expected` comes from
`AUTO_REPLY_CASES` — expectations authored against `verdictOf` — and
`run.outcome` comes from `toRun`. The simulator's headline finding is a
comparison between the two readings of one rule, with no note anywhere that they
can disagree.

It does not fire today only because no case expects `unavailable`; the case set
declares it unexpectable, for the reason quoted above. The disagreement is
reachable the moment a simulated ticket meets a real outage — which is precisely
when an admin is on `/pipeline` trying to find out what broke.

### And it is not only `/pipeline`

`routes/ticket-effectiveness.ts:72` counts `autoReplyDecline IS NOT NULL` as
`declined` in the same scan that produces `classified`, and `:142` divides it
by `classified` and publishes it as `decline.rate`. So an outage does not merely
mislabel one ticket on one screen — it **inflates a published rate**, the number
an admin would read to decide whether the knowledge base needs work. The
`groupBy` beside it (`:82`) is fine: it breaks the column down by reason and a
reason is what the column honestly holds.

That is the second site, it was found by reviewing this ADR rather than by
writing it, and it is the strongest argument in the record for a shared table
over the one-line conditional weighed below. Two sites already infer "declined"
from `decline !== null`; the inference is the defect, and it has spread once
before anyone noticed it was wrong.

## Considered Options

**A `Stage` module.** Rejected: nothing to own. One derivation, and the two
facts a second one would need — render order, and where an exit leaves the rail
— are already `PIPELINE_STAGES` and `DECLINE_STAGE`, one a `const` array and the
other a `Record` whose exhaustiveness is the invariant `domain.md` names.

**An `Outcome` module — one function both read models call.** Rejected on the
deletion test. The two derivations share no parameter: one takes a discriminated
union that exists for a few milliseconds inside a worker, the other takes six
columns and a config record, and the second has to answer `pending` and
`notOffered`, which are questions about the deployment rather than about the
ticket and which the first cannot ask. A function taking both shapes is a
function with two bodies behind one name.

**A hand-kept `decline !== "unavailable"` guard in `toRun`.** The one-line fix,
and rejected as the _form_ of the fix even though it is the right behaviour.
Nine sites already carry a hand-kept guard, comment or special-cased label about
this one enum member. Three are guards, all in `PipelineRail.tsx` — `:82`
(`declineTone` gives it the neutral), `:93` (`isOutputCheck`), `:383` (the stub
renders muted). Four are prose: `DECLINE_STAGE`'s comment
(`shared/src/index.ts:1521`), `onExhausted`'s (`auto-reply-ticket.ts:551`),
`verdictOf`'s (`runner.ts:181`), and the case set's coverage entry
(`auto-reply-cases.ts:974`). Two are labels written to avoid the word "decline"
(`pipeline-labels.ts:53`, `:73` — "The assistant could not be reached").

**And one of the three guards is already dead.** `isOutputCheck`
(`PipelineRail.tsx:90`) tests
`DECLINE_STAGE[decline] === checked && decline !== "unavailable"`, but
`DECLINE_STAGE[unavailable]` is `drafted`, so the second clause can never fire.
Nine hand-kept reminders about one value, one of which has quietly stopped
meaning anything, is the argument against adding a tenth by hand rather than a
table that asks the question once.

**A `DECLINE_OUTCOME: Record<AutoReplyDecline, PipelineOutcome>` in
`@ticket/shared`, beside `DECLINE_STAGE`. Chosen.** Not a module — a table, and
the sibling of the one already there. Eight entries say `declined` and one says
`abandoned`, and the eight are the price of the property that matters: a tenth
decline reason is a compile error until somebody says **whether it is a
verdict**, which is the exact question three comments answer in prose and
`toRun` never asked. It is the reason `DECLINE_STAGE` and `RETRYABLE` are
`Record`s rather than lookups with a default, argued at both of them; the
question here is one line away from the question there, over the same key.

`verdictOf` keeps `isProviderFailure` rather than reading the new table. It has
the richer evidence in hand, and
[0018](./0018-a-measuring-module-reads-the-taxonomy-not-the-retry-table.md) is
about exactly the cost of a measuring module reading the more convenient
taxonomy instead of the right one. The two are kept honest by a test that pins
the equivalence the table above establishes, which is cheaper than either site
depending on the other.

**Separating `unavailable` out of `AutoReplyDecline` altogether.** The deepest
fix, and deferred rather than rejected. `CONTEXT.md` defines _Decline_ as "the
auto-reply's **decision** not to answer a ticket… a normal outcome, not a
failure", and `unavailable` is neither a decision nor normal — the definition
excludes the member. That mis-modelling is the cause of everything above: nine
sites carry a comment or a guard about this one value. But it is a persisted
column value with nine read sites, a `Record` in `@ticket/shared`, two label
maps, a coverage table and an eval schema over it, and the migration would
rewrite history rows whose meaning nobody disputes. The table above buys the
correctness for one line; this buys the tidiness for a week. Recorded here as
the reason a future reader should not be surprised by how much prose one enum
member needs.

## Consequences

**`/pipeline` will report an outage as `abandoned`, and `abandoned` will mean
more than one thing there.** The classifier exhausting its retries, a provider
that could not be reached, an emptied corpus and a call whose budget went on
reasoning all become `abandoned` — and they should, because the rule is about
whether a verdict was reached and none of them reached one. But four causes
behind one word need wording that is true of all four: `EvalsPage` labels the
member "Provider unreachable", which is true of one. Named in
[#226](https://github.com/AlexHun/ticket-manager-system/issues/226) as part of
the fix, because a correct number under a label that says the wrong thing is not
a fix.

**`decline.rate` on the effectiveness screen will fall.** That is the point of
it — the rate stops counting outages as the knowledge base failing to cover
things — but it is a published number changing value on a screen an admin may
already be reading trends off, so it belongs in the record rather than only in
the diff.

**The per-reason decline breakdowns do not change at all.** Both the rail's
(`PipelineCounts.declines`) and the effectiveness screen's (`:82`'s `groupBy`)
are `Record`s over all nine reasons, and a reason is what the column honestly
holds; `unavailable` keeps its own count and the rail keeps rendering it muted
(`PipelineRail.tsx:383`). What changes is only the **aggregate** that folded it
in with the eight verdicts.

**`isOutputCheck`'s dead clause goes with it.** One line, in the same change,
because leaving a guard that cannot fire next to a new table that makes the same
distinction correctly is how the next reader learns to distrust both.

**`Outcome` joins the glossary.** It was missing, and its absence is the same
fifth signal [0015](./0015-a-ticket-transition-is-not-a-module.md) leaned on —
except read the other way round. There it was evidence _against_ a module: the
domain had never needed a noun for "transition". Here the concept is on the wire
in two read models and rendered on two screens, so the gap was a real one, and
two derivations drifting apart over a word nobody had pinned down is what an
unnamed concept costs. Added to `CONTEXT.md` under _The unattended path_, beside
_Stage_ and _Decline_, with the verdict/absence distinction in the definition
rather than only here.

**`routes/pipeline.ts` has no test file, and `toRun` is not exported.** Worth
saying, because it is why this was found by reading rather than by a failure:
the one module that derives both a Stage and an Outcome from a ticket row is
reachable only through an HTTP route against a live database. #226 exports it
and pins the nine declines against `DECLINE_OUTCOME` as values, which is the
same move [#212](https://github.com/AlexHun/ticket-manager-system/issues/212)
made for the evals read model, for the same reason.

**[#218](https://github.com/AlexHun/ticket-manager-system/issues/218) closes
unbuilt, on its own instruction.** It was filed to act on this verdict — "one
module owning the Stage and its derivations" — and its last criterion says "if
#215 concluded this is not a module, close with that reasoning rather than
building it". This is that reasoning. Two of its criteria are answered
elsewhere rather than dropped: "the fallback is decided in one place" is settled
above (it already is, and it is a parse), and "no caller re-derives the Stage
for itself" was already true before the ticket was written.

**Reversing this costs one file.** If a third derivation of `Outcome` ever
arrives with evidence resembling either existing one, the table of three above
is where to start, and the argument to beat is the deletion test: two sites that
share a rule but no parameters.
