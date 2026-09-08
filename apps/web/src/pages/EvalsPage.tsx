import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Play } from "lucide-react";
import {
  EVAL_CORPUS,
  EVAL_RUN_STATUS,
  PIPELINE_OUTCOME,
  type AutoReplyDecline,
  type EvalCaseResultRow,
  type EvalCorpus,
  type EvalReachedRow,
  type EvalRunRow,
  type EvalRunStartedResponse,
  type EvalRunsResponse,
  type PipelineOutcome,
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
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{detail}</div>
    </div>
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
      </td>
    </tr>
  );
}

function RunCard({ run }: { run: EvalRunRow }) {
  const running = run.status === EVAL_RUN_STATUS.running;
  const answered = run.results.reduce((n, r) => n + r.repeats, 0);

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
          <span className="ml-auto text-sm font-normal text-muted-foreground">
            {new Date(run.startedAt).toLocaleString()}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {run.error && (
          <p className="mb-3 text-sm text-muted-foreground">{run.error}</p>
        )}

        {/* Only once the run has closed. A percentage taken over the third of
            the set that has finished is not a smaller version of the answer,
            it is a different number, and drawing one invites reading it. */}
        {!running && (
          <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Metric
              label="Decline accuracy"
              value={percent(run.matches, run.attempts)}
              detail={`${run.matches} of ${run.attempts} repeats`}
            />
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
