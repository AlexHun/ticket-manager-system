# Plan: An eval harness for the unattended path

**PRD:** [docs/prd/ai-eval-harness.md](../prd/ai-eval-harness.md) · **Status:** Complete — all five slices shipped · **Date:** 2026-09-08

## Layers crossed

```
web (new: EvalsPage + ROUTE.evals + nav entry; shadcn progress/badge/card)
  → api (new: routes/evals.ts, requireAdmin on every route)
    → @ticket/core (new: schemas/evals.ts — the case schema and the run/response shapes)
      → apps/api/src (new: evals/runner.ts — one module, two callers)
        → ai/auto-reply.ts::autoReply(articles, context)   ← already a value-in/value-out seam
        → ai/knowledge-base.ts::autoReplyArticles()        ← live corpus
        → new: evals/frozen-corpus.ts                      ← seed corpus, read as data
        → db (new: EvalRun, EvalCaseResult)
          → jobs/boss.ts registerWorker (on-demand) + registerSweep (nightly)
          → events/hub.ts publish + a new TICKET_EVENT kind
```

**No claim here needs context7.** Every external-library fact this plan rests
on is already exercised in this repo and was read rather than remembered:
pg-boss's cron comes from `boss.schedule(spec.name, spec.cron)` inside
`registerSweep` (`jobs/boss.ts`), and the four existing sweeps are the working
examples. Nothing needs an API this codebase has not already called.

### The two findings that shaped the slicing

**1. The seam the PRD asks for already exists, so R12 is free.**
`autoReply(articles, context)` takes the corpus **as a value** and, in
`auto-reply-ticket.ts`'s own words, "touches no database at all".
`AutoReplyContext` is `{ subject, text, customerName }` — three strings — and
`AutoReplyResult` already carries `{ ok, reason, decline, articleIds }`. So a
run constructs a context, calls `autoReply`, and reads the verdict. There is no
ticket row to avoid creating because that code path cannot create one. R12 stops
being a promise the tests police and becomes a property of which function the
harness calls.

**2. Three of the nine decline reasons are unreachable at that seam, so R2 as
written is unsatisfiable.** `category`, `answered` and `noText` are decided by
the **job**'s three preflight gates (`auto-reply-ticket.ts`, the `gated`
ternary), before `autoReply` is ever called — they read `ticket.category` and
the messages, not the model. The other six all come from inside `autoReply`.
Handing a synthesized input to `autoReply` can therefore never produce a
`noText` result, and a case set claiming to cover all nine would be quietly
lying about three of them.

The fix keeps both requirements: **extract the gate ternary into a pure
predicate** — `gateDecline({ category, hasOutbound, inboundCount })` returning
`AutoReplyDecline | null` — in its own leaf module, called by the job exactly
where the ternary is now and by the runner before it calls `autoReply`. The
whole decision becomes reproducible from values, the job keeps its behaviour
byte for byte, and R12 still holds because a predicate over three fields reads
nothing. This is slice 2 work, and it is the reason slice 2 is not merely "more
cases".

### One conflict with a documented standard, flagged rather than resolved silently

`conventions.md` says **`packages/core` holds zod schemas only**, and
`prd-to-plan` repeats it: "a slice that puts logic in `core` is in the wrong
package". The settled constraint puts the shared case set there. A case set is
data, not logic — but it is not a schema either.

It cannot go in `@ticket/shared` instead: the dependency runs **core → shared**,
one way (`packages/core/package.json` depends on `@ticket/shared`; nothing goes
back), and a case carries `SimulateEmailValues`, which is a core type. Shared
does already hold checked-in data (`changelog-entries.json`), so the precedent
is for data-in-a-package rather than against it — just not in that direction.

**Proceeding with core**, split so the charter stretches as little as possible:
`packages/core/src/schemas/evals.ts` for the schema, and
`packages/core/src/cases/auto-reply-cases.ts` for the data, parsed by its own
schema at module load so a malformed case fails the build rather than a run. If
a reviewer would rather not widen core's charter, the fallback is to move
`SimulateEmailValues` down into shared and put both there — mechanical, and
worth doing before slice 2 rather than after.

## Slice 1 — One case, one call, one row, one screen

**Retires:** whether the synthesized-input seam actually reproduces a real
verdict — that `autoReply` called with a hand-built `AutoReplyContext` and a
corpus array returns the same `decline` the pipeline would have reached for the
same email, with nothing written to any customer-visible table. Everything else
in this epic assumes that; if it is false, the epic is a different shape and
better to know in a day.
**Covers:** R1, R5, R6, R7, R11, R12

The case set moves out of `apps/web/src/pages/pipeline-scenarios.ts` into
`@ticket/core` with its schema, and `PipelinePage` imports it from there — same
seven scenarios, same expectations, no behaviour change on `/pipeline`. Two new
Prisma models. One runner module that answers exactly one case, once, against
the frozen corpus. `POST /api/evals/runs` (admin) enqueues a pg-boss job through
`registerWorker` and returns immediately; the worker runs the case, writes the
rows, and publishes a new event kind so the open page updates itself. A new
`/evals` route shows the run and its single case result.

- An admin opens `/evals`, clicks **Run**, and watches a row appear that says
  which case ran, what outcome it reached, what was expected, and whether they
  matched — without reloading.

**Hardcoded for now:**

- One case, chosen by id, not the whole set.
- One repeat. No rates, no maths — the row says matched or not.
- Frozen corpus only; the `corpus` column is written but never anything else.
- No thresholds, no failing badge, no cost, no comparison, no nightly.
- The three gate-decided reasons are out of reach — the case chosen for this
  slice is one of the six `autoReply` decides (`notCovered` is the cheapest and
  the most common).

**E2E:** `tests/e2e/evals.spec.ts` — sign in as admin, click Run, wait for the
result row, assert the outcome cell reads the expected value; then assert an
agent session gets no `/evals` nav entry and a direct visit is refused. The
guard half matters as much as the happy path: this route can spend money.

**Also in this slice, because they are cheap here and expensive later:**
`isEvalConfigured()` as a one-line export over `isAiConfigured` — per
testing.md #174, a feature that consults `ai/provider` directly forces its test
file onto a specifier `jobs/sweeps.test.ts` already owns with a _stateful_ stub,
and two stateful copies means one file's switch is inert. And the new event kind
goes into `TICKET_EVENT` + `EVENT_AUDIENCE` (`Record<TicketEventKind, …>`, so
it is a compile error until somebody says who may see it — admin).

## Slice 2 — The full set, five repeats, and a rate

**Retires:** whether a rate over 5 repeats is stable enough to threshold at all,
and what the decline-accuracy baseline actually is. The PRD's second target is
`TBD` until this slice runs.
**Covers:** R2, R3, R4, R10
**Un-hardcodes:** one case → all of them; one repeat → five; frozen-only → both
corpora, labelled.

`gateDecline` is extracted (see finding 2) and the runner calls it before
`autoReply`, so all nine reasons are reachable. The case set grows by hand to
30+, at least one per reason and four adversarial. Every case runs 5 times; a
case result stores matches-out-of-repeats, and the run stores the aggregate
rates. `POST /api/evals/runs` takes a corpus choice; a run against the live
articles table is labelled as such and never averaged with a frozen one.

- An admin starts a run, watches ~200 calls complete case by case, and reads two
  percentages and a cost at the top of the page.

**The sharp part, and the only place this slice can go wrong quietly:** R10
needs the USD figure, and today `logUsage` in `ai/provider.ts` _computes_ it and
throws it away into `console.log` — `autoReply` calls it at line 656 and
`AutoReplyResult` carries no usage at all. So cost accounting means touching the
module all four AI features share. Split the arithmetic out as a pure
`usdFor(usage)` and let `autoReply` return the usage beside its verdict; **do
not change the log line**, whose `cached=` field is load-bearing (`ai-features.md`
— prompt caching stops silently, and a run of `cached=0` is a regression nothing
on any screen would show). A run should assert `cached > 0` on repeats 2..5 for
free while it is there, which is a better prompt-caching alarm than the repo has
today.

**Also here:** repeats must not perturb the prompt prefix — no run id, no
timestamp, no counter in front of the corpus, and `orderBy: id` on the live
corpus read stays exactly as `knowledge-base.ts` has it.

**E2E:** extends slice 1's spec — run against the frozen corpus, assert the
summary shows a percentage rather than a boolean and that a per-case row reads
`n/5`. Keep the E2E to a small pinned subset of cases via a query parameter, or
the spec costs real money on every CI e2e job (see Spikes).

## Slice 3 — Catch rate, thresholds, and it runs itself

**Retires:** whether the safety catch rate holds at 100% on a set four times
larger than the two payloads it was measured on — the PRD's primary metric, and
the one number ADR-0004 is standing on.
**Covers:** R8, R9, R13

Adversarial cases are aggregated separately and broken down by which check
caught the payload (`unbackedCommitment` vs `unbackedReference`), which is the
distinction the existing 7-of-9 and 10-of-10 measurements already draw. Each
metric gains a declared threshold; a run below one is marked failing and drawn
as a failing badge, and nothing else happens. A `SweepSpec` registered through
`registerSweep` runs the frozen corpus nightly.

- An admin sees a red badge on a run whose catch rate slipped, and a breakdown
  saying which of the two checks let it through.

**The pg-boss rules are not optional here** (`backend.md`, #158): nothing outside
`boss.ts` calls `createQueue`, `updateQueue`, `work` or `schedule`, and
`boss.test.ts` reads the jobs directory and fails on any file containing one of
them as a call — or `retryLimit` / `retryDelay` / `policy` / `deadLetter` as an
object key. The nightly is a `SweepSpec` handed over, nothing more, and the spec
is **exported** so `run` is a function call in a test rather than something only
a cron could reach.

**E2E:** a run seeded below its threshold renders the failing badge and the
per-check breakdown. The nightly itself is unit-tested by calling the exported
spec's `run`, not by waiting for a cron.

## Slice 4 — Classifier accuracy ✅

**Retires:** nothing dangerous — this is the cheap add-on the grilling called
it, and it is fourth for that reason.
**Covers:** R15

Each case carries its expected `TicketCategory`; the runner calls `classify`
alongside `autoReply` and reports accuracy as a third metric. Same repeats, same
rate, same threshold mechanism.

- The page shows a third percentage, and a per-category breakdown of what was
  filed where.

**E2E:** extends the spec — the summary shows three metrics.

**Three decisions this slice actually turned on**, none of which the sentence
above implies:

1. **The classifier's answer is measured, not consumed.** `gateDecline` still
   reads the case's _declared_ `preflight.category`, exactly as before. Feeding
   it the live answer would have been the obvious wiring and it is the wrong
   one: a classifier flake would then move decline accuracy too, and a red board
   would no longer say which of the two models drifted.
2. **A gated case is no longer free.** Three of the five cases the gates
   decline are classified anyway (the other two are point 3) — `refund`
   misfiled as `General` _is_ the category gate failing, and that gate is the only control between a refund request and an
   unattended reply, so it is the sharpest place to measure rather than one to
   skip. What the gate still buys is the expensive call: one call a repeat
   rather than two. The E2E asserts exactly that, as a halving.
3. **Two cases are outside the metric, and it is a rule with content rather
   than an optimisation.** `unclassified` expects classification to have
   _failed_, so nothing the model could say would be right; `no-inbound-message`
   carries a placeholder body precisely because nothing reads it.

`evals/classify-case.ts` is a module rather than three lines in the runner for
two reasons: it holds that rule, and it gives `runner.test.ts` a mock seam.
`../ai/classify` is already owned by `jobs/activity-before-publish.test.ts`
with a stateless stub, and `mock.module`'s registry is one process wide — a
second, scripted factory there is the hazard `testing.md` describes.

**Not measured, and left that way deliberately:** the threshold ships at 0.8 on
no baseline at all, the same provisional footing decline accuracy shipped on and
for weaker reasons — no full-set run has priced this metric yet. Tighten it from
the trend, not from an opinion.

## Slice 5 — What moved since last time ✅

**Retires:** whether the stored shape can answer "what changed" without a
re-run — the question the whole epic exists to make answerable. **It could, and
no migration was needed**: every counter a delta is taken over was already on
`EvalRun` from slices 2-4, so this slice is entirely a read.
**Covers:** R14

Each run is compared against the previous run **on the same corpus**, per
metric, with the delta shown beside the number. Frozen and live runs form two
independent series and never compare across.

- An admin edits a prompt, runs the harness, and reads "catch rate 100% (=),
  decline accuracy 84% (-6pp since 3 Sept)" without opening a second page.

**E2E:** two runs seeded with different numbers; assert the delta renders and
that a live-corpus run is not compared against a frozen one.

**Five decisions this slice turned on**, none of them implied by the sentence
above:

1. **The predecessor is three conditions, not one**, and each rules out a
   comparison worse than none. _Same corpus_ is R4 arriving on R14's doorstep: a
   delta across the two series measures an admin's article edit and calls it a
   prompt regression. _Completed_ rules out both a run still filling in and one
   whose queue gave up — each holds a fraction of the set, and a rate over a
   fraction is a different number rather than a smaller one — and it rules them
   out **in both directions**, so an interrupted run neither gets a delta nor
   becomes the anchor that hides the last real measurement. _Before_ uses the
   page's own `[startedAt, id]` ordering, so two runs started in the same second
   still have one answer.
2. **A null delta is not a zero**, and this is the one way the feature could be
   wrong and still look right. Either side may be unmeasured — the catch rate is
   null on a night the model planted no payload, and every metric is null on a
   run from before it existed. Subtracting those as zeros would report a
   hundred-point collapse on the safety metric the first quiet night, which is
   the PRD's opening risk ("cries wolf, then gets ignored") arriving through the
   one door meant to catch it.
3. **One anchor query per corpus, because the window would otherwise decide
   what is comparable.** `GET /runs` reads twenty runs; the nightly is frozen,
   so twenty nights of it push the previous _live_ run out of that window and
   the live series quietly stops being comparable at exactly the point somebody
   wants to know whether an article edit moved anything. The in-page chain is
   one pass over the runs already fetched; the two `findFirst` lookups are what
   make the answer independent of the page size.
4. **`METRIC_COUNTS` is a `Record`, and that is what makes the delta
   trustworthy.** A metric's numerator and denominator are now defined once and
   read twice — for the run being drawn and for the run before it. Written out
   per metric at each site (which is what the route did), a delta could silently
   be a comparison between two different arithmetics. A fourth metric is now a
   compile error there as well as in `EVAL_THRESHOLD`.
5. **The server sends the previous _value_; the page does the subtraction** —
   settled by review, having first been built the other way round. The wire
   carrying a ready-made delta looked like the tidier split, but the page rounds
   every rate to a whole percent before it draws it, and a difference rounded
   separately off the raw fractions can disagree: 89.6% and 84.4% draw as "90%"
   and "84%" under a caption reading "-5pp". A screen that argues with itself is
   worse than one that says less, so the only delta anyone sees is now the one
   between the two numbers actually on screen — and "unchanged" is a claim about
   those, not about hidden decimals. Deciding _which_ run is comparable stays on
   the server, where the three conditions in (1) live.

The delta is drawn **muted whichever way it went**, deliberately.
`text-destructive` on this page means "below the bar this run was declared to
need"; colouring every downward drift the same red spends that signal on
run-to-run noise, and a move that matters has already turned the number itself
red.

## Requirement coverage

| Req | Slice | Note                                                                                  |
| --- | ----- | ------------------------------------------------------------------------------------- |
| R1  | 1     | Case set moves to `@ticket/core`; `/pipeline` reads it from there, unchanged          |
| R2  | 2     | Needs the `gateDecline` extraction — three reasons are otherwise unreachable          |
| R3  | 2     | 5 repeats, rate per case                                                              |
| R4  | 2     | `corpus` column written from slice 1; the live option and the never-average rule here |
| R5  | 1     | Enqueue + the new event kind                                                          |
| R6  | 1     | `requireAdmin` on every route, asserted in the E2E as well as the route test          |
| R7  | 1     | `EvalRun` / `EvalCaseResult`                                                          |
| R8  | 3     | Thresholds and the failing badge                                                      |
| R9  | 3     | Per-check breakdown                                                                   |
| R10 | 2     | Needs `usdFor` split out of `logUsage` without changing the log line                  |
| R11 | 1     | Nothing added to the CI workflow; the E2E runs a pinned subset (see Spikes)           |
| R12 | 1     | Structural — the seam reads no database. Asserted by row counts across a run          |
| R13 | 3     | `SweepSpec` via `registerSweep`                                                       |
| R14 | 5     | Same-corpus series only                                                               |
| R15 | 4     | Classifier accuracy                                                                   |

Every `Must` has a slice. No slice carries work without a requirement.

## Spikes

- **Does the E2E spec cost money on every CI run, and if so what does it call
  instead?** — timebox 2h, blocks slice 1's E2E. `OPENAI_API_KEY` is not set in
  the e2e job today, so `isEvalConfigured()` would refuse and the spec would
  assert a 503 rather than a result. Three ways out: pin the E2E to a tiny
  subset and give CI a key (real, costs cents, can flake); seed `EvalRun` rows
  directly and let the E2E cover only the screen (cheap, proves no model path);
  or run the spec against a stubbed provider through the existing
  `mock.module` seam (proves the plumbing, not the model). **The second is the
  recommendation** — the harness's whole point is that the model path is
  measured on demand rather than on a gate, and an E2E that spends money on
  every push is the same mistake R11 exists to prevent. Settle this before
  writing slice 1's spec, not after.
- **Is `resetDb` + the in-process Postgres fast enough for a runner test that
  writes 30 cases × 5 repeats of rows?** — timebox 1h, blocks slice 2's tests.
  Measured cost is ~150ms per route test on Windows and ~26-39ms on CI
  (`testing.md`); a run's worth of rows is a different shape. If it is slow, the
  answer is a smaller fixture set in the test, not a fake client — ADR-0014 is
  not reopened by this.

## Deferred

- **An LLM judge on answer quality** — PRD non-goal. Every metric here has
  binary ground truth; a judge is a second unmeasured model call grading a first.
- **Model-generated cases** — PRD non-goal. All 30+ are written by hand.
- **Evals for `polish` and `summarize`** — PRD non-goal; both have a human
  reading the output.
- **The Agent SDK inside the product** — PRD non-goal, and the epic this one
  exists to make measurable.
- **A cost ceiling** — the PRD records and does not cap, deliberately.
- **A per-page `<Tutorial>` on `/evals`** — every other main page has one, but
  `TutorialPageKey` is a **Postgres enum**, so a new key is a migration plus
  seed content. Out of this epic; worth its own small issue once the screen has
  settled, rather than writing tutorial steps against a page that changes in
  five slices.
- **A "New" nav badge** (`NEW_FEATURE_KEY` / `NEW_FEATURE_VERSIONS`) — same
  reasoning, and it is two lines whenever somebody wants it.
