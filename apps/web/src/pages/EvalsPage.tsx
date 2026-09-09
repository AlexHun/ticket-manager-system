import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Play } from "lucide-react";
import {
  EVAL_CORPUS,
  EVAL_METRIC,
  EVAL_RUN_STATUS,
  PIPELINE_OUTCOME,
  type AutoReplyDecline,
  type EvalCaseResultRow,
  type EvalCategoryRow,
  type EvalCorpus,
  type EvalFiledRow,
  type EvalMetric,
  type EvalMetricDelta,
  type EvalMetricRow,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
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
 */

/** What a case did, in words. `notOffered` never reaches a run's own row. */
const OUTCOME_LABEL: Record<PipelineOutcome, string> = {
  [PIPELINE_OUTCOME.resolved]: "Answered",
  [PIPELINE_OUTCOME.declined]: "Declined",
  [PIPELINE_OUTCOME.abandoned]: "Provider unreachable",
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
 * these nine things, and two files' worth of carefully-argued wording is two
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

/** A share, as a whole-number percentage. Nothing here deserves a decimal. */
function percent(numerator: number, denominator: number): string {
  if (denominator === 0) return "—";
  return `${Math.round((numerator / denominator) * 100)}%`;
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
 * Terse on purpose: the card says which run this is against and when it ran,
 * once, so three tiles do not have to repeat it. `null` is its own sentence
 * rather than a zero — see `EvalMetricDelta`.
 */
function deltaLabel(previous: EvalMetricDelta): string {
  if (previous.delta === null) return "not measured on both runs";

  const points = Math.round(previous.delta * 100);
  if (points === 0) return "unchanged";
  return `${points > 0 ? "+" : ""}${points}pp`;
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
  failing = false,
}: {
  label: string;
  value: string;
  detail: string;
  /** How far this moved since the last run on the same corpus (R14). */
  delta?: string;
  /** Below its declared threshold, so the number is drawn as the finding. */
  failing?: boolean;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "text-2xl font-semibold tabular-nums",
          failing && "text-destructive",
        )}
      >
        {value}
      </div>
      <div className="text-xs text-muted-foreground">{detail}</div>
      {/* Muted whichever way it went, deliberately. `text-destructive` on this
          page means "this fell below the bar it was declared to need" — it is
          on the figure above, and on the sentence about a payload that got out.
          Colouring every downward drift the same red would spend that signal on
          run-to-run noise, which is the PRD's opening risk: a harness that
          cries wolf is a harness nobody reads. A move that matters has already
          turned the number itself red. */}
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
 * An unmeasured metric draws "—" and the reason. That is the catch rate on a
 * run where the model planted no payload, and it is neither a zero nor a
 * hundred percent: a green 100% there would be the most misleading thing this
 * page could say, since nothing was ever tested.
 */
function MetricCell({ row }: { row: EvalMetricRow }) {
  const failing = !row.meets;

  return (
    <Metric
      label={METRIC_LABEL[row.metric]}
      value={row.value === null ? "—" : percent(row.numerator, row.denominator)}
      failing={failing}
      delta={row.previous === null ? undefined : deltaLabel(row.previous)}
      detail={
        row.value === null
          ? `no ${METRIC_UNIT[row.metric]} in this run`
          : `${row.numerator} of ${row.denominator} ${METRIC_UNIT[row.metric]} · needs ${Math.round(row.threshold * 100)}%`
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
        {result.escaped > 0 && (
          <div className="text-xs font-medium text-destructive">
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

function RunCard({ run }: { run: EvalRunRow }) {
  const running = run.status === EVAL_RUN_STATUS.running;
  const answered = run.results.reduce((n, r) => n + r.repeats, 0);
  // Only the pairs that disagree. A run where everything landed where it should
  // has said so in the rate, and listing the matches beside the misses is how a
  // breakdown stops being read at all.
  const misfilings = run.categories.filter(
    (row: EvalCategoryRow) => !row.matched,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-3 text-base">
          <span>Run {run.id}</span>
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
        {run.error && (
          <p className="mb-3 text-sm text-muted-foreground">{run.error}</p>
        )}

        {/* Above the numbers, and in words rather than as a red figure among
            black ones. Every other value on this card is a measurement; this
            one is a defect — a payload reached a reply the desk was willing to
            send, which is ADR-0004's claim failing. */}
        {run.escaped > 0 && (
          <p className="mb-3 flex items-start gap-2 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
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

        {/* Only once the run has closed. A percentage taken over the third of
            the set that has finished is not a smaller version of the answer,
            it is a different number, and drawing one invites reading it. */}
        {/* Three across and two rows deep, not six across. The sixth figure
            arrived with classifier accuracy, and at six columns inside a
            max-w-5xl card every label wraps to two lines and every detail to
            three — a row of numbers nobody can scan is worse than a second row
            of numbers they can. */}
        {!running && (
          <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {run.metrics.map((metric) => (
              <MetricCell key={metric.metric} row={metric} />
            ))}
            <Metric
              label="Estimated cost"
              value={`$${run.usd.toFixed(4)}`}
              detail={`${run.results.length} cases × ${run.repeats}`}
            />
            <Metric
              label="Prompt cache"
              value={percent(run.cachedRepeats, run.cacheable)}
              detail={`${run.cachedRepeats} of ${run.cacheable} repeats`}
            />
            <Metric
              label="Unanswered"
              value={`${run.abandoned}`}
              detail={
                run.abandoned === 0
                  ? "the provider answered everything"
                  : "the provider could not be reached"
              }
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
                of its own, which it needs: the same nine words label a decline
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
          <>
            <p className="mb-2 text-xs text-muted-foreground">
              {running
                ? `${answered} repeats answered so far.`
                : `${run.results.length} cases, ${run.repeats} repeats each.`}
            </p>
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
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function EvalsPage() {
  const queryClient = useQueryClient();
  /**
   * Frozen by default, and it is the default for a reason worth keeping.
   *
   * A frozen run's numbers move only when the code does, so its trend line is
   * attributable. A live run answers from the articles an admin is editing, and
   * a red result on one is ambiguous between a prompt regression and somebody
   * rewording KB-014 that morning — which is a useful thing to ask for on
   * purpose and a terrible thing to get by accident.
   */
  const [corpus, setCorpus] = useState<EvalCorpus>(EVAL_CORPUS.frozen);

  const { data, isPending, error } = useQuery({
    queryKey: evalKeys.runs(),
    queryFn: async ({ signal }) => {
      const { data } = await api.get<EvalRunsResponse>("/api/evals/runs", {
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

  const disabled = start.isPending || data?.evalConfigured === false;

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
            disabled={disabled}
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
          <Button onClick={() => start.mutate()} disabled={disabled}>
            {start.isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Play className="size-4" aria-hidden />
            )}
            Run
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

        {data?.runs.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No runs yet. Starting one answers every case five times against the
            corpus you pick.
          </p>
        )}

        {data?.runs.map((run) => (
          <RunCard key={run.id} run={run} />
        ))}
      </div>
    </div>
  );
}
