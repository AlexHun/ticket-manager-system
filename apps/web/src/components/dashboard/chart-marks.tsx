/**
 * Custom Recharts `shape`s that separate stacked segments with a gap of the card
 * surface rather than a stroke around each mark.
 *
 * A border drawn around a segment adds a second colour to something that is
 * already carrying meaning through one; a gap does the same separating work
 * with nothing at all. 2px is enough to read at any bar width.
 */

const GAP = 2;

/** Recharts hands a `shape` every prop on the element plus the computed
 *  geometry. Only the geometry is used here, and all of it is optional because
 *  Recharts types it that way. */
interface SegmentProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  /** Corner radius for the data end. Passed only to the segment that owns it —
   *  the top of a column, the right end of a row — so the baseline stays square. */
  radius?: number;
}

/** A rect rounded on its top two corners only. */
function topRoundedPath(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): string {
  const rad = Math.max(0, Math.min(r, w / 2, h));
  return [
    `M ${x},${y + h}`,
    `L ${x},${y + rad}`,
    `Q ${x},${y} ${x + rad},${y}`,
    `L ${x + w - rad},${y}`,
    `Q ${x + w},${y} ${x + w},${y + rad}`,
    `L ${x + w},${y + h}`,
    "Z",
  ].join(" ");
}

/**
 * A segment of a vertical (column) stack.
 *
 * The gap is taken off the *top* of each segment, not the bottom, so the
 * bottom-most segment stays anchored to the baseline — a stack floating 2px
 * above its axis reads as a rendering bug.
 */
export function StackSegmentV(props: SegmentProps) {
  const { x = 0, y = 0, width = 0, height = 0, fill, radius = 0 } = props;
  const h = height - GAP;
  // A one-ticket segment can be shorter than the gap; drawing it would give a
  // negative height, and drawing nothing loses it entirely — so it collapses to
  // a hairline rather than disappearing.
  if (h <= 0) {
    return height > 0 ? (
      <rect x={x} y={y} width={width} height={1} fill={fill} />
    ) : null;
  }
  const top = y + GAP;
  return radius > 0 ? (
    <path d={topRoundedPath(x, top, width, h, radius)} fill={fill} />
  ) : (
    <rect x={x} y={top} width={width} height={h} fill={fill} />
  );
}

/*
 * There was a `StackSegmentH` here, the mirrored version for horizontal bars.
 * It went when the panels that used it — By category and Workload — stopped
 * being Recharts charts and became `MiniBarList` rows. If a horizontal *chart*
 * ever comes back, the shape is `StackSegmentV` with the axes swapped: take the
 * gap off the right so the first segment stays anchored, and round the right
 * pair of corners rather than the top pair.
 */
