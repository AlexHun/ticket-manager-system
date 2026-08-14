import type { ReactNode } from "react";
import {
  AUTO_REPLY_DECLINES,
  DECLINE_STAGE,
  PIPELINE_OUTCOME,
  PIPELINE_STAGE,
  PIPELINE_STAGES,
  PIPELINE_STAGE_STATE,
  pipelineStageCounts,
  TICKET_STATUS,
  type AutoReplyDecline,
  type PipelineConfig,
  type PipelineCounts,
  type PipelineRun,
  type PipelineStage,
  type PipelineStageState,
} from "@ticket/shared";
import { AiShine } from "@/components/AiShine";
import {
  DECLINE_SHORT,
  STAGE_DESCRIPTION,
  STAGE_LABEL,
} from "@/lib/pipeline-labels";
import { cn } from "@/lib/utils";

/**
 * The rail: the unattended path drawn as one continuous line, with everything
 * that leaves it hanging off the side.
 *
 * **The line gets thinner as it descends**, because at every stop tickets leave
 * and the width is the volume still on it. That is the entire argument of this
 * page in one element — most support mail is answered by a person, and it is
 * supposed to be. A row of boxes and arrows would have said the pipeline exists;
 * this says how much of it is used.
 *
 * The same component does two jobs. Given `run`, it stops being an aggregate and
 * becomes a trace of one ticket descending it: the counts give way to
 * timestamps, one stop wears `AiShine` while a model is actually working on it,
 * and the branch it took is the only one drawn. Two views of the same shape
 * rather than two components, so the thing you watch a ticket do and the thing
 * you read the week's numbers off are provably the same diagram.
 *
 * Nothing here is decoration standing in for information: every stop is a
 * decision made in code, every stub is a value in `AUTO_REPLY_DECLINE`, and the
 * grouping of stubs under stops comes from `DECLINE_STAGE` — which is a `Record`
 * over the union, so a new decline reason cannot be added without deciding where
 * it belongs on this picture.
 */

/** Rail geometry. The axis is this many px from the left edge of the list. */
const AXIS_X = 13;

/** The line's width at full volume and at none. Both in px. */
const RAIL_MAX_W = 9;
const RAIL_MIN_W = 2;

function railWidth(share: number): number {
  if (!Number.isFinite(share) || share <= 0) return RAIL_MIN_W;
  return RAIL_MIN_W + (RAIL_MAX_W - RAIL_MIN_W) * Math.min(1, share);
}

/**
 * How an exit is coloured, which is a claim about what happened and not a mood.
 *
 * Three tones, matching the three kinds of exit `DECLINE_STAGE` groups:
 *
 * - **ember-2 at the gates.** Structural, cheap, decided before any model ran.
 * - **ember-1 for `notCovered`.** The common, correct decline — the dimmest
 *   warm step, because it is the least eventful thing on the diagram.
 * - **ember-3 for the four output checks.** A reply was written and destroyed.
 *   The hottest step, and the only group that gets a mark of its own.
 *
 * `unavailable` is the exception and takes the neutral: the provider could not
 * be reached, so nothing was decided about the ticket at all, and colouring it
 * like a verdict would be the diagram asserting something nobody asserted.
 *
 * Nothing is `destructive`. A discarded draft is the safety design firing, and
 * this is the one screen built to teach that — drawing it red would teach the
 * opposite of what the code does.
 */
function declineTone(decline: AutoReplyDecline): string {
  if (decline === "unavailable") return "text-muted-foreground";
  const stage = DECLINE_STAGE[decline];
  if (stage === PIPELINE_STAGE.checked) return "text-ember-3";
  if (stage === PIPELINE_STAGE.eligible) return "text-ember-2";
  return "text-ember-1";
}

/** The four exits where a reply existed and was thrown away. */
function isOutputCheck(decline: AutoReplyDecline): boolean {
  return (
    DECLINE_STAGE[decline] === PIPELINE_STAGE.checked &&
    decline !== "unavailable"
  );
}

/** A stub peeling off the rail. Everything that leaves does so through one. */
function Exit({
  label,
  detail,
  count,
  tone,
  marked,
  muted,
  highlighted,
}: {
  label: string;
  detail?: string;
  count?: number;
  tone: string;
  /** The ◈ that marks a destroyed draft. */
  marked?: boolean;
  /** A zero, or a group that is not a verdict. Present but receded. */
  muted?: boolean;
  /** Trace mode: this is the branch the ticket actually took. */
  highlighted?: boolean;
}) {
  return (
    <li
      className={cn(
        "relative flex items-baseline gap-2 py-0.5 text-sm",
        muted && "opacity-45",
      )}
    >
      {/* The horizontal tick joining the stub to the rail. Drawn from the axis
          rather than from the text, so it lands on the line whatever the row
          contains. */}
      <span
        aria-hidden="true"
        className="absolute top-[0.6rem] h-px bg-border"
        style={{ left: `${AXIS_X - 32}px`, width: `${32 - AXIS_X + 6}px` }}
      />
      <span className={cn("shrink-0 leading-tight", tone)} aria-hidden="true">
        {marked ? "◈" : "→"}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 leading-tight",
          highlighted ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        {detail && (
          <span className="ml-2 font-mono text-xs opacity-70">{detail}</span>
        )}
      </span>
      {count !== undefined && (
        <span
          className={cn(
            "shrink-0 tabular-nums",
            count === 0 ? "text-muted-foreground" : tone,
          )}
        >
          {count}
        </span>
      )}
    </li>
  );
}

/** One stop: the node on the line, its name, and what it is for. */
function Stop({
  stage,
  state,
  working,
  trailing,
  children,
  railStyle,
  last,
}: {
  stage: PipelineStage;
  /** Trace mode only. Aggregate mode passes nothing and every stop reads alike. */
  state?: PipelineStageState;
  /**
   * A model is actually running on this ticket, right now.
   *
   * Separate from `active`, and the distinction is not pedantry: `AiShine` means
   * "a model is working" everywhere else in this app, and a ticket sitting on a
   * queue waiting to be picked up is not that. Reusing the signal for "the
   * ticket is here" would quietly redefine it on the one screen that explains
   * the system.
   */
  working?: boolean;
  /** The count, or the timestamp. */
  trailing?: ReactNode;
  /** The stubs. */
  children?: ReactNode;
  railStyle?: { width: number };
  last?: boolean;
}) {
  const active = state === PIPELINE_STAGE_STATE.active;
  const exited = state === PIPELINE_STAGE_STATE.exited;
  const reached =
    state === undefined ||
    state === PIPELINE_STAGE_STATE.done ||
    active ||
    exited;
  const resolvedStop = stage === PIPELINE_STAGE.resolved;

  return (
    <li className="relative pl-8">
      {/* The line itself, from this node down to the next. Absent on the last
          stop — the rail ends where the pipeline does. */}
      {!last && railStyle && (
        <span
          aria-hidden="true"
          className={cn(
            "absolute top-3 bottom-0 -translate-x-1/2 rounded-full",
            reached ? "bg-border" : "bg-border/40",
          )}
          style={{ left: `${AXIS_X}px`, width: `${railStyle.width}px` }}
        />
      )}

      {/* The node. Filled once reached; the resolved terminus is the one calm
          mark on the diagram, and it is only filled when it was actually
          reached. */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-1.5 size-3 -translate-x-1/2 rounded-full border-2",
          active && "animate-pulse",
          exited
            ? "border-ember-2 bg-background"
            : resolvedStop && reached
              ? "border-calm bg-calm"
              : reached
                ? "border-muted-foreground bg-muted-foreground"
                : "border-border bg-background",
        )}
        style={{ left: `${AXIS_X}px` }}
      />

      <div className={cn("relative rounded-md", working && "pr-1")}>
        <AiShine active={Boolean(working)} />
        <div className="flex items-baseline justify-between gap-4">
          <h3
            className={cn(
              "text-sm font-medium",
              state === PIPELINE_STAGE_STATE.skipped ||
                state === PIPELINE_STAGE_STATE.pending
                ? "text-muted-foreground"
                : resolvedStop && reached
                  ? "text-calm"
                  : "text-foreground",
            )}
          >
            {STAGE_LABEL[stage]}
          </h3>
          {trailing}
        </div>
        <p className="mt-0.5 max-w-prose text-xs leading-relaxed text-muted-foreground">
          {STAGE_DESCRIPTION[stage]}
        </p>
      </div>

      {children && <ul className="mt-2 mb-5 space-y-0.5">{children}</ul>}
      {!children && <div className="mb-5" />}
    </li>
  );
}

function Count({ value, tone }: { value: number; tone?: string }) {
  return (
    <span className={cn("shrink-0 text-sm tabular-nums", tone)}>{value}</span>
  );
}

function Stamp({ at }: { at: string | null }) {
  if (!at) return null;
  return (
    <time
      dateTime={at}
      className="shrink-0 font-mono text-xs text-muted-foreground"
    >
      {new Date(at).toLocaleTimeString()}
    </time>
  );
}

export function PipelineRail({
  counts,
  config,
  run,
}: {
  counts: PipelineCounts;
  config: PipelineConfig;
  /** Non-null switches the whole rail into trace mode. */
  run?: PipelineRun | null;
}) {
  return run ? (
    <TraceRail run={run} />
  ) : (
    <AggregateRail counts={counts} config={config} />
  );
}

function AggregateRail({
  counts,
  config,
}: {
  counts: PipelineCounts;
  config: PipelineConfig;
}) {
  const stages = pipelineStageCounts(counts);
  const top = counts.received;

  const declinesAt = (stage: PipelineStage) =>
    AUTO_REPLY_DECLINES.filter((d) => DECLINE_STAGE[d] === stage);

  const declinedAtChecked = declinesAt(PIPELINE_STAGE.checked).reduce(
    (sum, d) => sum + counts.declines[d],
    0,
  );

  // The remainder between the last check and the bottom: classified tickets that
  // carry neither a resolve nor a decline.
  //
  // Shown rather than absorbed, because the alternative is a diagram whose last
  // two numbers do not subtract — the fastest way to make a reader stop trusting
  // the rest of it. Deliberately *not* labelled "in flight", which is only one of
  // the things it can be: a ticket answered by an agent before the machine got
  // there, a ticket that predates the auto-reply, and a ticket reopened by a
  // customer reply (which clears `autoResolvedAt`) all land here too. The queue
  // depths at the top of the page are what tell you whether any of it is
  // actually moving.
  const noVerdict = Math.max(
    0,
    stages[PIPELINE_STAGE.checked] - declinedAtChecked - counts.autoResolved,
  );

  return (
    <ol className="relative">
      <Stop
        stage={PIPELINE_STAGE.received}
        trailing={<Count value={stages[PIPELINE_STAGE.received]} />}
        railStyle={{ width: railWidth(stages[PIPELINE_STAGE.received] / top) }}
      >
        {counts.classifyPending > 0 && (
          <Exit
            label={
              config.aiConfigured
                ? "Queued, or being classified now"
                : "Never offered — no API key on this deployment"
            }
            count={counts.classifyPending}
            tone="text-muted-foreground"
            muted
          />
        )}
      </Stop>

      <Stop
        stage={PIPELINE_STAGE.classified}
        trailing={<Count value={stages[PIPELINE_STAGE.classified]} />}
        railStyle={{ width: railWidth(stages[PIPELINE_STAGE.classified] / top) }}
      >
        <Exit
          label="Retries exhausted — left uncategorised for a person"
          count={counts.classifyAbandoned}
          tone="text-ember-1"
          muted={counts.classifyAbandoned === 0}
        />
      </Stop>

      {[PIPELINE_STAGE.eligible, PIPELINE_STAGE.drafted].map((stage) => (
        <Stop
          key={stage}
          stage={stage}
          trailing={<Count value={stages[stage]} />}
          railStyle={{ width: railWidth(stages[stage] / top) }}
        >
          {declinesAt(stage).map((decline) => (
            <Exit
              key={decline}
              label={DECLINE_SHORT[decline]}
              detail={decline}
              count={counts.declines[decline]}
              tone={declineTone(decline)}
              muted={counts.declines[decline] === 0 || decline === "unavailable"}
            />
          ))}
        </Stop>
      ))}

      <Stop
        stage={PIPELINE_STAGE.checked}
        trailing={<Count value={stages[PIPELINE_STAGE.checked]} />}
        railStyle={{ width: railWidth(counts.autoResolved / top) }}
      >
        {declinesAt(PIPELINE_STAGE.checked).map((decline) => (
          <Exit
            key={decline}
            label={DECLINE_SHORT[decline]}
            detail={decline}
            count={counts.declines[decline]}
            tone={declineTone(decline)}
            marked={isOutputCheck(decline)}
            muted={counts.declines[decline] === 0}
          />
        ))}
        {noVerdict > 0 && (
          <Exit
            label="No verdict recorded — in flight, answered by hand, or reopened"
            count={noVerdict}
            tone="text-muted-foreground"
            muted
          />
        )}
      </Stop>

      <Stop
        stage={PIPELINE_STAGE.resolved}
        last
        trailing={
          <Count value={counts.autoResolved} tone="text-calm font-medium" />
        }
      />
    </ol>
  );
}

function TraceRail({ run }: { run: PipelineRun }) {
  const byStage = new Map(run.stages.map((s) => [s.stage, s]));

  return (
    <ol className="relative">
      {PIPELINE_STAGES.map((stage, index) => {
        const result = byStage.get(stage);
        const state = result?.state ?? PIPELINE_STAGE_STATE.pending;
        const last = index === PIPELINE_STAGES.length - 1;
        const exitedHere = state === PIPELINE_STAGE_STATE.exited;
        const active = state === PIPELINE_STAGE_STATE.active;

        // The two moments a model is genuinely running, as opposed to the ticket
        // merely sitting somewhere. Waiting at `received` means a classify job
        // is queued and about to run; `Processing` is the claim the auto-reply
        // worker takes for the duration of its call, so it is proof. Waiting at
        // `classified` is neither — that is the ticket on a queue, and the shine
        // would be claiming work nobody is doing.
        const working =
          active &&
          ((stage === PIPELINE_STAGE.received) ||
            (stage === PIPELINE_STAGE.drafted &&
              run.status === TICKET_STATUS.Processing));

        return (
          <Stop
            key={stage}
            stage={stage}
            state={state}
            working={working}
            last={last}
            trailing={<Stamp at={result?.at ?? null} />}
            railStyle={{ width: RAIL_MIN_W + 1 }}
          >
            {/* One stub, and only where the ticket actually left. Drawing all
                nine on a single trace would be a legend, not a trace. */}
            {exitedHere && run.decline && (
              <Exit
                label={DECLINE_SHORT[run.decline]}
                detail={run.decline}
                tone={declineTone(run.decline)}
                marked={isOutputCheck(run.decline)}
                highlighted
              />
            )}
            {exitedHere && !run.decline && (
              <Exit
                label="Retries exhausted — left uncategorised for a person"
                tone="text-ember-1"
                highlighted
              />
            )}
            {stage === PIPELINE_STAGE.resolved &&
              run.outcome === PIPELINE_OUTCOME.resolved && (
                <Exit
                  label="Answered from"
                  detail={run.citedArticleIds.join(", ") || "—"}
                  tone="text-calm"
                  highlighted
                />
              )}
            {state === PIPELINE_STAGE_STATE.pending &&
              run.outcome === PIPELINE_OUTCOME.notOffered && (
                <Exit
                  label="Nothing is scheduled to run this — see the switches above"
                  tone="text-muted-foreground"
                  muted
                />
              )}
          </Stop>
        );
      })}
    </ol>
  );
}
