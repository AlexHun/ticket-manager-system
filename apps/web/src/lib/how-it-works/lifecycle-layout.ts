import { TICKET_STATUS, type TicketStatus } from "@ticket/shared";
import type { Rect } from "./layout";
import type {
  LifecycleEdge,
  LifecycleLane,
  LifecycleLaneId,
  LifecycleNote,
  LifecycleStep,
  LifecycleStepId,
} from "./lifecycle";

/**
 * Lane, row and column in, coordinates out, for the Ticket lifecycle view.
 *
 * Nothing is simulated, as in `./layout`: a step's place is its column times
 * the pitch across, and its lane and row down, so it is the same on every load,
 * every reload and every tab switch (R9). d3 only moves the view.
 */

const STEP_WIDTH = 104;
const STEP_HEIGHT = 66;
const COLUMN_GAP = 28;
const PITCH = STEP_WIDTH + COLUMN_GAP;
/** Room around the drawing, so nothing is clipped. */
const PAD = 24;
/** The strip down the left of each lane that carries its name. */
export const LANE_HEADER = 32;
/** Between a lane's edge and the steps inside it. */
const LANE_PAD = 14;
/** Between two rows of steps in one lane. */
const ROW_GAP = 14;
const STRIP_HEIGHT = 24;
const STRIP_CHIP_WIDTH = 104;
const STRIP_CHIP_GAP = 12;
/** Between the Status strip and the lanes, and between the lanes and notes. */
const BAND_GAP = 20;
/** A note spans two columns. */
const NOTE_WIDTH = 2 * STEP_WIDTH + COLUMN_GAP;
const NOTE_PAD = 10;
export const NOTE_LINE_HEIGHT = 15;
/** Characters per line of a note, at the drawing's 11px. */
const NOTE_CHARS = 38;
/** Characters per line of a step's title, at the drawing's 12px. */
const STEP_TITLE_CHARS = 14;

export interface PlacedLane extends Rect {
  lane: LifecycleLane;
}

export interface PlacedStep extends Rect {
  step: LifecycleStep;
  titleLines: string[];
}

export interface PlacedLifecycleEdge {
  edge: LifecycleEdge;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** An SVG path: straight along a row, an S-curve between rows. */
  path: string;
}

export interface PlacedNote extends Rect {
  note: LifecycleNote;
  lines: string[];
  /** The dashed line from the step it qualifies: straight down at this x. */
  connectorX: number;
  connectorY1: number;
}

export interface StripChip extends Rect {
  status: TicketStatus;
}

export interface LifecycleLayout {
  lanes: PlacedLane[];
  lanesById: Record<LifecycleLaneId, PlacedLane>;
  steps: PlacedStep[];
  stepsById: Record<LifecycleStepId, PlacedStep>;
  edges: PlacedLifecycleEdge[];
  notes: PlacedNote[];
  strip: StripChip[];
  width: number;
  height: number;
}

export interface LifecycleInput {
  lanes: readonly LifecycleLane[];
  steps: readonly LifecycleStep[];
  edges: readonly LifecycleEdge[];
  notes: readonly LifecycleNote[];
}

/**
 * Greedy word wrap: as many words to a line as fit in `maxChars`. A word
 * longer than the limit keeps a line to itself rather than being split.
 */
export function wrapText(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  for (const word of text.split(/\s+/)) {
    const last = lines.at(-1);
    if (last !== undefined && last.length + 1 + word.length <= maxChars) {
      lines[lines.length - 1] = `${last} ${word}`;
    } else {
      lines.push(word);
    }
  }
  return lines;
}

const columnX = (column: number) => PAD + LANE_HEADER + column * PITCH;

export function layOutLifecycle(input: LifecycleInput): LifecycleLayout {
  const columns = Math.max(...input.steps.map((s) => s.column)) + 1;
  const right = columnX(columns) - COLUMN_GAP + LANE_PAD;

  const strip = Object.values(TICKET_STATUS).map(
    (status, index): StripChip => ({
      status,
      x: PAD + LANE_HEADER + index * (STRIP_CHIP_WIDTH + STRIP_CHIP_GAP),
      y: PAD,
      width: STRIP_CHIP_WIDTH,
      height: STRIP_HEIGHT,
    }),
  );

  const lanesById = {} as Record<LifecycleLaneId, PlacedLane>;
  let y = PAD + STRIP_HEIGHT + BAND_GAP;
  for (const lane of input.lanes) {
    const rows =
      Math.max(
        0,
        ...input.steps.filter((s) => s.lane === lane.id).map((s) => s.row ?? 0),
      ) + 1;
    const height = 2 * LANE_PAD + rows * STEP_HEIGHT + (rows - 1) * ROW_GAP;
    lanesById[lane.id] = { lane, x: PAD, y, width: right - PAD, height };
    y += height;
  }
  const lanes = input.lanes.map((lane) => lanesById[lane.id]);
  const lanesBottom = y;

  const stepsById = {} as Record<LifecycleStepId, PlacedStep>;
  for (const step of input.steps) {
    const lane = lanesById[step.lane];
    stepsById[step.id] = {
      step,
      titleLines: wrapText(step.title, STEP_TITLE_CHARS),
      x: columnX(step.column),
      y: lane.y + LANE_PAD + (step.row ?? 0) * (STEP_HEIGHT + ROW_GAP),
      width: STEP_WIDTH,
      height: STEP_HEIGHT,
    };
  }
  const steps = input.steps.map((step) => stepsById[step.id]);

  const edges = input.edges.map((edge): PlacedLifecycleEdge => {
    const from = stepsById[edge.from];
    const to = stepsById[edge.to];
    const x1 = from.x + from.width;
    const y1 = from.y + from.height / 2;
    const x2 = to.x;
    const y2 = to.y + to.height / 2;
    const mid = (x1 + x2) / 2;
    const path =
      y1 === y2
        ? `M ${x1} ${y1} L ${x2} ${y2}`
        : `M ${x1} ${y1} C ${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`;
    return { edge, x1, y1, x2, y2, path };
  });

  const notesTop = lanesBottom + BAND_GAP;
  const notes = input.notes.map((note): PlacedNote => {
    const step = stepsById[note.step];
    const lines = wrapText(note.text, NOTE_CHARS);
    return {
      note,
      lines,
      x: columnX(note.column),
      y: notesTop,
      width: NOTE_WIDTH,
      height: 2 * NOTE_PAD + lines.length * NOTE_LINE_HEIGHT,
      connectorX: step.x + step.width / 2,
      connectorY1: step.y + step.height,
    };
  });

  const bottom = Math.max(lanesBottom, ...notes.map((n) => n.y + n.height));
  const stripRight = Math.max(...strip.map((c) => c.x + c.width));
  return {
    lanes,
    lanesById,
    steps,
    stepsById,
    edges,
    notes,
    strip,
    width: Math.max(right, stripRight) + PAD,
    height: bottom + PAD,
  };
}
