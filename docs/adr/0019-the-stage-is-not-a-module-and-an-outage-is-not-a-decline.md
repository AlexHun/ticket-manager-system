# The Stage is not a module, and an outage is not a Decline

There will be no shared owner for "how far down the pipeline did this get".
_Stage_ is derived from evidence at exactly one site, so there is nothing to
share; the rule that maps an exit onto a stop already lives in one place
(`DECLINE_STAGE`) and is already enforced by exhaustiveness.

What the grilling found instead is a defect one level along, in the type the
issue mistook for _Stage_. **`Outcome` has two derivations, they encode one
rule, and one of them applies it wrongly**: `/pipeline` reports a provider
outage as a `declined` ticket — the model getting the answer wrong — on the one
screen built to teach that those are different things, and against the same
rule stated verbatim in three other places. Filed as
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

| `reason`                                      | `decline`                                                          | provider failure? |
| --------------------------------------------- | ------------------------------------------------------------------ | ----------------- |
| `config` — empty corpus (`:646`)              | `unavailable`                                                      | yes               |
| `empty` — budget went on reasoning (`:706`)   | `unavailable`                                                      | yes               |
| `classifyFailure(err)` (`:713`)               | `unavailable`                                                      | yes               |
| `declined` (`:721`, `:738`)                   | `notCovered`                                                       | no                |
| `ungrounded` (`:749`, `:781`, `:816`, `:829`) | `tooLong`, `noCitation`, `unbackedCommitment`, `unbackedReference` | no                |

`isProviderFailure(reason)` and `decline === unavailable` agree at every one of
them, and the three gate reasons (`category`, `answered`, `noText`) never reach
`autoReply` at all — `gateDecline` answers first, and the runner reports those
as `declined` (`runner.ts:302`) exactly as the column does. **The persisted
taxonomy carries the whole distinction the unpersisted one draws.** `toRun` has
the evidence. It does not read it.

So the rule both sites are stating, in the glossary's own words:

> An **Outcome** says whether a verdict was reached about the ticket, and what
> it was. _Resolved_ and _declined_ are verdicts. _Abandoned_ is the absence of
> one — the machinery failed, so nothing was decided. _Pending_ is not yet;
> _not offered_ is never.

One rule, read from two kinds of evidence, which is the first of the two answers
#215 offered. Not "different rules that happen to share an enum".

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
Three such guards already exist by hand, all in `PipelineRail.tsx` (`:82`,
`:93`, `:383`), beside four prose statements of the same rule — and **one of the
three is already dead**: `isOutputCheck` (`PipelineRail.tsx:90`) tests
`DECLINE_STAGE[decline] === checked && decline !== "unavailable"`, but
`DECLINE_STAGE[unavailable]` is `drafted`, so the second clause can never fire.
Seven sites in all carry a comment or a guard about one enum member, and one of
the seven has quietly stopped meaning anything. That is the argument against
adding a fourth guard by hand rather than a table that asks the question once.

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
excludes the member. That mis-modelling is the cause of everything above: seven
sites carry a comment or a guard about this one value. But it is a persisted
column value with nine read sites, a `Record` in `@ticket/shared`, two label
maps, a coverage table and an eval schema over it, and the migration would
rewrite history rows whose meaning nobody disputes. The table above buys the
correctness for one line; this buys the tidiness for a week. Recorded here as
the reason a future reader should not be surprised by how much prose one enum
member needs.

## Consequences

**`/pipeline` will report an outage as `abandoned`, and `abandoned` will mean
two things there.** The classifier exhausting its retries and the auto-reply
provider being unreachable both become `abandoned` — and they should, because
the rule is about whether a verdict was reached and neither reached one.
`EvalsPage` already labels the member "Provider unreachable"; `/pipeline` needs
wording that covers both halves without claiming the classifier failed when it
did not. Named in
[#226](https://github.com/AlexHun/ticket-manager-system/issues/226) as part of
the fix, because a correct number under a label that says the wrong thing is not
a fix.

**The decline breakdown on the rail loses its `unavailable` stub, and gains
nothing.** `PipelineCounts.declines` is a `Record` over all nine and every
reader iterates `AUTO_REPLY_DECLINES`, so the count stays available and stays
zero-visible — the rail already renders it muted (`PipelineRail.tsx:383`). What
changes is that the ticket carrying it is no longer counted as declined in the
same breath.

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

**Reversing this costs one file.** If a third derivation of `Outcome` ever
arrives with evidence resembling either existing one, the table of three above
is where to start, and the argument to beat is the deletion test: two sites that
share a rule but no parameters.
