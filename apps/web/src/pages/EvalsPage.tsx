import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Loader2, Play, X } from "lucide-react";
import {
  EVAL_RUN_STATUS,
  PIPELINE_OUTCOME,
  type AutoReplyDecline,
  type EvalCaseResultRow,
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
 * refreshed. This page is where they become a measurement: a case whose
 * expected outcome is written down, answered against the real provider, and
 * compared.
 *
 * **A run touches no ticket.** Every case is handed to `autoReply` as a
 * synthesized input rather than posted through ingestion, so the code a run
 * reaches cannot write a ticket, a message, an activity row or an email. That
 * is why this screen can spend money without anything on an agent's screen
 * moving.
 *
 * Slice 1 answers one case, once, against the frozen corpus, and says whether
 * it matched. There are no rates here yet and nothing is aggregated — that is
 * deliberate, and the honest thing to draw while a run is one data point.
 */

/** What a case did, in words. `notOffered` never reaches a run's own row. */
const OUTCOME_LABEL: Record<PipelineOutcome, string> = {
  [PIPELINE_OUTCOME.resolved]: "Answered",
  [PIPELINE_OUTCOME.declined]: "Declined",
  [PIPELINE_OUTCOME.abandoned]: "Provider unreachable",
  [PIPELINE_OUTCOME.pending]: "Still running",
  [PIPELINE_OUTCOME.notOffered]: "Not offered",
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

function ResultRow({ result }: { result: EvalCaseResultRow }) {
  return (
    <tr className="border-t border-border">
      <td className="px-3 py-2 align-top">
        <div className="font-medium">{result.caseName}</div>
        <div className="text-xs text-muted-foreground">{result.caseId}</div>
      </td>
      <td className="px-3 py-2 align-top text-muted-foreground">
        {verdict(result.expectedOutcome, result.expectedDecline)}
      </td>
      <td className="px-3 py-2 align-top">
        {verdict(result.actualOutcome, result.actualDecline)}
      </td>
      <td className="px-3 py-2 align-top">
        {/* The word as well as the icon: an icon alone leaves a screen reader
            with nothing, and this cell *is* the result. */}
        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-sm",
            result.matched ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {result.matched ? (
            <Check className="size-4" aria-hidden />
          ) : (
            <X className="size-4" aria-hidden />
          )}
          {result.matched ? "As expected" : "Not as expected"}
        </span>
      </td>
    </tr>
  );
}

function RunCard({ run }: { run: EvalRunRow }) {
  const running = run.status === EVAL_RUN_STATUS.running;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-3 text-base">
          <span>Run {run.id}</span>
          {/* The corpus is on every run and is never averaged across — a live
              run and a frozen run are two series, not one. Saying so on the
              card is what stops somebody reading them as one. */}
          <Badge variant="outline">{run.corpus} corpus</Badge>
          {running && (
            <span className="inline-flex items-center gap-1.5 text-sm font-normal text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Running
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
        {run.results.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {running
              ? "Answering the case. This takes a few seconds."
              : "This run recorded no cases."}
          </p>
        ) : (
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
                    Result
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
        )}
      </CardContent>
    </Card>
  );
}

export function EvalsPage() {
  const queryClient = useQueryClient();

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
        {},
      );
      return data;
    },
    onSuccess: () => {
      // The run is queued, not finished — the verdict arrives over
      // `/api/events` when the worker commits. This only puts the new
      // "Running" card on screen without waiting for that first event.
      void queryClient.invalidateQueries({ queryKey: evalKeys.all });
      toast.success("Eval run started");
    },
    onError: (err) => {
      toast.error(extractErrorMessage(err, "Could not start the run"));
    },
  });

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="flex max-w-5xl flex-col gap-6">
        <PageHeader
          title="Evals"
          description="Answer a case whose outcome is written down, against the real provider, and see whether the unattended path still lands where it should. No ticket is created."
        >
          <Button
            onClick={() => start.mutate()}
            disabled={start.isPending || data?.evalConfigured === false}
          >
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
              A run answers a case against the real provider, so it needs
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
            No runs yet. Starting one answers a single case against the frozen
            corpus.
          </p>
        )}

        {data?.runs.map((run) => (
          <RunCard key={run.id} run={run} />
        ))}
      </div>
    </div>
  );
}
