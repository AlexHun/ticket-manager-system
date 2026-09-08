# PRD: An eval harness for the unattended path

**Status:** Draft · **Author:** Aleksei Hunich · **Date:** 2026-09-08

## Problem

The auto-reply writes prose to a customer with nobody reading it, and nothing in
this repo measures whether it is any good. The numbers that justify the current
design — a planted money sentence obeyed in 7 runs of 9, a planted link in 10 of
10, every one caught by the output checks — are prose in a comment in
`ai/auto-reply.ts`, recorded by hand once and never refreshed. The nearest thing
to a harness is `pipeline-scenarios.ts`: seven cases that declare where they
expect to land, checked by a human clicking a button on `/pipeline`. So a prompt
edit, a model change, or an edited knowledge article can move the decline
decision or defeat a safety check, and the only thing that would notice is
somebody remembering to click through seven scenarios and compare against a
paragraph. `ai/*.test.ts` does not close this: it stubs the provider, so it
proves the plumbing and says nothing about the model.

## Users

`admin` only. The job: change something on the unattended path — a prompt, the
model, an output check, a knowledge article — and find out within minutes
whether the desk still declines what it should decline and still catches what it
should catch, without reading nine scenarios by hand.

`agent` is unaffected; this never appears on their screens. The assistant is the
subject of the measurement, not a user of it.

## Success metrics

| Metric                                                                                                                  | Today                                       | Target                                         |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------- |
| **Safety catch rate** — share of adversarial repeats where the planted payload was caught before the reply was accepted | 17/17, measured by hand, once, on two cases | 100% — inherited from ADR-0004, not a forecast |
| **Decline accuracy** — share of repeats reaching the expected outcome, and the expected reason when declined            | unknown                                     | TBD — needs a slice-2 baseline                 |

Supporting: estimated USD per run, recorded and shown.

Guardrail: an eval run must not change what any customer or agent sees. Zero
tickets, messages, activity rows or outbound email created or modified by a run.

## Scope

### In this pass

| #   | Requirement                                                                                                                                                                          | Priority |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| R1  | The Pipeline page and an eval run read the same case definitions, so the two can never disagree about where a case is expected to land.                                              | Must     |
| R2  | The case set covers at least 30 cases, including at least one for each of the nine `AUTO_REPLY_DECLINE` reasons and at least four adversarial payloads.                              | Must     |
| R3  | A run answers every case 5 times against the real provider and records, per case, how many of those repeats reached the expected outcome — a rate, never a single pass or fail.      | Must     |
| R4  | A run records whether it answered against the frozen seed corpus or the live knowledge articles, and results from the two are never averaged into one number.                        | Must     |
| R5  | An admin can start a run from inside the app without the request blocking on it, and can watch a run in progress reach completion without reloading the page.                        | Must     |
| R6  | An `agent`, and an unauthenticated visitor, can neither start a run nor read any run's results.                                                                                      | Must     |
| R7  | A finished run's numbers survive a restart and a deploy, and stay readable months later alongside every earlier run.                                                                 | Must     |
| R8  | Each metric carries a declared threshold; a run whose metric falls below its threshold is marked failing and shown as failing, and nothing else happens — no issue, no notification. | Must     |
| R9  | Adversarial catch rate is reported separately from decline accuracy, and broken down by which check caught the payload.                                                              | Must     |
| R10 | A run records its estimated cost in USD and shows it beside the run.                                                                                                                 | Must     |
| R11 | No eval run happens in the pull-request CI job, and no eval result can turn a pull request red.                                                                                      | Must     |
| R12 | An eval run creates and modifies nothing a customer or agent would see: no ticket, message, activity row or outbound email.                                                          | Must     |
| R13 | A run happens nightly, unattended, against the frozen corpus.                                                                                                                        | Should   |
| R14 | The screen shows how each metric moved against the previous run on the same corpus.                                                                                                  | Should   |
| R15 | Classifier accuracy — the share of repeats filed under the expected category — is reported as an additional metric.                                                                  | Should   |

### Non-goals

- **A model judging answer quality.** Scoring the prose a customer reads needs a
  judge, and a judge is a second unmeasured model call grading a first one.
  Every metric here has binary ground truth instead. Its own PRD, once this
  proves out.
- **Generating cases with a model.** Every case is written by hand this pass —
  the two adversarial payloads that matter came from real measured runs, not
  from a generator.
- **Evals for `polish` and `summarize`.** Both have a human reading the output
  before it goes anywhere. The unattended path is where a bad answer reaches a
  stranger.
- **Running the desk on an agent loop (Agent SDK).** The argument for building
  this first is that it makes that change measurable. Doing both at once
  forfeits exactly that.
- **A kill switch in `AutomationSettings`.** A run touches fixtures, never a
  customer thread; admin-only is the whole authority story (R6, R12).
- **Blocking a merge on eval results.** R11 is deliberate: a slow, real,
  statistical suite wired to a required check is a suite that gets disabled.

## Constraints

- **ADR-0004** is what this measures. The catch rate is that ADR's claim
  expressed as a number; nothing here may become an argument for weakening a
  check, and a run reporting 100% is not permission to relax one.
- **ADR-0003** — one provider. Runs go through the same `gpt-5-nano` handle and
  the same `OPENAI_API_KEY` as the four shipped features; unset means a run
  cannot start, in line with how the rest of the app degrades.
- **ADR-0007** and `tech-stack.md` — no new infrastructure. Postgres, Express
  and pg-boss only. A hard boundary, not a preference.
- Settled before this PRD and not reopened here: results live in the application
  database; one runner is shared by a CLI and an admin-triggered background job;
  the case set moves into `packages/core` so both readers share it.
- Prompt caching is load-bearing on the auto-reply (`ai-features.md`: `cached=0`
  is the regression nothing on any screen would show). Repeats of a case must
  not perturb the prompt prefix — no run id, timestamp or counter in front of
  the corpus.

## Risks

| Risk                                                                                                                                                         | Impact                                                                                                                       | Mitigation                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Five repeats is a small sample. A metric moving from 5/5 to 3/5 is hard to tell from noise, and a threshold set too tight makes every run red for no reason. | The harness cries wolf, then gets ignored — the exact failure it exists to prevent.                                          | Report rates rather than verdicts (R3), set thresholds with margin off the slice-2 baseline, and read a move against the trend of prior runs (R14) rather than one run alone.  |
| Live-corpus runs make a red run ambiguous: a prompt regression and an admin's article edit look identical.                                                   | Time lost chasing the wrong cause; worse, a real regression dismissed as "someone edited the KB".                            | Every run is labelled with its corpus and the two are never mixed (R4); the nightly runs frozen, so that trend line moves only when the code does.                             |
| The cases are written by the person who wrote the prompt, against expectations that person already holds.                                                    | The harness confirms its author's beliefs and misses the failure nobody imagined.                                            | The adversarial cases are not invented — they are payloads that already beat the prompt in measured runs. Add a case for every real decline seen in production, as they occur. |
| An unattended nightly run spends money forever with nobody watching the bill.                                                                                | Quiet cost, discovered on an invoice.                                                                                        | Cost recorded and shown per run (R10). No ceiling this pass — a deliberate choice; revisit if the number surprises anyone.                                                     |
| A run that exercises the real ingestion path would create real ticket rows.                                                                                  | Eval traffic pollutes the ticket list, the dashboard aggregates and the activity trail — the desk's own numbers start lying. | R12 states the guarantee; the open question below must be settled before slice 1 picks an entry point.                                                                         |

## Open questions

- [ ] **Target for decline accuracy is TBD** — needs the slice-2 baseline before
      a number means anything. Confirm who sets it once that run exists.
- [ ] **The two metrics disagree about their targets.** The interview answer was
      "both primary, no target yet", but the safety catch rate already has a
      measured baseline and ADR-0004 fixes its target at 100% by construction —
      a fail-closed check that catches 96% is a bug, not a score. Written as
      100% above; confirm, or downgrade it to TBD alongside the other.
- [ ] **How does a case reach the auto-reply?** Through the real ingestion path
      (which creates ticket rows, contradicting R12), or by handing the
      auto-reply a synthesized input directly (which skips ingestion, so an
      ingestion bug would be invisible to the harness)? _Blocks R12 and slice 1._
- [ ] **Where does the nightly run?** A repo CI schedule, or a scheduled job in
      the deployed API — both stay inside the no-new-infrastructure rule, and
      they differ on which corpus and which environment is reachable.
      _Blocks R13._
- [ ] **Assumed:** 5 repeats is fixed, not configurable per run — a configurable
      count makes runs incomparable, which is why it was assumed fixed. Confirm.
- [ ] **Assumed:** the nightly runs the frozen corpus only, and live-corpus runs
      are always started by hand. Confirm.
- [ ] **Assumed:** "at least 30 cases" (R2) is the bar, from the grilling's
      "30-40". Confirm nobody expects even coverage across the nine decline
      reasons — three of them (`noText`, `answered`, `category`) never reach the
      model at all and are cheap to cover.
