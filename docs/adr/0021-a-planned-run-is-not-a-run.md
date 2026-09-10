# A planned run is not a run

Two rules, one at each end of a run's life, fixed before the tickets that need
them are written.

**A plan is not a measurement.** A run somebody has asked for at a future time
is a record of its own, not an `EvalRun` row in a waiting state.

**A stopped run is measured but not judged.** Its rates are real, cost real
money and are shown; no threshold is applied to them.

Answered from [#232](https://github.com/AlexHun/ticket-manager-system/issues/232),
ahead of the three tickets that would otherwise each pick their own answer:
[#235](https://github.com/AlexHun/ticket-manager-system/issues/235) (stop a run
in flight), [#236](https://github.com/AlexHun/ticket-manager-system/issues/236)
(an editable schedule and cancellable one-off runs) and
[#237](https://github.com/AlexHun/ticket-manager-system/issues/237) (collapsing
a run, and drawing a stopped one as partial). The vocabulary all three speak is
added to `CONTEXT.md` in the same change; this file argues the one part of it
that is a decision rather than a word.

## A plan is not a measurement

`EvalRun`'s own comment opens "one run of the eval harness: the unattended path
answered against a set of cases". A planned run has answered nothing. Read down
its columns and ask what a row created this afternoon for 22:00 would put in
each:

| column                                                                                                                               | what the column asserts                                                                                              | what a plan can put there                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `corpus`                                                                                                                             | which knowledge base this run answered from                                                                          | honest — the choice is made when the plan is                                            |
| `startedAt`                                                                                                                          | `default(now())`, and the page lists newest first by it, `id` breaking the tie                                       | **a lie**: the row exists, the run has not started                                      |
| `repeats`                                                                                                                            | how many times each case **was** answered — "a stored rate means nothing without the denominator it was taken over"  | a guess at the constant this build carries, which the deploy before 22:00 may change    |
| `attempts`, `matches`, `abandoned`, `caught`, `escaped`, `usd`, `cachedRepeats`, `cacheable`, `classifiedRepeats`, `classifyMatches` | written when the run closes, "so a run in flight reads zero rather than a fraction of a number nobody can interpret" | zeros that are not a fraction of anything                                               |
| `thresholds`                                                                                                                         | "what this run was judged against, stamped when it started" (R8)                                                     | stamped hours before the run it judges, from a constant that may have been edited since |
| `status`                                                                                                                             | `running`, `completed`, `failed` — where one run **got to**                                                          | none of the three; a further member meaning "has not begun"                             |
| `results`                                                                                                                            | one row per case per run                                                                                             | empty                                                                                   |

One column is false, one is a guess, ten are zeros, and one — the thresholds —
would be snapshotted at a moment that has nothing to do with the run it is
supposed to have judged. That is not a run with some columns still to fill in;
it is a different thing wearing the shape of one.

**The obvious counter is that `running` is already a row of zeros.** It is, and
the difference is exactly where the line goes. A running run has been offered to
a provider: its zeros mean "not yet summed", they become numbers within minutes
with nobody doing anything, and if it is stopped it keeps what it measured. A
planned run's zeros mean "nothing has happened", and cancelling it keeps
nothing, because there is nothing to keep. The whole model insists a run records
what was measured — stamped repeats, snapshotted thresholds, every expectation
copied onto the case result so a run from three weeks ago keeps saying what it
was measured against. A row that has measured nothing is the one thing that
model refuses to be.

The trend is not the reason. `previousRuns` in `routes/evals.ts:343` walks runs
oldest-first and skips anything whose status is not `completed`, and the
per-corpus anchor at `:373` filters on `completed` in the `where`, so a fifth
status would inherit the right answer there for free. The damage is on the page
and in the record: `/evals` lists runs newest-first by `startedAt`, #237 opens
the newest on load, and the newest row would be one that has measured nothing —
a card of zeros carrying a delta against the last real run.

So a planned run is its own record, listed as upcoming and visibly not a run,
and the verb that ends it is **cancel**: it never becomes a run. A planned run
whose window passes unfired is **missed**, and a missed plan is not a run
either — it is a plan that did not happen.

## A stopped run is measured but not judged

Stopping happens at a case boundary (#235), so a stopped run holds every repeat
already paid for. Those rates are real: a run stopped after 12 of 36 cases
answered 60 repeats against a real provider, and `matches/attempts` over them is
a true statement about those 12 cases. Showing them is the whole point of
stopping at a boundary rather than aborting mid-case.

Judging them is a different act, and it would be a false verdict. The thresholds
were stamped by `evals/start-run.ts` when the run opened, and they were declared
over **the whole set**:

- **The cases answered are a prefix, not a sample.** The worker answers its case
  list in order — `ALL_EVAL_CASE_IDS` on an ordinary run, the pinned subset when
  one was asked for — so a stopped run holds the first N of that list rather
  than N drawn from it. The set is deliberately heterogeneous — gate cases,
  off-corpus cases, planted payloads — and a prefix over-weights whatever it
  happens to begin with. `declineAccuracy`'s 80% is a number argued about a
  mixture the prefix does not have.
- **The catch rate cannot be partially met.** Its threshold is 1.0 because
  ADR-0004 makes a fail-closed check that catches 96% of payloads a bug rather
  than a score. Catching the first three payloads is not that claim. And a
  prefix holding no adversarial case at all has measured nothing, which the read
  model already reports as `value: null` rather than as a clean hundred percent.
- **Not judged is not silent.** `escaped` above zero stays the loudest thing on
  the page. It is the one number on `/evals` that is a defect rather than a
  measurement, and a defect found in the first 12 cases is a defect — usually
  the reason somebody pressed Stop.

So: render the rates, withhold the band and the verdict cue, and badge how far
the run actually got (#233, #237). Uncoloured is the signal, and it has to read
as _unjudged_ rather than as _unmeasured_, which is what the badge's count is
for.

### Which is also why the status word is `stopped`

`failed` is reserved, in the schema enum's comment and again in
`EVAL_RUN_STATUS`, for **the run itself falling over** — the provider was
unreachable, the queue ran out of retries. It is explicitly not "a metric came
in below its threshold". A stopped run did not fall over: it was ended by an
admin, on purpose, holding good numbers.

`cancelled` is the other candidate, and it is taken. _Cancel_ is what happens to
a planned run — the thing that never becomes a run — on the model where that can
happen at all. Spending the same word on a run that has already measured
something would put the two acts one enum member apart while the whole of this
ADR is spent telling them apart. Hence a fourth status, `stopped`, matching the
verb.

## Considered Options

**A planned run as an `EvalRun` row with a status of its own.** The tempting one:
one table, one list, one route. Rejected on the table above — one false column,
one guessed column, ten zeros, and a threshold snapshot taken at the wrong
moment — and on what it does to readers. Every rate on the page is taken over
columns that would be zero; every reader that today asks "did this run
complete?" would have to learn to ask "and had it started?"; and
`parseStoredVerdicts`' rule that an unreadable value must read as an absence
rather than as a measurement
([0019](./0019-the-stage-is-not-a-module-and-an-outage-is-not-a-decline.md)) is
the same instinct one level down. This option writes the absence into the
measurement table on purpose.

**Judging a stopped run against a pro-rated threshold.** Rejected: the
thresholds are rates, not counts, so there is nothing to pro-rate. The problem
is not that fewer cases were answered but that a _different mixture_ was, and no
arithmetic over the stored threshold recovers the mixture it was declared for.

**Judging a stopped run against its stamped thresholds anyway.** Rejected: it is
the failure the snapshot exists to prevent, arriving from the other side. A run
kept for months has to keep saying what it was judged against; a run judged
against a standard declared for a set it never answered says something that was
never true of it.

**Reading a stopped run as `failed`.** Rejected: it files a real measurement
under the value reserved for the harness breaking, and it discards numbers
somebody paid for. It would also quietly change what a red board means, since
`failed` is what an admin scans for when the harness is broken rather than the
model.

**One verb for both ends — "cancel a run", planned or in flight.** Rejected in
the copy rather than in the code. The confirmations are where this gets read:
stopping names how many cases have already been answered and paid for (#235);
cancelling a plan names nothing, because nothing has been spent; and pausing a
schedule has to say that a run already in flight is unaffected (#236). Three
sentences about three different objects. One verb across them is how an admin
comes to believe that pausing the schedule stops tonight's run.

## Consequences

**`EVAL_RUN_STATUS` and the `EvalRunStatus` enum gain `stopped`, and the two
trend sites are asserted rather than rewritten.** Both already ask
`=== completed`, so a stopped run cannot anchor the series it interrupted; #235
pins that with a test instead of re-implementing it, because what matters there
is that nobody had to remember.

**Planned runs are their own record, with their own cancel path**, and they are
listed as upcoming rather than drawn as runs (#236). The `/evals` runs list
keeps meaning "measurements that happened", which is what makes both the
newest-first ordering and #237's newest-open rule safe.

**Three verbs that are not interchangeable, in code and in copy.** Pause a
schedule (it keeps its time), cancel a planned run (it never becomes a run),
stop a run in flight (it keeps what it measured). `CONTEXT.md` carries all three
with the object each one takes, because the failure mode here is a confirmation
dialog, not a type error.

**`/evals` will show uncoloured numbers that are not missing numbers.** A
stopped run's metrics render with no band and no verdict cue, which is a
rendering an admin has never seen on this page — the badge carrying how far the
run got is what makes it read as unjudged rather than broken. Named here because
a correct number under wording that says the wrong thing is how the last one of
these went wrong
([0019](./0019-the-stage-is-not-a-module-and-an-outage-is-not-a-decline.md)'s
"Provider unreachable" label).

**`CONTEXT.md` gains the whole eval vocabulary — eight nouns and three verbs.**
It carried none of it after five slices of `/evals`, and that gap is the same
signal [0015](./0015-a-ticket-transition-is-not-a-module.md) read as an argument
_against_ a module and
[0019](./0019-the-stage-is-not-a-module-and-an-outage-is-not-a-decline.md) read
as a real absence. This is the second kind: the concepts are in the schema, on
the wire, on a screen and in three open tickets, and the words for them existed
only in comments.

**Reversing this costs a table and a migration.** If a planned run ever has to
appear in the runs series — a "what is coming" row in the same list — the column
table above is the argument to beat, and the cheapest reversal is a read model
that unions the two for display only, leaving `eval_run` meaning what it means
today.
