import { useId, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { TicketStatus } from "@ticket/shared";
import { StatusBadge } from "@/components/TicketBadges";
import { statusChartConfig } from "@/components/dashboard/chart-tokens";
import { Button } from "@/components/ui/button";
import {
  GRAPH_EDGE_ATTRIBUTE,
  GRAPH_EMPHASIS,
  GRAPH_EMPHASIS_ATTRIBUTE,
  GRAPH_LANE_ATTRIBUTE,
  GRAPH_NOTE_ATTRIBUTE,
  GRAPH_STATUS_STRIP_ATTRIBUTE,
  GRAPH_STATUS_TAG_ATTRIBUTE,
  HOW_IT_WORKS_LABEL,
  type GraphEmphasis,
} from "@/lib/how-it-works/dom";
import {
  LIFECYCLE,
  LIFECYCLE_STEPS,
  edgesFrom,
  edgesInto,
  lifecycleLane,
  lifecycleStep,
  notesFor,
  statusLabel,
  stepBeside,
  type LifecycleStep,
  type LifecycleStepId,
} from "@/lib/how-it-works/lifecycle";
import {
  LANE_HEADER,
  NOTE_LINE_HEIGHT,
  layOutLifecycle,
  type PlacedLane,
  type PlacedNote,
  type PlacedStep,
  type StripChip,
} from "@/lib/how-it-works/lifecycle-layout";
import { cn } from "@/lib/utils";
import { ArrowMarker } from "./ArrowMarker";
import { DetailsPanel } from "./DetailsPanel";
import { GraphCanvas } from "./GraphCanvas";
import { emphasisClass, emphasisOf } from "./emphasis";
import { CodeLine, InTheCodeDetails } from "./InTheCodeDetails";
import { SelectableNode } from "./SelectableNode";

/**
 * The Ticket lifecycle tab: the steps from the email that opens a ticket to
 * the agent who closes it, in Customer, Assistant and Agent swimlanes, each
 * tagged with the Status the ticket has there. A panel explains the selected
 * step, and a visually hidden ordered list carries the same content (R11).
 *
 * Next and Previous, or the arrow keys on the canvas, walk the steps in the
 * data's order (R7). The current step and the edges into it stand out and the
 * rest fades back; the canvas brings the step into frame, and nothing on the
 * drawing moves but the view (R9).
 *
 * Everything drawn comes from `@/lib/how-it-works/lifecycle`, and every
 * coordinate from `layOutLifecycle` over it.
 *
 * A Status keeps the colour the dashboard's charts give it (`--viz-*`, through
 * `statusChartConfig`), so the strip along the top, every tag and every chart
 * in the app agree: ember for somebody waiting, neutral for Processing, and
 * verdigris for settled.
 */

/** Computed once: the data is a constant, so its layout is too. */
const LAYOUT = layOutLifecycle(LIFECYCLE);

const TAG_HEIGHT = 18;
const TAG_INSET = 8;
const TITLE_LINE_HEIGHT = 14;

/** A Status drawn as a pill: its colour as the edge, a wash of it inside. */
function statusTint(status: TicketStatus) {
  const color = statusChartConfig[status].color;
  return { fill: color, fillOpacity: 0.18, stroke: color };
}

export function LifecycleView() {
  // The current step: the one selected, by a click or by walking to it.
  const [selectedId, setSelectedId] = useState<LifecycleStepId | null>(null);
  const selected = selectedId ? lifecycleStep(selectedId) : null;
  const previousId = stepBeside(selectedId, -1);
  const nextId = stepBeside(selectedId, 1);
  const into = new Set(
    selectedId ? edgesInto(selectedId).map((edge) => edge.id) : [],
  );
  // One object per step, from the constant layout, so the canvas sees a new
  // focus only when the step changes.
  const focus =
    LAYOUT.steps.find((placed) => placed.step.id === selectedId) ?? null;
  const id = useId().replace(/:/g, "");
  const arrowId = `arrow-${id}`;
  const currentArrowId = `arrow-current-${id}`;

  const walking = selectedId !== null;
  const arrowTargets: Record<string, LifecycleStepId | null> = {
    ArrowRight: nextId,
    ArrowLeft: previousId,
  };

  const onCanvasKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (!(event.key in arrowTargets)) return;
    // The arrows walk the steps here, and do not scroll the page.
    event.preventDefault();
    const target = arrowTargets[event.key];
    if (target) setSelectedId(target);
  };

  return (
    <div className="flex flex-col gap-4 2xl:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!previousId}
            onClick={() => previousId && setSelectedId(previousId)}
          >
            <ChevronLeft aria-hidden />
            {HOW_IT_WORKS_LABEL.previousStep}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!nextId}
            onClick={() => nextId && setSelectedId(nextId)}
          >
            {HOW_IT_WORKS_LABEL.nextStep}
            <ChevronRight aria-hidden />
          </Button>
          <p className="text-sm text-muted-foreground">
            Or use the left and right arrow keys on the drawing.
          </p>
        </div>

        <div className="overflow-hidden rounded-lg border bg-background">
          <GraphCanvas
            width={LAYOUT.width}
            height={LAYOUT.height}
            label={HOW_IT_WORKS_LABEL.lifecycleCanvas}
            focus={focus}
            onKeyDown={onCanvasKeyDown}
          >
            <ArrowMarker id={arrowId} />
            <ArrowMarker id={currentArrowId} className="fill-ring" />

            <StatusStrip chips={LAYOUT.strip} />
            {LAYOUT.lanes.map((placed) => (
              <Lane key={placed.lane.id} placed={placed} />
            ))}
            {LAYOUT.notes.map((placed) => (
              <Note
                key={placed.note.id}
                placed={placed}
                emphasis={emphasisOf(walking, placed.note.step === selectedId)}
              />
            ))}
            {LAYOUT.edges.map(({ edge, path }) => {
              const emphasis = emphasisOf(walking, into.has(edge.id));
              const current = emphasis === GRAPH_EMPHASIS.current;
              return (
                <path
                  key={edge.id}
                  {...{
                    [GRAPH_EDGE_ATTRIBUTE]: edge.id,
                    [GRAPH_EMPHASIS_ATTRIBUTE]: emphasis,
                  }}
                  d={path}
                  fill="none"
                  markerEnd={`url(#${current ? currentArrowId : arrowId})`}
                  className={cn(
                    "pointer-events-none",
                    current ? "stroke-ring" : "stroke-muted-foreground",
                    emphasisClass(emphasis),
                  )}
                  strokeWidth={current ? 2 : 1.25}
                />
              );
            })}
            {LAYOUT.steps.map((placed) => (
              <Step
                key={placed.step.id}
                placed={placed}
                selected={placed.step.id === selectedId}
                emphasis={emphasisOf(walking, placed.step.id === selectedId)}
                onSelect={() => setSelectedId(placed.step.id)}
              />
            ))}
          </GraphCanvas>
        </div>
      </div>

      <DetailsPanel
        title={selected?.title ?? null}
        hint="Select a step to read what happens there, or walk through them with Next. Scroll to zoom, and drag to move around."
      >
        {selected && <StepDetails step={selected} />}
      </DetailsPanel>

      <LifecycleList currentId={selectedId} />
    </div>
  );
}

function StatusStrip({ chips }: { chips: StripChip[] }) {
  return (
    <g
      {...{ [GRAPH_STATUS_STRIP_ATTRIBUTE]: "" }}
      className="pointer-events-none"
    >
      {chips.map(({ status, x, y, width, height }) => (
        <g key={status}>
          <rect
            x={x}
            y={y}
            width={width}
            height={height}
            rx={height / 2}
            {...statusTint(status)}
          />
          <text
            x={x + width / 2}
            y={y + height / 2}
            dominantBaseline="central"
            textAnchor="middle"
            className="fill-foreground text-[11px] font-medium"
          >
            {status}
          </text>
        </g>
      ))}
    </g>
  );
}

function Lane({ placed }: { placed: PlacedLane }) {
  const { lane, x, y, width, height } = placed;
  const labelX = x + LANE_HEADER / 2;
  const labelY = y + height / 2;
  return (
    <g {...{ [GRAPH_LANE_ATTRIBUTE]: lane.id }} className="pointer-events-none">
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        className="fill-muted/25 stroke-border"
      />
      <line
        x1={x + LANE_HEADER}
        y1={y}
        x2={x + LANE_HEADER}
        y2={y + height}
        className="stroke-border"
      />
      <text
        x={labelX}
        y={labelY}
        transform={`rotate(-90 ${labelX} ${labelY})`}
        dominantBaseline="central"
        textAnchor="middle"
        className="fill-muted-foreground text-[11px] font-medium tracking-wide uppercase"
      >
        {lane.title}
      </text>
    </g>
  );
}

function Note({
  placed,
  emphasis,
}: {
  placed: PlacedNote;
  emphasis: GraphEmphasis | undefined;
}) {
  const { note, lines, x, y, width, height, connectorX, connectorY1 } = placed;
  return (
    <g
      {...{
        [GRAPH_NOTE_ATTRIBUTE]: note.id,
        [GRAPH_EMPHASIS_ATTRIBUTE]: emphasis,
      }}
      className={cn("pointer-events-none", emphasisClass(emphasis))}
    >
      <line
        x1={connectorX}
        y1={connectorY1}
        x2={connectorX}
        y2={y}
        className="stroke-border"
        strokeDasharray="3 3"
      />
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={6}
        className="fill-card stroke-border"
        strokeDasharray="3 3"
      />
      <text className="fill-muted-foreground text-[11px]">
        {lines.map((line, index) => (
          <tspan
            key={index}
            x={x + 10}
            y={y + 10 + NOTE_LINE_HEIGHT * (index + 0.5)}
            dominantBaseline="central"
          >
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
}

function Step({
  placed,
  selected,
  emphasis,
  onSelect,
}: {
  placed: PlacedStep;
  selected: boolean;
  emphasis: GraphEmphasis | undefined;
  onSelect: () => void;
}) {
  const { step, titleLines, x, y, width, height } = placed;
  const tagY = y + height - TAG_INSET - TAG_HEIGHT;
  // The title is centred in the space above the tag.
  const titleTop = y + (tagY - y - titleLines.length * TITLE_LINE_HEIGHT) / 2;

  return (
    <SelectableNode
      id={step.id}
      label={step.title}
      rect={placed}
      selected={selected}
      emphasis={emphasis}
      onSelect={onSelect}
    >
      <text className="fill-foreground text-[12px] font-medium">
        {titleLines.map((line, index) => (
          <tspan
            key={index}
            x={x + width / 2}
            y={titleTop + TITLE_LINE_HEIGHT * (index + 0.5)}
            dominantBaseline="central"
            textAnchor="middle"
          >
            {line}
          </tspan>
        ))}
      </text>
      <StatusTag
        status={step.status}
        x={x + TAG_INSET}
        y={tagY}
        width={width - 2 * TAG_INSET}
      />
    </SelectableNode>
  );
}

function StatusTag({
  status,
  x,
  y,
  width,
}: {
  status: TicketStatus | null;
  x: number;
  y: number;
  width: number;
}) {
  return (
    <g {...{ [GRAPH_STATUS_TAG_ATTRIBUTE]: status ?? "" }}>
      <rect
        x={x}
        y={y}
        width={width}
        height={TAG_HEIGHT}
        rx={TAG_HEIGHT / 2}
        {...(status
          ? statusTint(status)
          : { className: "fill-none stroke-border", strokeDasharray: "3 3" })}
      />
      <text
        x={x + width / 2}
        y={y + TAG_HEIGHT / 2}
        dominantBaseline="central"
        textAnchor="middle"
        className={cn(
          "text-[10px]",
          status ? "fill-foreground" : "fill-muted-foreground",
        )}
      >
        {statusLabel(status)}
      </text>
    </g>
  );
}

function StepDetails({ step }: { step: LifecycleStep }) {
  const notes = notesFor(step.id);
  return (
    <>
      <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
        {step.status ? (
          <StatusBadge status={step.status} />
        ) : (
          <span>{statusLabel(step.status)}</span>
        )}
        <span>{lifecycleLane(step.lane).title}</span>
      </p>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {step.explanation}
      </p>
      {notes.map((note) => (
        <p
          key={note.id}
          className="mt-3 border-l-2 pl-3 text-sm leading-relaxed text-muted-foreground"
        >
          {note.text}
        </p>
      ))}
      <InTheCodeDetails code={step.code} screen={step.screen} />
    </>
  );
}

/**
 * The lifecycle as a screen reader gets it: one item per step, in the data's
 * order, carrying the panel's words, the notes and the steps that can follow.
 * The current step carries `aria-current`, so the walk is heard here too.
 */
function LifecycleList({ currentId }: { currentId: LifecycleStepId | null }) {
  return (
    <ol aria-label={HOW_IT_WORKS_LABEL.lifecycleList} className="sr-only">
      {LIFECYCLE_STEPS.map((step) => {
        const next = edgesFrom(step.id);
        const notes = notesFor(step.id);
        return (
          <li
            key={step.id}
            aria-current={step.id === currentId ? "step" : undefined}
          >
            {step.title} ({lifecycleLane(step.lane).title},{" "}
            {statusLabel(step.status)}): {step.explanation}
            <CodeLine code={step.code} />
            {notes.map((note) => (
              <p key={note.id}>{note.text}</p>
            ))}
            {next.length > 0 && (
              <p>
                Then:{" "}
                {next.map((edge) => lifecycleStep(edge.to).title).join(", or ")}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
