import { useId, useState, type KeyboardEvent } from "react";
import type { TicketStatus } from "@ticket/shared";
import { StatusBadge } from "@/components/TicketBadges";
import { statusChartConfig } from "@/components/dashboard/chart-tokens";
import {
  GRAPH_EDGE_ATTRIBUTE,
  GRAPH_LANE_ATTRIBUTE,
  GRAPH_NODE_ATTRIBUTE,
  GRAPH_NOTE_ATTRIBUTE,
  GRAPH_STATUS_STRIP_ATTRIBUTE,
  GRAPH_STATUS_TAG_ATTRIBUTE,
  HOW_IT_WORKS_LABEL,
} from "@/lib/how-it-works/dom";
import {
  LIFECYCLE,
  LIFECYCLE_EDGES,
  LIFECYCLE_NOTES,
  LIFECYCLE_STEPS,
  NO_TICKET_YET,
  lifecycleLane,
  lifecycleStep,
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
import { DetailsPanel } from "./DetailsPanel";
import { GraphCanvas } from "./GraphCanvas";

/**
 * The Ticket lifecycle tab: the steps from the email that opens a ticket to
 * the agent who closes it, in Customer, Assistant and Agent swimlanes, each
 * tagged with the Status the ticket has there. A panel explains the selected
 * step, and a visually hidden ordered list carries the same content (R11).
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

const statusColor = (status: TicketStatus) => statusChartConfig[status].color;

export function LifecycleView() {
  const [selectedId, setSelectedId] = useState<LifecycleStepId | null>(null);
  const selected = selectedId ? lifecycleStep(selectedId) : null;
  const arrowId = `arrow-${useId().replace(/:/g, "")}`;

  return (
    <div className="flex flex-col gap-4 2xl:flex-row">
      <div className="min-w-0 flex-1 overflow-hidden rounded-lg border bg-background">
        <GraphCanvas
          width={LAYOUT.width}
          height={LAYOUT.height}
          label={HOW_IT_WORKS_LABEL.lifecycleCanvas}
        >
          <defs>
            <marker
              id={arrowId}
              viewBox="0 0 10 10"
              refX="10"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path
                d="M 0 0 L 10 5 L 0 10 z"
                className="fill-muted-foreground"
              />
            </marker>
          </defs>

          <StatusStrip chips={LAYOUT.strip} />
          {LAYOUT.lanes.map((placed) => (
            <Lane key={placed.lane.id} placed={placed} />
          ))}
          {LAYOUT.notes.map((placed) => (
            <Note key={placed.note.id} placed={placed} />
          ))}
          {LAYOUT.edges.map(({ edge, path }) => (
            <path
              key={edge.id}
              {...{ [GRAPH_EDGE_ATTRIBUTE]: edge.id }}
              d={path}
              fill="none"
              markerEnd={`url(#${arrowId})`}
              className="pointer-events-none stroke-muted-foreground"
              strokeWidth={1.25}
            />
          ))}
          {LAYOUT.steps.map((placed) => (
            <Step
              key={placed.step.id}
              placed={placed}
              selected={placed.step.id === selectedId}
              onSelect={() => setSelectedId(placed.step.id)}
            />
          ))}
        </GraphCanvas>
      </div>

      <DetailsPanel
        title={selected?.title ?? null}
        hint="Select a step to read what happens there. Scroll to zoom, and drag to move around."
      >
        {selected && <StepDetails step={selected} />}
      </DetailsPanel>

      <LifecycleList />
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
            fill={statusColor(status)}
            fillOpacity={0.18}
            stroke={statusColor(status)}
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

function Note({ placed }: { placed: PlacedNote }) {
  const { note, lines, x, y, width, height, connectorX, connectorY1 } = placed;
  return (
    <g {...{ [GRAPH_NOTE_ATTRIBUTE]: note.id }} className="pointer-events-none">
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
  onSelect,
}: {
  placed: PlacedStep;
  selected: boolean;
  onSelect: () => void;
}) {
  const { step, titleLines, x, y, width, height } = placed;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect();
    }
  };
  const tagY = y + height - TAG_INSET - TAG_HEIGHT;
  // The title is centred in the space above the tag.
  const titleTop = y + (tagY - y - titleLines.length * TITLE_LINE_HEIGHT) / 2;

  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={step.title}
      aria-pressed={selected}
      {...{ [GRAPH_NODE_ATTRIBUTE]: step.id }}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      className="group cursor-pointer outline-none"
    >
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={8}
        className={cn(
          "fill-card stroke-border transition-colors group-hover:stroke-muted-foreground group-focus-visible:stroke-ring",
          selected && "stroke-ring group-hover:stroke-ring",
        )}
        strokeWidth={selected ? 2.5 : 1.5}
      />
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
    </g>
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
          ? {
              fill: statusColor(status),
              fillOpacity: 0.18,
              stroke: statusColor(status),
            }
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
        {status ?? NO_TICKET_YET}
      </text>
    </g>
  );
}

function StepDetails({ step }: { step: LifecycleStep }) {
  const notes = LIFECYCLE_NOTES.filter((note) => note.step === step.id);
  return (
    <>
      <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
        {step.status ? (
          <StatusBadge status={step.status} />
        ) : (
          <span>{NO_TICKET_YET}</span>
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
    </>
  );
}

/**
 * The lifecycle as a screen reader gets it: one item per step, in the data's
 * order, carrying the panel's words, the notes and the steps that can follow.
 */
function LifecycleList() {
  return (
    <ol aria-label={HOW_IT_WORKS_LABEL.lifecycleList} className="sr-only">
      {LIFECYCLE_STEPS.map((step) => {
        const next = LIFECYCLE_EDGES.filter((edge) => edge.from === step.id);
        const notes = LIFECYCLE_NOTES.filter((note) => note.step === step.id);
        return (
          <li key={step.id}>
            {step.title} ({lifecycleLane(step.lane).title},{" "}
            {step.status ?? NO_TICKET_YET}): {step.explanation}
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
