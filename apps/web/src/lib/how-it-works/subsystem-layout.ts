import type { Rect } from "./layout";
import {
  LINK_DIRECTION,
  type DrillableBoxId,
  type PartId,
  type Subsystem,
  type SubsystemId,
  type SubsystemLink,
} from "./subsystems";

/**
 * Coordinates for one box opened onto its subsystems, from the data alone.
 *
 * The box's subsystems stand in one column inside a frame, in the data's
 * order. The parts of other boxes they talk to stand in a column either side:
 * on the left a part that calls in at least as often as it is called, on the
 * right the rest. A link therefore always leaves a subsystem from the side its
 * part is on and never crosses the column, which is what keeps nine subsystems
 * and some twenty links readable on a fixed layout. Each outside part is
 * stacked in the order of the subsystems it joins, as near their middle as the
 * parts above it allow, so most links fan out rather than cross.
 *
 * Nothing is simulated: the same data is the same picture on every load (R9).
 */

const SUBSYSTEM_WIDTH = 208;
const PART_WIDTH = 184;
export const SUBSYSTEM_NODE_HEIGHT = 48;
const ROW_GAP = 16;
/** Wide enough for a link to bend between columns without a sharp turn. */
const COLUMN_GAP = 152;
const PAD = 24;
/** Room above the first subsystem for the frame's title. */
const FRAME_HEADER = 36;
const FRAME_PAD = 16;

export const PART_SIDE = { left: "left", right: "right" } as const;
export type PartSide = (typeof PART_SIDE)[keyof typeof PART_SIDE];

export interface PlacedSubsystem extends Rect {
  subsystem: Subsystem;
}

export interface PlacedPart extends Rect {
  id: PartId;
  side: PartSide;
}

export interface PlacedLink {
  /** Stable, for the DOM and the E2E: `<subsystem>-<part>`. */
  id: string;
  subsystem: SubsystemId;
  link: SubsystemLink;
  /** Where the arrow starts and where its head lands. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** An SVG path: a cubic curve leaving and arriving horizontally. */
  path: string;
}

export interface SubsystemLayout {
  box: DrillableBoxId;
  subsystems: PlacedSubsystem[];
  parts: PlacedPart[];
  links: PlacedLink[];
  /** Drawn around the subsystems, the box's title along its top. */
  frame: Rect;
  width: number;
  height: number;
}

export function subsystemLinkId(subsystem: SubsystemId, part: PartId): string {
  return `${subsystem}-${part}`;
}

const LEFT_X = PAD;
const SUBSYSTEM_X = LEFT_X + PART_WIDTH + COLUMN_GAP;
const RIGHT_X = SUBSYSTEM_X + SUBSYSTEM_WIDTH + COLUMN_GAP;
const WIDTH = RIGHT_X + PART_WIDTH + PAD;

interface Joined {
  id: PartId;
  /** Index of each subsystem it is linked to, in link order. */
  rows: number[];
  incoming: number;
  outgoing: number;
}

/**
 * Lays out `box`, given its subsystems in the data's order (`subsystemsOf`).
 */
export function layOutSubsystems(
  box: DrillableBoxId,
  subsystems: readonly Subsystem[],
): SubsystemLayout {
  const top = PAD + FRAME_HEADER;
  const placed = subsystems.map((subsystem, index): PlacedSubsystem => ({
    subsystem,
    x: SUBSYSTEM_X,
    y: top + index * (SUBSYSTEM_NODE_HEIGHT + ROW_GAP),
    width: SUBSYSTEM_WIDTH,
    height: SUBSYSTEM_NODE_HEIGHT,
  }));
  const centreOf = (index: number) =>
    placed[index]!.y + SUBSYSTEM_NODE_HEIGHT / 2;

  // Every outside part, in the order the data first names it.
  const joined = new Map<PartId, Joined>();
  subsystems.forEach((subsystem, index) => {
    for (const link of subsystem.links) {
      const entry = joined.get(link.part) ?? {
        id: link.part,
        rows: [],
        incoming: 0,
        outgoing: 0,
      };
      entry.rows.push(index);
      if (link.direction === LINK_DIRECTION.in) entry.incoming++;
      else entry.outgoing++;
      joined.set(link.part, entry);
    }
  });

  const parts: PlacedPart[] = [];
  for (const side of Object.values(PART_SIDE)) {
    const column = [...joined.values()]
      .filter((entry) => sideOf(entry) === side)
      .map((entry) => ({
        entry,
        ideal:
          entry.rows.reduce((sum, row) => sum + centreOf(row), 0) /
          entry.rows.length,
      }))
      // Stable, so two parts with the same middle keep the data's order.
      .sort((a, b) => a.ideal - b.ideal);
    let floor = top;
    for (const { entry, ideal } of column) {
      const y = Math.max(floor, ideal - SUBSYSTEM_NODE_HEIGHT / 2);
      parts.push({
        id: entry.id,
        side,
        x: side === PART_SIDE.left ? LEFT_X : RIGHT_X,
        y,
        width: PART_WIDTH,
        height: SUBSYSTEM_NODE_HEIGHT,
      });
      floor = y + SUBSYSTEM_NODE_HEIGHT + ROW_GAP;
    }
  }
  const partById = new Map(parts.map((part) => [part.id, part]));

  const links = placed.flatMap(({ subsystem, x, y, width, height }) =>
    subsystem.links.map((link): PlacedLink => {
      const part = partById.get(link.part)!;
      const left = part.side === PART_SIDE.left;
      const near = { x: left ? x : x + width, y: y + height / 2 };
      const far = {
        x: left ? part.x + part.width : part.x,
        y: part.y + part.height / 2,
      };
      const [start, end] =
        link.direction === LINK_DIRECTION.out ? [near, far] : [far, near];
      const bend = (start.x + end.x) / 2;
      return {
        id: subsystemLinkId(subsystem.id, link.part),
        subsystem: subsystem.id,
        link,
        x1: start.x,
        y1: start.y,
        x2: end.x,
        y2: end.y,
        path: `M ${start.x} ${start.y} C ${bend} ${start.y} ${bend} ${end.y} ${end.x} ${end.y}`,
      };
    }),
  );

  const last = placed.at(-1);
  const columnBottom = last ? last.y + last.height : top;
  const frame = {
    x: SUBSYSTEM_X - FRAME_PAD,
    y: PAD,
    width: SUBSYSTEM_WIDTH + 2 * FRAME_PAD,
    height: columnBottom + FRAME_PAD - PAD,
  };
  const bottom = Math.max(
    frame.y + frame.height,
    ...parts.map((part) => part.y + part.height),
  );

  return {
    box,
    subsystems: placed,
    parts,
    links,
    frame,
    width: WIDTH,
    height: bottom + PAD,
  };
}

/** Left for a part that calls in at least as often as it is called. */
function sideOf(entry: Joined): PartSide {
  return entry.incoming >= entry.outgoing ? PART_SIDE.left : PART_SIDE.right;
}
