# A feature's config guard stays a module, not a threaded value

`isPolishConfigured()`, `isSummarizeConfigured()` and `isEvalConfigured()` each
stay where they are: a one-line export in a leaf module, read by the callers
that need it. Configuration is **not** threaded in as a value.

This settles a question [testing.md](../standards/testing.md) invited by
recording the reason those modules exist and nothing about the alternative. The
reason is not a domain one — there is one key behind every AI feature
([ADR-0003](0003-every-ai-feature-runs-on-one-provider.md)), so "can polish" and
"can run an eval" are the same question. The modules exist because
`mock.module`'s registry is one process wide: a caller reading `../ai/provider`
directly forces its test file onto a specifier `jobs/sweeps.test.ts` already
owns with a **stateful** stub, and two stateful copies are two boxes of which
the registry keeps one, leaving the other file's switch inert (#174).

[ADR-0014](0014-api-tests-run-against-a-real-postgres-in-process.md) made
exactly the value-shaped move for the database binding and took sixteen
registrations down to one preload, so it was fair to ask whether the same move
works here. It does not, and the reason it does not is the reason a preload
could not be used in the first place: a preload works when there is one right
answer for the whole process, and every test wants a different answer to this
one.

Answered from a converted call site, not from documentation
([#209](https://github.com/AlexHun/ticket-manager-system/issues/209)). The
branch converts `routes/evals.ts` end to end — the router becomes
`createEvalsRouter(config)`, `src/index.ts` builds it with
`{ evalConfigured: isAiConfigured() }`, and `routes/evals.test.ts` sets a field
on a plain object instead of registering `mock.module("../evals/config", …)`.
Every figure below was measured on that branch.

## Considered Options

**Thread the answer in as a value** (the proposal). The converted route works
and the suite is green, so this is a rejection on cost rather than on
feasibility. Four costs, in the order they were found.

1. **The value cannot be a value.** `serveRouter` mounts one app per test file,
   so a `boolean` captured at `createEvalsRouter` freezes for the whole file and
   the two tests that need `false` cannot get it. Measured rather than reasoned:
   reading `config.evalConfigured` once at construction takes
   `routes/evals.test.ts` from 34 pass / 0 fail to 32 pass / **2 fail** — the
   503-with-no-key test and the `evalConfigured: false` test, which are the only
   two the guard exists for. So what is threaded is a mutable object read per
   request. That is a public mutable field on the app's configuration surface,
   replacing a function that reads an immutable module-level `const` — a worse
   invariant in production, bought for a test.

2. **One of the three callers is a registration site that cannot receive it.**
   The eval harness's second gate is the early return at the top of
   `enqueueEvalRun`. Threading it walks: `enqueueEvalRun` gains an
   argument (after an optional `db?`, so it becomes an options object) →
   `startEvalRun` gains one → its two callers must supply it. The route can. The
   other is `startNightlyRun`, which is `EVAL_NIGHTLY_SWEEP.run`, and
   `SweepSpec.run` is `() => Promise<void>` — _"Takes no payload: a cron tick
   carries nothing, and everything one of these needs to know is in the rows it
   reads."_ It has nowhere to receive a value from. The two ways out are to
   close over a module-level mutable — which is the module just deleted, minus
   the docblock explaining it — or to turn the exported spec into a factory,
   which changes what `eval-nightly.test.ts` imports and leaves this one of
   **six** `SweepSpec`/`WorkerSpec` module-level constants shaped differently
   from the other five, for a guard no test flips and that is belt to two
   braces already (the route refuses first; `jobs/index.ts` does not register
   the worker without a key).

3. **The third caller was never paying for the module anyway.** `jobs/index.ts`
   already imports `isAiConfigured` from `../ai/provider` for the classifier and
   the auto-reply, and has no test file. Its `isEvalConfigured()` could become
   `isAiConfigured()` today, under either verdict, and cost nothing. It is not
   evidence for threading; it is one line of ceremony that can go on its own.

4. **The diff is not where the cost is, but it is not nothing.** Converting one
   caller: +217/−185 in `routes/evals.ts` (185 of those lines are the two
   handlers re-indented into the factory), +7/−2 in `src/index.ts`, +27/−18 in
   the test. Against a module of 28 lines, 24 of which are the docblock.

**Keep the one-line module** (chosen). Its cost is one leaf file per feature
that a route or a registration consults through a narrow question, and that cost
does not grow with the number of callers — `isEvalConfigured()` is read from
three places and the module did not get bigger. Its benefit is that every caller
keeps the shape it wants: a router stays `export const evalsRouter`, an enqueue
stays a plain function, a sweep stays a `SweepSpec` const, and each caller's
test gets a specifier nothing else in the suite owns.

The framing that made threading look cheap — "it is one line over
`isAiConfigured`" — undercounts what the file is. The line is not the content.
Both rules the module holds had to be **moved, not deleted**, when the route was
converted: the registry reasoning and the rule that `AUTO_REPLY_ENABLED` is
deliberately not consulted (an eval answers a synthesized input and writes to
nobody, so a deployment that has turned the feature off is precisely one where
measuring it still makes sense — the key is the only gate). On the converted
branch both live in `EvalsConfig`'s docblock inside a 690-line router, which is
a worse home for them and not a smaller one.

## Where value-passing does still win

Two narrower places, so a future review can tell this decision from a blanket
one.

- **A binding with one right answer for the whole process** is ADR-0014's case,
  and the preload beats both forms. Nothing here reopens that.
- **A collaborator, as opposed to a configuration answer**, has none of the four
  costs above: no registration site to reach, no per-request mutability, no
  factory. [#214](https://github.com/AlexHun/ticket-manager-system/issues/214)
  is that shape — passing the eval runner its classifier — and it is being
  closed only because its own acceptance criteria defer to this spike. If it is
  revived it should be argued on its own terms, not on this verdict.

## Consequences

**`docs/standards/testing.md` keeps its #174 rule and gains a pointer here**, so
the next architecture review finds the measurement rather than re-suggesting the
losing option.

**`evals/config.ts`, `ai/polish.ts`'s and `ai/summarize.ts`'s guards stay.**
[#213](https://github.com/AlexHun/ticket-manager-system/issues/213) and #214 are
closed with this reasoning.

**CI now runs the API suite in a second file order**, and that is the one part
of this branch that ships. It is the check testing.md already prescribes
(`bun test <a> <b>` in both orders) moved off the honour system, and it catches
what the by-hand version structurally cannot: a collision whose poisoning file
is a _third_ one, which no pair run ever puts in the same process — the shape of
#158, green three runs in a row on Windows and red on ubuntu-latest. ~30s on top
of a job that already runs the same suite forward.

**What was measured**: 558 pass / 0 fail across 31 files, forward and reverse.
The spike branch carries both states as separate commits, each with its own CI
run — the conversion first, then this revert of it — so "green in a second file
order" is on record for the option that lost as well as the one that won. The
run links are on the pull request.
