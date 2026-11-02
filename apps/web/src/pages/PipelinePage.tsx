import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleSlash, RotateCcw } from "lucide-react";
import type { AutoReplyCase } from "@ticket/core";
import {
  DEFAULT_DASHBOARD_RANGE,
  PIPELINE_OUTCOME,
  TUTORIAL_PAGE_KEY,
  type DashboardRange,
  type PipelineConfig,
  type PipelineOverviewResponse,
  type PipelineQueueDepth,
  type PipelineRun,
  type PipelineRunResponse,
} from "@ticket/shared";
import { PageHeader } from "@/components/layout/PageHeader";
import { Tutorial } from "@/components/Tutorial";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api } from "@/lib/api";
import { DASHBOARD_RANGE_OPTIONS } from "@/lib/dashboard-ranges";
import { extractErrorMessage } from "@/lib/errors";
import {
  pipelineKeys,
  RUN_FALLBACK_POLL_MS,
  RUN_STALLED_MS,
} from "@/lib/pipeline-queries";
import { useRealtimeStatus } from "@/lib/realtime";
import { cn } from "@/lib/utils";
import { PipelineHandoff } from "./PipelineHandoff";
import { PipelineRail } from "./PipelineRail";
import { PipelineRunVerdict } from "./PipelineRunVerdict";
import { PipelineSimulator } from "./PipelineSimulator";

/**
 * What the system does when nobody is looking.
 *
 * Everything on this page already happened somewhere else. A ticket arrives, a
 * model files it, six checks decide whether a second model's answer may be sent,
 * and the ticket is either resolved or handed back — and until this screen
 * existed the entire visible trace of that was a category chip, an "Automated"
 * badge and one line on the ticket card. There was no way to tell a knowledge
 * base that is working from one that is failing every check, and no way to make
 * a ticket arrive without the webhook's password.
 *
 * So: the rail is the path with live numbers on it, the panel beside it posts an
 * email through the real ingestion code, and the switches at the top say whether
 * any of it is running at all. That last part is the cheapest and probably the
 * most useful — no API key, the kill switch off, or an empty corpus each make
 * the lower half of this diagram dead, and from every other screen in the app
 * that is indistinguishable from a quiet week.
 *
 * Admins, and a demo session that may only look (#320). The guards on
 * `apps/api/src/routes/pipeline.ts` are the control — the simulator is
 * `requireAdmin` — and the `AdminScreenRoute` wrapper around this is UX.
 */

function useOverview(range: DashboardRange) {
  return useQuery({
    queryKey: pipelineKeys.overview(range),
    queryFn: async ({ signal }) => {
      const { data } = await api.get<PipelineOverviewResponse>(
        "/api/pipeline",
        { params: { range }, signal },
      );
      return data;
    },
  });
}

/**
 * Watch one ticket move.
 *
 * **No interval on the ordinary path.** The job that moves this ticket publishes
 * `pipeline_changed` when it commits, `RealtimeProvider` invalidates
 * `pipelineKeys.all`, and this query — mounted, so `refetchType: "active"`
 * reaches it — refetches immediately. That is strictly better than the two-second
 * poll it replaces: no wait for the next tick, and a hidden tab is served just
 * the same, which is the whole thing `refetchIntervalInBackground` was here to
 * work around.
 *
 * The interval that remains is insurance for a disconnected stream, on the one
 * page where "nothing is arriving" and "nothing is happening" look identical and
 * the difference is the point. See `RUN_FALLBACK_POLL_MS`.
 *
 * `scenarioId` is the case the ticket was sent as, when it was. The API checks
 * the reply against that case's payload and answers `escaped` (#723), so it is
 * in the key: the same ticket asked about with and without one is two answers.
 */
function useRun(
  ticketId: number | null,
  scenarioId: string | null,
  watching: boolean,
  connected: boolean,
  stalled: boolean,
) {
  return useQuery({
    queryKey: pipelineKeys.run(ticketId ?? 0, scenarioId),
    enabled: ticketId !== null,
    queryFn: async ({ signal }) => {
      const { data } = await api.get<PipelineRunResponse>(
        `/api/pipeline/runs/${ticketId}`,
        { params: scenarioId ? { scenario: scenarioId } : undefined, signal },
      );
      return data.run;
    },
    refetchInterval: (query) => {
      // `stalled` bounds this the way the give-up timer used to bound the old
      // two-second poll: a run that has not landed in two minutes is not going to
      // be caught by asking every fifteen seconds for the rest of the session.
      // The push channel keeps listening either way and costs nothing to keep
      // listening on, which is why only the *poll* is bounded.
      if (!watching || connected || stalled) return false;
      const outcome = query.state.data?.outcome;
      return outcome === undefined || outcome === PIPELINE_OUTCOME.pending
        ? RUN_FALLBACK_POLL_MS
        : false;
    },
    // Kept, and only meaningful now while the fallback above is running: a tab
    // in the background with a dead stream is exactly the case this covers, and
    // the work runs on a queue in another process whether anyone is looking or
    // not.
    refetchIntervalInBackground: true,
  });
}

export function PipelinePage() {
  const [range, setRange] = useState<DashboardRange>(DEFAULT_DASHBOARD_RANGE);
  const [watchedTicketId, setWatchedTicketId] = useState<number | null>(null);
  const [watching, setWatching] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [scenario, setScenario] = useState<AutoReplyCase | null>(null);
  const queryClient = useQueryClient();
  const { connected } = useRealtimeStatus();

  const overview = useOverview(range);
  const run = useRun(
    watchedTicketId,
    scenario?.id ?? null,
    watching,
    connected,
    stalled,
  );

  // Say so when a run has taken longer than the ladder should need. Two minutes
  // covers the model call and its first retry.
  //
  // This used to clear `watching`, which stopped the poll — and that was a bug
  // as well as a mechanism: a run that landed at three minutes stayed on screen
  // as "stalled" forever, because nothing was left asking. It now sets a flag the
  // verdict panel reads and nothing else. The event that finishes the run still
  // arrives and still replaces the line.
  const timeoutRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!watching) return;
    timeoutRef.current = window.setTimeout(
      () => setStalled(true),
      RUN_STALLED_MS,
    );
    return () => window.clearTimeout(timeoutRef.current);
  }, [watching, watchedTicketId]);

  // A finished run has moved the aggregate by one, and both are on screen.
  const outcome = run.data?.outcome;
  useEffect(() => {
    if (!outcome || outcome === PIPELINE_OUTCOME.pending) return;
    setWatching(false);
    setStalled(false);
    void queryClient.invalidateQueries({ queryKey: pipelineKeys.all });
  }, [outcome, queryClient]);

  const handleSent = (ticketId: number, sentScenario: AutoReplyCase | null) => {
    setWatchedTicketId(ticketId);
    setScenario(sentScenario);
    setWatching(true);
    setStalled(false);
  };

  const config = overview.data?.config;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <Tutorial pageKey={TUTORIAL_PAGE_KEY.pipeline} />

      <PageHeader
        title="Pipeline"
        description="What happens to a ticket before anyone opens it — and a way to make one arrive."
      >
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          value={range}
          onValueChange={(value) => {
            if (value) setRange(value as DashboardRange);
          }}
          aria-label="Time range"
        >
          {DASHBOARD_RANGE_OPTIONS.map(({ value, label, span }) => (
            <ToggleGroupItem
              key={value}
              value={value}
              aria-label={`Last ${span}`}
            >
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </PageHeader>

      {overview.error && (
        <p role="alert" className="text-sm text-destructive">
          {extractErrorMessage(
            overview.error,
            "Couldn't load the pipeline. Try again.",
          )}
        </p>
      )}

      {overview.isPending && <PipelineSkeleton />}

      {overview.data && config && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0 space-y-6">
            <div data-tutorial-anchor="config" className="contents">
              <ConfigPanel config={config} queues={overview.data.queues} />
            </div>

            {/* Between the switches and the rail, which is where it belongs:
                the panel above says whether any of this runs, this says where
                what it produces ends up, and the diagram under it draws the
                exits both of them describe. */}
            <PipelineHandoff />

            <section
              aria-labelledby="rail-heading"
              data-tutorial-anchor="rail"
              className="rounded-lg border bg-card p-5"
            >
              <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
                <h2
                  id="rail-heading"
                  className="font-heading text-base font-semibold"
                >
                  {run.data
                    ? `Ticket #${run.data.ticketId}`
                    : "The unattended path"}
                </h2>
                {run.data ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setWatchedTicketId(null);
                      setWatching(false);
                      setScenario(null);
                    }}
                  >
                    <RotateCcw aria-hidden="true" />
                    Back to totals
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Tickets that arrived in the last{" "}
                    {
                      DASHBOARD_RANGE_OPTIONS.find((r) => r.value === range)
                        ?.span
                    }
                    . Each stop shows how many were still on the line.
                  </p>
                )}
              </div>

              {run.data && (
                <PipelineRunVerdict
                  run={run.data}
                  scenario={scenario}
                  stalled={
                    stalled && run.data.outcome === PIPELINE_OUTCOME.pending
                  }
                  pipelineLive={
                    config.aiConfigured &&
                    config.autoReplyEnabled &&
                    config.autoReplyArticleCount > 0
                  }
                />
              )}

              <PipelineRail
                counts={overview.data.counts}
                run={run.data ?? null}
              />
            </section>

            {/* A listed ticket was not sent as the scenario last picked, so
                nothing judges it against one — the verdict line and the
                escape check both read `scenario`. */}
            <RecentRuns
              runs={overview.data.recent}
              onWatch={(ticketId) => {
                setWatchedTicketId(ticketId);
                setScenario(null);
              }}
            />
          </div>

          <div className="min-w-0" data-tutorial-anchor="simulator">
            {/* Sticky on wide screens only: on a narrow one it sits under the
                rail, which is where you want to look after pressing send. */}
            <PipelineSimulator
              config={config}
              onSent={handleSent}
              className="lg:sticky lg:top-6"
            />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Whether any of this runs, in four facts.
 *
 * At the top because it governs everything under it: two of these being wrong
 * makes the lower half of the rail permanently empty, and an empty rail is not
 * self-explaining. Presence only — the API never sends an env value, and this
 * never asks for one.
 */
function ConfigPanel({
  config,
  queues,
}: {
  config: PipelineConfig;
  queues: { classify: PipelineQueueDepth; autoReply: PipelineQueueDepth };
}) {
  const autoReplyLive =
    config.aiConfigured &&
    config.autoReplyEnabled &&
    config.autoReplyArticleCount > 0;

  return (
    <section
      aria-labelledby="config-heading"
      className="rounded-lg border bg-card p-5"
    >
      <h2 id="config-heading" className="sr-only">
        Pipeline configuration
      </h2>
      <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
        <Fact
          label="Classifier"
          on={config.aiConfigured}
          value={config.aiConfigured ? "Running" : "No API key"}
          note={
            config.aiConfigured
              ? "Every new ticket is filed automatically."
              : "New tickets stay in New, uncategorised."
          }
        />
        <Fact
          label="Unattended replies"
          on={autoReplyLive}
          value={
            !config.aiConfigured
              ? "No API key"
              : !config.autoReplyEnabled
                ? "Switched off"
                : config.autoReplyArticleCount === 0
                  ? "No articles"
                  : "Running"
          }
          note={
            autoReplyLive
              ? `Answering from ${config.autoReplyArticleCount} article${config.autoReplyArticleCount === 1 ? "" : "s"}.`
              : "Nothing is answered without a person."
          }
        />
        <QueueFact label="Classify queue" depth={queues.classify} />
        <QueueFact label="Auto-reply queue" depth={queues.autoReply} />
      </dl>
    </section>
  );
}

function Fact({
  label,
  value,
  note,
  on,
}: {
  label: string;
  value: string;
  note: string;
  on: boolean;
}) {
  const Icon = on ? CheckCircle2 : CircleSlash;
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "mt-1 flex items-center gap-1.5 text-sm font-medium",
          on ? "text-calm" : "text-ember-2",
        )}
      >
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        {value}
      </dd>
      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
        {note}
      </p>
    </div>
  );
}

/**
 * A queue's depth, split three ways because the three mean different things.
 *
 * `deferred` is the one worth knowing: those jobs are not a backlog, they are
 * the retry ladder waiting out a provider that failed transiently. Reported as
 * one "pending" number it would look exactly like work nobody is doing.
 */
function QueueFact({
  label,
  depth,
}: {
  label: string;
  depth: PipelineQueueDepth;
}) {
  const idle = depth.ready + depth.active + depth.deferred === 0;
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium tabular-nums">
        {idle ? (
          <span className="text-muted-foreground">Idle</span>
        ) : (
          <span className="flex flex-wrap gap-x-3">
            {depth.active > 0 && <span>{depth.active} running</span>}
            {depth.ready > 0 && <span>{depth.ready} waiting</span>}
            {depth.deferred > 0 && (
              <span className="text-ember-1">{depth.deferred} retrying</span>
            )}
          </span>
        )}
      </dd>
      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
        {idle ? "Nothing queued." : "Live, from the job queue."}
      </p>
    </div>
  );
}

function RecentRuns({
  runs,
  onWatch,
}: {
  runs: PipelineRun[];
  onWatch: (ticketId: number) => void;
}) {
  return (
    <section
      aria-labelledby="recent-heading"
      className="rounded-lg border bg-card p-5"
    >
      <h2 id="recent-heading" className="font-heading text-base font-semibold">
        Recent arrivals
      </h2>
      <p className="mt-1 mb-4 text-xs text-muted-foreground">
        Newest first. Pick one to trace it down the rail.
      </p>

      {runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing arrived in this window. Each email the desk receives appears
          here.
        </p>
      ) : (
        <ul className="divide-y">
          {runs.map((item) => (
            <li key={item.ticketId}>
              <button
                type="button"
                onClick={() => onWatch(item.ticketId)}
                className="flex w-full items-baseline gap-3 py-2 text-left text-sm hover:text-foreground"
              >
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  #{item.ticketId}
                </span>
                <span className="min-w-0 flex-1 truncate">{item.subject}</span>
                <span
                  className={cn(
                    "shrink-0 font-mono text-xs",
                    item.outcome === PIPELINE_OUTCOME.resolved
                      ? "text-calm"
                      : item.outcome === PIPELINE_OUTCOME.declined
                        ? "text-ember-2"
                        : "text-muted-foreground",
                  )}
                >
                  {item.decline ?? item.outcome}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PipelineSkeleton() {
  return (
    <div
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]"
      aria-busy="true"
      aria-label="Loading the pipeline"
    >
      <div className="space-y-6">
        <Skeleton className="h-28 w-full rounded-lg" />
        <Skeleton className="h-[32rem] w-full rounded-lg" />
      </div>
      <Skeleton className="h-[32rem] w-full rounded-lg" />
    </div>
  );
}
