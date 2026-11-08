import { Link } from "react-router-dom";
import type { AutoReplyCase } from "@ticket/core";
import { PIPELINE_OUTCOME, type PipelineRun } from "@ticket/shared";
import { ticketDetailPath } from "@/lib/routes";
import { CategoryBadge, StatusBadge } from "@/components/TicketBadges";
import { DECLINE_LABEL, RUN_VERDICT } from "@/lib/pipeline-labels";
import { cn } from "@/lib/utils";

/**
 * What happened to the ticket being watched, and whether it is what the scenario
 * said would happen.
 *
 * The expectation check is the point of the presets: they are written against a
 * corpus somebody can edit at `/knowledge`, so they *will* drift. Saying out
 * loud that a case expecting `notCovered` reached `resolved` turns that drift
 * into the most useful finding this page produces, instead of a wrong answer
 * nobody notices.
 *
 * Whether the run matched, escaped or was caught is `run.judgement`, which the
 * API reached with `judgeAnswer`, the judgement `/evals` counts by, when asked
 * with the scenario's id (#723, #746). This draws it and works none of it out:
 * the page once ran the match rule itself, and the two pages disagreed about
 * the same reply when only one side changed. The API sends no judgement for a
 * run still in flight, so it draws no verdict line.
 */
export function PipelineRunVerdict({
  run,
  scenario,
  stalled,
  pipelineLive,
}: {
  run: PipelineRun;
  scenario: AutoReplyCase | null;
  stalled: boolean;
  /** Whether the unattended reply is switched on at all — see `notOffered`. */
  pipelineLive: boolean;
}) {
  const pending = run.outcome === PIPELINE_OUTCOME.pending;
  const { judgement } = run;

  return (
    <div className="mb-5 space-y-2 rounded-md border bg-background/50 p-3">
      <p className="text-sm">
        <span className="text-muted-foreground">{run.customerName} — </span>
        <span className="font-heading">{run.subject}</span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={run.status} />
        {run.category && <CategoryBadge category={run.category} />}
      </div>

      {stalled ? (
        <p className="text-xs leading-relaxed text-ember-2">
          Still no verdict after two minutes. The retry ladder runs for about
          seven and a half minutes — this is still listening, and the verdict
          will replace this line whenever it lands.
        </p>
      ) : pending ? (
        <p className="text-xs text-muted-foreground">Working…</p>
      ) : run.decline ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {DECLINE_LABEL[run.decline]}
        </p>
      ) : run.outcome === PIPELINE_OUTCOME.resolved ? (
        <p className="text-xs leading-relaxed text-calm">
          Answered and resolved, citing{" "}
          <span className="font-mono">{run.citedArticleIds.join(", ")}</span>.
        </p>
      ) : run.outcome === PIPELINE_OUTCOME.notOffered ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {pipelineLive
            ? // Not the switches — this ticket is past where the machine would
              // take it: filed by hand before the classifier got there, too old
              // for the reconcile sweep (#353), or already through. The last is
              // most often a customer replying to a ticket the machine
              // resolved: that reopens the ticket and clears the column that
              // recorded the answer, so the trace above genuinely cannot show
              // what happened. Said out loud rather than guessed at.
              "Nothing further is scheduled. The auto-reply is offered a ticket once, when the classifier files it — so a ticket that was answered, reopened, filed by hand, or never classified within a day is not waiting for anything."
            : "Nothing is scheduled to run this — see the switches above."}
        </p>
      ) : (
        <p className="text-xs leading-relaxed text-muted-foreground">
          The classifier ran out of retries and left it uncategorised.
        </p>
      )}

      {scenario && judgement && (
        <p
          className={cn(
            "text-xs leading-relaxed",
            judgement.matched ? "text-muted-foreground" : "text-ember-2",
          )}
        >
          {judgement.matched ? (
            RUN_VERDICT.matched
          ) : judgement.escaped ? (
            RUN_VERDICT.escaped
          ) : (
            <>
              The scenario expected{" "}
              <span className="font-mono">
                {scenario.expected.decline ?? scenario.expected.outcome}
              </span>
              . It reached{" "}
              <span className="font-mono">{run.decline ?? run.outcome}</span>.{" "}
              {/* Per-scenario, because "the knowledge base has moved" is the
                  wrong reading of some mismatches — see `mismatchNote` in
                  `@ticket/core`. */}
              {scenario.mismatchNote ?? RUN_VERDICT.drifted}
            </>
          )}
        </p>
      )}

      {scenario && judgement?.caught && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {RUN_VERDICT.caught}
        </p>
      )}

      <Link
        to={ticketDetailPath(run.ticketId)}
        className="inline-block text-xs underline underline-offset-2 hover:text-foreground"
      >
        Open the ticket
      </Link>
    </div>
  );
}
