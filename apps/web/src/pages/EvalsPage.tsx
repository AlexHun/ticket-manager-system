import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronRight, Loader2, Play } from "lucide-react";
import {
  EVAL_CORPUS,
  EVAL_CORPUS_DEFAULT,
  EVAL_METRIC,
  EVAL_RUN_LIMIT,
  EVAL_RUN_STATUS,
  PIPELINE_OUTCOME,
  type AutoReplyDecline,
  type EvalCaseResultRow,
  type EvalCategoryRow,
  type EvalCorpus,
  type EvalFiledRow,
  type EvalMetric,
  type EvalMetricRow,
  type EvalPreviousMetric,
  type EvalReachedRow,
  type EvalRunRow,
  type EvalRunStartedResponse,
  type EvalRunsResponse,
  type PipelineOutcome,
  type TicketCategory,
} from "@ticket/shared";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import {
  EVAL_BAND,
  judgeAbandoned,
  judgeCache,
  judgeMetric,
  points,
  type EvalBand,
  type EvalJudgement,
} from "@/lib/eval-bands";
import { evalKeys } from "@/lib/eval-queries";
import { extractErrorMessage } from "@/lib/errors";
import { DECLINE_SHORT } from "@/lib/pipeline-labels";
import { TableFrame } from "@/lib/table-frame";
import { cn } from "@/lib/utils";

/**
 * Whether the unattended path still does what we think it does.
 *
 * The numbers justifying the auto-reply's design — a planted money sentence
 * obeyed in 7 runs of 9, a planted link in 10 of 10, every one caught by the
 * output checks — were prose in a comment, recorded by hand once and never
 * refreshed. This page is where they become a measurement: cases whose expected
 * outcomes are written down, each answered five times against the real
 * provider, and compared.
 *
 * **A run touches no ticket.** Every case is handed to `autoReply` as a
 * synthesized input rather than posted through ingestion, so the code a run
 * reaches cannot write a ticket, a message, an activity row or an email. That
 * is why this screen can spend money without anything on an agent's screen
 * moving.
 *
 * **Every number here is a rate over five repeats, and never a pass.** One
 * answer from a model is a coin toss reported as a fact. The corollary is on
 * screen too: a run says which corpus it answered, because a frozen run and a
 * live run are two series and averaging them makes a red result unattributable
 * between a prompt regression and somebody editing an article.
 *
 * **One corpus on screen at a time, chosen by one control** (#234). The
 * selector filters the list *and* aims the Run button, and there is no "all":
 * the two series are never averaged, so stacking them in one column invites
 * reading a red frozen run and a red live run as one trend, and an "all" the
 * Run button could not honour would be a control meaning two different things
 * depending on which half of the page you were looking at. The filter is the
 * server's — `GET /api/evals/runs?corpus=…` — which is what puts the list's cap
 * inside the series rather than across both.
 *
 * **A run folds to its headline numbers** (#237). Twenty full cards is a page
 * nobody scrolls, so only the newest is open on arrival and a closed one keeps
 * exactly what decides whether to open it — see `RunCard`.
 */

/** What a case did, in words. `notOffered` never reaches a run's own row. */
const OUTCOME_LABEL: Record<PipelineOutcome, string> = {
  [PIPELINE_OUTCOME.resolved]: "Answered",
  [PIPELINE_OUTCOME.declined]: "Declined",
  // Four causes, one word, and the label has to be true of all of them: the
  // classifier out of retries, a provider that could not be reached, an
  // emptied corpus, and a call whose budget went on reasoning. It said
  // "Provider unreachable", which is true of one (`docs/adr/0019`).
  [PIPELINE_OUTCOME.abandoned]: "No verdict reached",
  [PIPELINE_OUTCOME.pending]: "Still running",
  [PIPELINE_OUTCOME.notOffered]: "Not offered",
};

const CORPUS_LABEL: Record<EvalCorpus, string> = {
  [EVAL_CORPUS.frozen]: "Frozen corpus",
  [EVAL_CORPUS.live]: "Live articles",
};

/**
 * The metrics, named for what they measure rather than for the field.
 *
 * A `Record`, so a third metric is a compile error here until somebody has
 * written a heading for it — the same rule the thresholds themselves keep.
 */
const METRIC_LABEL: Record<EvalMetric, string> = {
  [EVAL_METRIC.catchRate]: "Safety catch rate",
  [EVAL_METRIC.declineAccuracy]: "Decline accuracy",
  [EVAL_METRIC.classifierAccuracy]: "Classifier accuracy",
};

/**
 * What the number underneath a metric counts, in words.
 *
 * The denominators are different in kind, all three of them, and that is worth
 * spelling out rather than printing three bare fractions. Decline accuracy is
 * taken over every repeat in the run; the catch rate only over the repeats where
 * the model actually planted the payload — usually a handful, and reading it as
 * though it were out of 175 would make a 3-of-4 look like a rounding error; and
 * classifier accuracy over the repeats the classifier answered, on the cases it
 * can be scored against at all.
 */
const METRIC_UNIT: Record<EvalMetric, string> = {
  [EVAL_METRIC.catchRate]: "payloads attempted",
  [EVAL_METRIC.declineAccuracy]: "repeats",
  // A third denominator, different again: repeats the classifier *answered*, on
  // the cases it can be scored against at all. Two of the cases cannot be — one
  // expects classification to have failed, the other carries no message to read
  // — so this is never the run's repeat count and printing it as a bare
  // percentage would invite reading it as one.
  [EVAL_METRIC.classifierAccuracy]: "repeats classified",
};

/** The one place a filed-nowhere repeat is given a word. */
const UNCLASSIFIED = "Unclassified";

/** A category, or the word for a repeat the classifier could not answer. */
function categoryLabel(category: TicketCategory | null): string {
  return category ?? UNCLASSIFIED;
}

/**
 * An outcome with its reason, the way a result row reads it.
 *
 * `DECLINE_SHORT` rather than a second set of words: the rail already says
 * these ten things, and two files' worth of carefully-argued wording is two
 * files' worth that will eventually disagree — which is the whole reason
 * `pipeline-labels.ts` exists.
 */
function verdict(
  outcome: PipelineOutcome,
  decline: AutoReplyDecline | null,
): string {
  const label = OUTCOME_LABEL[outcome];
  return decline ? `${label} — ${DECLINE_SHORT[decline]}` : label;
}

/**
 * How a band draws. Text only — the figure is the loudest thing in the tile
 * already, and a filled chip on six tiles would leave the card no quiet state.
 *
 * `good` is tinted here, unlike the dashboard's `StatTile`, and the difference
 * is deliberate. A dashboard tile is one of many and mostly unremarkable, so
 * colouring its healthy state spends the contrast; every number on this card is
 * a measurement somebody came here to judge, and "passing" is the answer they
 * came for. Leaving it in the foreground colour is what made this page silent
 * until something broke.
 */
const BAND_CLASS: Record<EvalBand, string> = {
  [EVAL_BAND.good]: "text-status-good",
  [EVAL_BAND.marginal]: "text-status-warning",
  [EVAL_BAND.bad]: "text-status-critical",
};

/** A share, as a whole-number percentage. Nothing here deserves a decimal. */
function percent(numerator: number, denominator: number): string {
  if (denominator === 0) return "—";
  return `${points(numerator / denominator)}%`;
}

/**
 * How far one metric moved since the previous run on this corpus (R14).
 *
 * **Percentage points, and the "pp" is not decoration.** A rate that went from
 * 90% to 84% fell by six points and by seven percent, and the two are different
 * numbers that a bare "-6%" invites confusing — which matters here because the
 * whole purpose of this line is somebody deciding whether a prompt edit made
 * things worse.
 *
 * **The difference is between the two figures as drawn**, not between the rates
 * behind them, so "unchanged" is a claim about what is on screen rather than an
 * assertion about hidden decimals, and no caption can ever contradict the number
 * it sits under.
 *
 * Terse on purpose: the card says which run this is against and when it ran,
 * once, so three tiles do not have to repeat it. An unmeasured side is its own
 * sentence rather than a zero — see `EvalPreviousMetric`.
 */
function deltaLabel(
  value: number | null,
  previous: EvalPreviousMetric,
): string {
  const before = previous.value === null ? null : points(previous.value);
  const now = value === null ? null : points(value);

  // Four sentences, because four things can be true, and only one of them is a
  // number. A run that measured something its predecessor did not has *started*
  // measuring, which is news; a run that measured nothing this time still gets
  // told what the figure was, because "—" beside a remembered 100% is the shape
  // of a quiet night, and "—" beside a remembered 40% is not.
  if (before === null)
    return now === null ? "neither run measured this" : "not measured last run";
  if (now === null) return `previously ${before}%`;

  const moved = now - before;
  if (moved === 0) return "unchanged";
  return `${moved > 0 ? "+" : ""}${moved}pp`;
}

/**
 * One headline number with its own denominator underneath it.
 *
 * The denominator is not decoration. "84%" over 5 repeats and "84%" over 175
 * are different claims, and a screen that shows only the first invites the
 * second reading — which is exactly the "five repeats is a small sample" risk
 * the PRD opens with.
 */
function Metric({
  label,
  value,
  detail,
  delta,
  judgement,
}: {
  label: string;
  value: string;
  /**
   * The denominator, in words. Omitted by the one tile whose whole caption is
   * its judgement — see `judgeAbandoned`, where the sentence that used to sit
   * here now travels as the label so it is not said twice.
   */
  detail?: string;
  /** How far this moved since the last run on the same corpus (R14). */
  delta?: string;
  /**
   * How this number reads against what it had to clear, from `eval-bands.ts`.
   *
   * Named for the act rather than for `verdict` above, which is CONTEXT.md's
   * word for where a repeat landed — judging is what a threshold does to a
   * rate, and the two are different acts on the same card.
   *
   * One prop carrying both the colour and the word, so neither can be supplied
   * without the other: colour is never the only cue on this page, and a `band`
   * without a `label` is exactly the tile that would break that. Omitted where
   * there is nothing to judge — the tile then draws in the ordinary foreground
   * and its detail line says why.
   */
  judgement?: EvalJudgement | null;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "text-2xl font-semibold tabular-nums",
          judgement && BAND_CLASS[judgement.band],
        )}
      >
        {value}
      </div>
      {/* The judgement rides in the caption as a word rather than in a badge of its
          own, and it is what makes the colour redundant: a greyscale
          screenshot, a colour-blind reader and a screen reader all get the
          judgement in the same place they already get the denominator. */}
      <div className="text-xs text-muted-foreground">
        {detail}
        {detail && judgement && " · "}
        {judgement && (
          <span className={cn("font-medium", BAND_CLASS[judgement.band])}>
            {judgement.label}
          </span>
        )}
      </div>
      {/* Muted whichever way it went, deliberately, and it stayed muted when
          the rest of the card learned to colour itself. A band on this page
          says where a number stands against the bar it was declared to need;
          a delta says which way it moved, and the two are not the same claim —
          a metric can fall six points and still be clear. Colouring every
          downward drift would spend the band's signal on run-to-run noise,
          which is the PRD's opening risk: a harness that cries wolf is a
          harness nobody reads. A move that matters has already changed the
          band on the figure above. */}
      {delta && (
        <div className="text-xs tabular-nums text-muted-foreground">
          {delta}
        </div>
      )}
    </div>
  );
}

/**
 * One judged metric: the rate, what it had to clear, and whether it did (R8).
 *
 * The threshold is on screen beside every number rather than only when one is
 * missed, because a metric whose bar is invisible until it is broken is a
 * metric nobody can argue with in advance — and these two bars are exactly the
 * sort that want arguing about. It comes from the **run**, not from this
 * build's constant, so an old run keeps saying what it was judged against.
 *
 * An unmeasured metric draws "—" and the reason, **and no band**. That is the
 * catch rate on a run where the model planted no payload, and it is neither a
 * zero nor a hundred percent: a green 100% there would be the most misleading
 * thing this page could say, since nothing was ever tested. Which band a
 * measured one lands in — and the word that says so without colour — is
 * `judgeMetric`'s call, in `eval-bands.ts`.
 */
function MetricCell({ row }: { row: EvalMetricRow }) {
  return (
    <Metric
      label={METRIC_LABEL[row.metric]}
      value={row.value === null ? "—" : percent(row.numerator, row.denominator)}
      judgement={judgeMetric(row)}
      delta={
        row.previous === null ? undefined : deltaLabel(row.value, row.previous)
      }
      detail={
        row.value === null
          ? `no ${METRIC_UNIT[row.metric]} in this run`
          : `${row.numerator} of ${row.denominator} ${METRIC_UNIT[row.metric]} · needs ${points(row.threshold)}%`
      }
    />
  );
}

/** Where a case landed, and how often, most frequent first. */
function Reached({ reached }: { reached: EvalReachedRow[] }) {
  if (reached.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <ul className="space-y-0.5">
      {reached.map((row) => (
        <li
          key={`${row.outcome}:${row.decline ?? ""}`}
          className={cn(
            "flex gap-2",
            row.matched ? "text-foreground" : "text-muted-foreground",
          )}
        >
          <span className="tabular-nums">{row.count}×</span>
          <span>{verdict(row.outcome, row.decline)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Where the classifier put this case's repeats (R15).
 *
 * A rate and the categories behind it, for the reason every other cell on this
 * row is a rate: "4/5" is the number a threshold reads and "the fifth went to
 * Other" is the thing somebody would act on. A case the classifier is not
 * scored against draws a dash rather than a zero — there is no measurement, and
 * "0/0" invites reading one.
 */
function Filed({ result }: { result: EvalCaseResultRow }) {
  if (result.expectedCategory === null) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <>
      <span
        className={cn(
          "tabular-nums",
          result.classifyMatches === result.classifiedRepeats
            ? "text-foreground"
            : "text-muted-foreground",
        )}
      >
        {result.classifyMatches}/{result.classifiedRepeats}
      </span>
      <div className="text-xs text-muted-foreground">
        expected {result.expectedCategory}
      </div>
      {/* Only the ones that went somewhere else. A case filed as expected every
          time has said so in the rate above, and repeating it here would bury
          the rows that did not under the rows that did. */}
      <ul className="mt-0.5 space-y-0.5 text-xs">
        {result.filed
          .filter((row: EvalFiledRow) => !row.matched)
          .map((row) => (
            <li key={row.category ?? ""} className="flex gap-1.5">
              <span className="tabular-nums">{row.count}×</span>
              <span>{categoryLabel(row.category)}</span>
            </li>
          ))}
      </ul>
    </>
  );
}

function ResultRow({ result }: { result: EvalCaseResultRow }) {
  const clean = result.matches === result.repeats;

  return (
    <tr className="border-t border-border">
      <td className="px-3 py-2 align-top">
        <div className="flex items-center gap-2">
          <span className="font-medium">{result.caseName}</span>
          {/* The payloads are aggregated apart from the rest, so they are
              marked apart from the rest. */}
          {result.adversarial && (
            <Badge variant="outline" className="text-xs">
              Payload
            </Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground">{result.caseId}</div>
      </td>
      <td className="px-3 py-2 align-top text-muted-foreground">
        {verdict(result.expectedOutcome, result.expectedDecline)}
      </td>
      <td className="px-3 py-2 align-top">
        <Reached reached={result.reached} />
      </td>
      <td className="px-3 py-2 align-top">
        {/* A rate, and never a tick. Five repeats that split 3/2 is the finding
            this page exists to show, and a boolean would round it away. */}
        <span
          className={cn(
            "tabular-nums",
            clean ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {result.matches}/{result.repeats}
        </span>
        {result.abandoned > 0 && (
          <div className="text-xs text-muted-foreground">
            {result.abandoned} unanswered
          </div>
        )}
        {/* A payload's row carries a second number, because "as expected" is
            not the safety question. `hostile-display-name` expects a clean
            reply and gets one; whether the link in that From name reached it is
            a different fact, and one a 5/5 would hide entirely. */}
        {/* The one coloured thing in this table, and it stays: the per-case
            *rates* are deliberately unbanded — thirty-six coloured rows would
            spend the signal the six headline numbers need — but an escape is
            not a rate, it is the defect, and the row it happened on is the only
            place that says which case it was. `status-critical` rather than
            `destructive`, so red means one thing on this page. */}
        {result.escaped > 0 && (
          <div className="text-xs font-medium text-status-critical">
            {result.escaped} escaped
          </div>
        )}
        {result.caught > 0 && (
          <div className="text-xs text-muted-foreground">
            {result.caught} caught
          </div>
        )}
      </td>
      <td className="px-3 py-2 align-top">
        <Filed result={result} />
      </td>
    </tr>
  );
}

/**
 * One run, folded to its headline numbers unless you open it (#237).
 *
 * Twenty of these stack on the page and each one used to draw a screenful:
 * six metrics, two breakdowns and a 36-row table. What survives the fold is
 * exactly what decides whether to open a card — which run, which corpus, when,
 * how it ended, and the three judged rates with their bands, verdict words and
 * run-to-run deltas. Cost is the one number that reads like a headline and is
 * not one: it is audited monthly rather than scanned, so it folds away with the
 * cache figure, the unanswered count and the breakdowns.
 *
 * **The escaped-payload warning never folds.** Every other value here is a
 * measurement; that one is a defect, and a fold that hid it would hide the one
 * thing on this page nobody may miss.
 *
 * **Two toggles, not one**, because the table is the bulk of an open card and
 * an admin reading the metrics rarely wants all thirty-six rows with them.
 *
 * Open state is `useState` and stays that way: which runs you had open goes
 * stale as runs age off the page, so remembering it between visits would be
 * restoring a layout that no longer describes the list.
 */
function RunCard({
  run,
  defaultOpen,
}: {
  run: EvalRunRow;
  defaultOpen: boolean;
}) {
  // Seeded from the prop and owned from there on, so a refetch that redraws the
  // list — a run filling in over `/api/events` does one per case — cannot fold
  // a card the admin has just opened.
  const [open, setOpen] = useState(defaultOpen);
  // Closed on every run, including the open one. The table is the other
  // thirty-six rows of the card, and the metrics above it are what an admin
  // came for.
  const [casesOpen, setCasesOpen] = useState(false);
  const running = run.status === EVAL_RUN_STATUS.running;
  const answered = run.results.reduce((n, r) => n + r.repeats, 0);
  // Only the pairs that disagree. A run where everything landed where it should
  // has said so in the rate, and listing the matches beside the misses is how a
  // breakdown stops being read at all.
  const misfilings = run.categories.filter(
    (row: EvalCategoryRow) => !row.matched,
  );

  return (
    /* The Collapsible wraps the Card rather than being it (`asChild`), the same
     * way `TestRunnerPage` does it: Radix stamps `data-slot="collapsible"` on
     * whatever it renders, and on the Card that would overwrite the
     * `data-slot="card"` its own child selectors read. */
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-3 text-base">
            {/* Only the run's name is the trigger. The badges beside it are the
              status, not controls, and a header row that was one button would
              read as a single unlabelled target to a screen reader. */}
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="-ml-1.5 text-base font-semibold"
              >
                <ChevronRight
                  aria-hidden
                  className={cn("transition-transform", open && "rotate-90")}
                />
                Run {run.id}
              </Button>
            </CollapsibleTrigger>
            {/* The corpus is on every run and is never averaged across — a live
              run and a frozen run are two series, not one. Saying so on the
              card is what stops somebody reading them as one. */}
            <Badge variant="outline">{CORPUS_LABEL[run.corpus]}</Badge>
            {running && (
              <span className="inline-flex items-center gap-1.5 text-sm font-normal text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                {run.results.length === 0
                  ? "Running"
                  : `Running — ${run.results.length} ${
                      run.results.length === 1 ? "case" : "cases"
                    } answered`}
              </span>
            )}
            {run.status === EVAL_RUN_STATUS.failed && (
              <Badge variant="outline">Failed</Badge>
            )}
            {/* Two different pieces of news, and the badges are deliberately not
              the same one. "Failed" is the run falling over — the provider was
              unreachable, the queue gave up — and it has no numbers. "Failing"
              is a run that finished and whose numbers are below what they were
              declared to need, which is the answer this page exists to give. */}
            {run.failing && <Badge variant="destructive">Failing</Badge>}
            <span className="ml-auto text-sm font-normal text-muted-foreground">
              {new Date(run.startedAt).toLocaleString()}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Above the numbers, and in words rather than as a red figure among
            black ones. Every other value on this card is a measurement; this
            one is a defect — a payload reached a reply the desk was willing to
            send, which is ADR-0004's claim failing.

            Now that the numbers below are coloured too, saying it in red is no
            longer enough to say it is different in kind: a missed threshold and
            an escaped payload would be the same critical red, one of them a
            score and the other a break. So this one is the only thing on the
            card with a filled, bordered ground — the loudest treatment on the
            page, held in reserve for the one value that is not a measurement.
            The word "defect" carries the same distinction without colour. */}
          {run.escaped > 0 && (
            <p
              className={cn(
                "mb-3 flex items-start gap-2 rounded-md border p-3 text-sm",
                "border-status-critical/40 bg-status-critical-soft text-status-critical",
              )}
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                <span className="font-semibold">Defect — </span>
                {run.escaped} adversarial{" "}
                {run.escaped === 1 ? "repeat" : "repeats"} reached an accepted
                reply still carrying the planted payload. The output checks did
                not hold.
              </span>
            </p>
          )}

          {/* Which run the deltas below are against, said once (R14).
            Per-metric it would be the same sentence three times; on the card it
            is one line, and it is the line that makes a "-6pp" mean something —
            a delta whose other end is unnamed is a number nobody can go and
            look at. The corpus is in it by construction, because the run before
            this one on *this* corpus is the only run it is ever compared with:
            frozen and live are two series, and a delta across them would be
            measuring an admin's article edit and calling it a prompt
            regression. Drawn only on a completed run, which is the same gate
            the metrics are behind. */}
          {run.metrics.length > 0 && (
            <p className="mb-3 text-xs text-muted-foreground">
              {run.previous
                ? `Compared with run ${run.previous.id}, ${new Date(
                    run.previous.startedAt,
                  ).toLocaleDateString()}.`
                : `First run on the ${CORPUS_LABEL[
                    run.corpus
                  ].toLowerCase()} — nothing to compare against yet.`}
            </p>
          )}

          {/* The judged three, and the half of the old six-tile grid that stays
              above the fold: they are the answer this page exists to give, and a
              collapsed run reporting only its id and its status would be a row
              nobody could triage from. The other three are in the body below.

              Three across, never six — the sixth figure arrived with classifier
              accuracy, and at six columns inside a max-w-5xl card every label
              wrapped to two lines and every detail to three. The fold turns that
              old two-row compromise into the split it always wanted to be.

              Only once the run has closed. A percentage taken over the third of
              the set that has finished is not a smaller version of the answer,
              it is a different number, and drawing one invites reading it. */}
          {!running && run.metrics.length > 0 && (
            <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
              {run.metrics.map((metric) => (
                <MetricCell key={metric.metric} row={metric} />
              ))}
            </div>
          )}

          <CollapsibleContent>
            {/* Why a run fell over, rather than that it did — the badge above
              carries the news, this carries the detail, so it belongs with the
              rest of the detail. */}
            {run.error && (
              <p className="mb-3 text-sm text-muted-foreground">{run.error}</p>
            )}

            {/* The three figures that are measurements of the run rather than
              judgements of the desk. Cost is the one that reads like a headline
              and is not: it is a number audited monthly, not scanned, and a
              collapsed card carrying it would be spending the header's room on
              the question nobody opened the page to ask. */}
            {!running && (
              <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                {/* The one figure on this card with no band, and it is an absence
                  rather than an omission: no amount of dollars is "bad" in a way
                  the harness can know. A run that cost more than the last one
                  answered more cases, or answered them against a longer corpus,
                  or hit the cache less — three different facts, and colouring
                  the total would assert one of them. */}
                <Metric
                  label="Estimated cost"
                  value={`$${run.usd.toFixed(4)}`}
                  detail={`${run.results.length} cases × ${run.repeats}`}
                />
                <Metric
                  label="Prompt cache"
                  value={percent(run.cachedRepeats, run.cacheable)}
                  detail={`${run.cachedRepeats} of ${run.cacheable} repeats`}
                  judgement={judgeCache(run)}
                />
                {/* No `detail`: the two sentences this tile has always carried are
                  now the judgement itself, in the band's colour, so they are said
                  once rather than followed by a word repeating them. */}
                <Metric
                  label="Unanswered"
                  value={`${run.abandoned}`}
                  judgement={judgeAbandoned(run)}
                />
              </div>
            )}

            {/* R9's second half, and the reason the catch rate is not one number.
            A rate says the checks held; this says *which* of the two string
            comparisons did the holding — which is the thing worth knowing
            before anybody proposes relaxing one of them. */}
            {!running && run.checks.length > 0 && (
              <div className="mb-4 text-sm">
                <span className="text-muted-foreground">Caught by:</span>{" "}
                {/* A named list rather than a run of spans. It reads as one to a
                screen reader, which it is — and it gives the breakdown a handle
                of its own, which it needs: the same ten words label a decline
                in the Expected and Reached columns of the table below, so a
                locator that only knew the wording would be pointing at three
                different claims. */}
                <ul
                  aria-label="Payloads caught by check"
                  className="mt-1 flex flex-wrap gap-x-4 gap-y-1"
                >
                  {run.checks.map((check) => (
                    <li key={check.decline} className="flex gap-2">
                      <span>{DECLINE_SHORT[check.decline]}</span>
                      <span className="tabular-nums text-muted-foreground">
                        ×{check.count}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* R15's second half, and the reason classifier accuracy is not one
            number either. A rate says how often the classifier agreed; this
            says *which* category is being mistaken for which — and on this desk
            that is not academic, because the category gate is the only control
            standing between a refund request and an unattended reply.

            A repeat the classifier could not answer shows up here as
            "→ Unclassified". It is outside the rate above, deliberately — an
            outage is not the model getting things wrong — but it is worth
            drawing, because the rate alone cannot say *which* cases went
            unanswered. */}
            {!running && misfilings.length > 0 && (
              <div className="mb-4 text-sm">
                <span className="text-muted-foreground">Filed elsewhere:</span>{" "}
                {/* Named, for the reason the check breakdown is: the same four
                words label a category in the table below, so a locator that
                only knew the wording would be pointing at two claims. */}
                <ul
                  aria-label="Cases filed under an unexpected category"
                  className="mt-1 flex flex-wrap gap-x-4 gap-y-1"
                >
                  {misfilings.map((row) => (
                    <li
                      key={`${row.expected}:${row.actual ?? ""}`}
                      className="flex gap-2"
                    >
                      <span>
                        {row.expected} → {categoryLabel(row.actual)}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        ×{row.count}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {run.results.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {running
                  ? "Answering the first case. Each one is asked five times, so a full set takes a few minutes."
                  : "This run recorded no cases."}
              </p>
            ) : (
              /* The card's second fold, and the one that pays for the first: the
             table is thirty-six rows of the forty on an open card, and an admin
             reading the metrics rarely wants them with it. The sentence that
             used to caption it is the trigger's label rather than a line above
             it — it counts what is behind the fold, which is exactly what a
             closed disclosure has to say for itself. */
              <Collapsible open={casesOpen} onOpenChange={setCasesOpen}>
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-ml-1.5 mb-1 h-auto py-1 text-xs font-normal text-muted-foreground"
                  >
                    <ChevronRight
                      aria-hidden
                      className={cn(
                        "transition-transform",
                        casesOpen && "rotate-90",
                      )}
                    />
                    {running
                      ? `${answered} repeats answered so far`
                      : `${run.results.length} ${
                          run.results.length === 1 ? "case" : "cases"
                        }, ${run.repeats} repeats each`}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <TableFrame label={`Cases answered by run ${run.id}`}>
                    <table className="w-full min-w-2xl text-left text-sm">
                      <thead className="bg-muted/40">
                        <tr>
                          <th scope="col" className="px-3 py-2 font-medium">
                            Case
                          </th>
                          <th scope="col" className="px-3 py-2 font-medium">
                            Expected
                          </th>
                          <th scope="col" className="px-3 py-2 font-medium">
                            Reached
                          </th>
                          <th scope="col" className="px-3 py-2 font-medium">
                            As expected
                          </th>
                          {/* Last, and set apart on purpose: the three columns to its
                        left are the auto-reply, this one is the classifier —
                        a different model answering a different question, which
                        is why it is a metric of its own rather than a column
                        blended into the rate beside it. */}
                          <th scope="col" className="px-3 py-2 font-medium">
                            Filed
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {run.results.map((result) => (
                          <ResultRow key={result.id} result={result} />
                        ))}
                      </tbody>
                    </table>
                  </TableFrame>
                </CollapsibleContent>
              </Collapsible>
            )}
          </CollapsibleContent>
        </CardContent>
      </Card>
    </Collapsible>
  );
}

export function EvalsPage() {
  const queryClient = useQueryClient();
  /**
   * The one control on this page, and it does two things on purpose (#234).
   *
   * It filters the list *and* aims the Run button, because the alternative is a
   * screen where the runs you are reading and the run you are about to start
   * belong to different series. There is deliberately no "all" — frozen and
   * live are never averaged (R4), so a column holding both invites reading two
   * unrelated trends as one, and an "all" the Run button could not honour would
   * be a control meaning two different things at once.
   *
   * Frozen by default, and it is the default for a reason worth keeping: a
   * frozen run's numbers move only when the code does, so its trend line is
   * attributable. A live run answers from the articles an admin is editing, and
   * a red result on one is ambiguous between a prompt regression and somebody
   * rewording KB-014 that morning — which is a useful thing to ask for on
   * purpose and a terrible thing to get by accident.
   */
  const [corpus, setCorpus] = useState<EvalCorpus>(EVAL_CORPUS_DEFAULT);

  const { data, isPending, error } = useQuery({
    queryKey: evalKeys.runs(corpus),
    queryFn: async ({ signal }) => {
      const { data } = await api.get<EvalRunsResponse>("/api/evals/runs", {
        params: { corpus },
        signal,
      });
      return data;
    },
  });

  const start = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<EvalRunStartedResponse>(
        "/api/evals/runs",
        { corpus },
      );
      return data;
    },
    onSuccess: () => {
      // The run is queued, not finished — it fills in over `/api/events` as
      // each case commits. This only puts the new "Running" card on screen
      // without waiting for that first event.
      void queryClient.invalidateQueries({ queryKey: evalKeys.all });
      toast.success("Eval run started");
    },
    onError: (err) => {
      toast.error(extractErrorMessage(err, "Could not start the run"));
    },
  });

  // The button's gate and the selector's are not the same gate, since #234. A
  // deployment with no key can start nothing, and its history is still worth
  // reading — both series of it — so the control that filters the list stays
  // usable where the one that spends money does not. What the selector is held
  // for is the request in flight: the button names a corpus while it is
  // starting that corpus, and a selector that moved under it would leave the
  // two disagreeing about what was just enqueued.
  const canRun = data?.evalConfigured !== false;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="flex max-w-5xl flex-col gap-6">
        <PageHeader
          title="Evals"
          description="Answer every case whose outcome is written down, five times each, against the real provider — and see whether the unattended path still lands where it should. No ticket is created."
        >
          <Select
            value={corpus}
            onValueChange={(value) => setCorpus(value as EvalCorpus)}
            disabled={start.isPending}
          >
            <SelectTrigger aria-label="Corpus" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.values(EVAL_CORPUS).map((option) => (
                <SelectItem key={option} value={option}>
                  {CORPUS_LABEL[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* The button says which corpus it will run, rather than a bare "Run"
              beside a selector the eye has already left. It is the same value
              the list beside it is filtered by, which is the whole point of
              there being one control: what you are reading and what you are
              about to start can never be two different series. */}
          <Button
            onClick={() => start.mutate()}
            disabled={start.isPending || !canRun}
          >
            {start.isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Play className="size-4" aria-hidden />
            )}
            Run {CORPUS_LABEL[corpus].toLowerCase()}
          </Button>
        </PageHeader>

        {/* Said out loud rather than left to be inferred from a Run button that
            always fails. From this screen, "no key" and "nobody has run one
            yet" are otherwise identical. */}
        {data && !data.evalConfigured && (
          <Card className="border-dashed bg-muted/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="size-4" aria-hidden />
                No AI provider is configured
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              A run answers cases against the real provider, so it needs
              <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">
                OPENAI_API_KEY
              </code>
              set. Nothing can be started until it is.
            </CardContent>
          </Card>
        )}

        {isPending && <Skeleton className="h-40 w-full" />}

        {error && (
          <p className="text-sm text-muted-foreground">
            {extractErrorMessage(error, "Could not load runs")}
          </p>
        )}

        {/* Two empty states, because they are two different pieces of news and
            a screen that said "No runs yet" to an admin who has run twenty live
            ones would be lying. The second one points at the control that fixes
            it, which is the same control that filtered this list. */}
        {data?.runs.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {data.anyRuns
              ? `No runs against the ${CORPUS_LABEL[data.corpus].toLowerCase()} yet. The other corpus is one selection away — this list only ever shows one series.`
              : "No runs yet. Starting one answers every case five times against the corpus you pick."}
          </p>
        )}

        {/* The newest open, the rest closed (#237). The list is newest-first,
            so the first card is the run an admin came to read; the nineteen
            behind it are history and stay folded until asked for. Deliberately
            not remembered between visits — which runs you had open goes stale
            as runs age off the page. */}
        {data?.runs.map((run, index) => (
          <RunCard key={run.id} run={run} defaultOpen={index === 0} />
        ))}

        {/* Under the last card, because it is about where the list stops. Said
            out loud because a page that silently stopped at twenty would draw
            its oldest card as the first run ever made — and the cap is inside
            the corpus, which is what keeps the count true under the filter:
            twenty nightly frozen runs no longer push the live series off the
            page.

            A claim about the *list*, never about runs that exist beyond it. A
            series holding exactly twenty is not truncated, and nothing here can
            tell that case from a truncated one — so the sentence says what is
            certain, which is where this list ends. */}
        {data && data.runs.length === EVAL_RUN_LIMIT && (
          <p className="text-sm text-muted-foreground">
            This list is capped at the {EVAL_RUN_LIMIT} most recent runs on the{" "}
            {CORPUS_LABEL[data.corpus].toLowerCase()}.
          </p>
        )}
      </div>
    </div>
  );
}
