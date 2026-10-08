/**
 * The names How it works puts in the DOM for a test to find: accessible names
 * and the data attributes on the drawing, plus the one timing a test waits on.
 *
 * Import-free for the reason `./architecture` is: the E2E cannot import a
 * `.tsx` module, so a name it queries by lives here, once, and both the page
 * and `tests/e2e/how-it-works.spec.ts` read it.
 */

export const HOW_IT_WORKS_LABEL = {
  architectureTab: "Architecture",
  lifecycleTab: "Ticket lifecycle",
  architectureCanvas: "Architecture drawing",
  architectureList: "Architecture, box by box",
  /** The drawing of one box opened onto its subsystems. */
  subsystemCanvas: "Subsystems drawing",
  backToRuntime: "Back to the runtime view",
  lifecycleCanvas: "Ticket lifecycle drawing",
  lifecycleList: "Ticket lifecycle, step by step",
  details: "Details",
  previousStep: "Previous step",
  nextStep: "Next step",
  /** The zoom buttons every canvas carries, and the group holding them. */
  zoomControls: "Zoom",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  resetView: "Reset view",
  /** The heading over the panel's list of repo paths. */
  inTheCode: "In the code",
  /** What the panel's line naming the app screen starts with. */
  screen: "On screen",
} as const;

/**
 * How long the view takes to glide to a step, in milliseconds. Here rather
 * than beside the canvas so the E2E can wait one out.
 */
export const GRAPH_GLIDE_MS = 500;

/** On the `<g>` the zoom transform is written to. */
export const GRAPH_VIEWPORT_ATTRIBUTE = "data-graph-viewport";
/** On each box or lifecycle step, holding its id. */
export const GRAPH_NODE_ATTRIBUTE = "data-node-id";
/** On each connection, holding its edge id. */
export const GRAPH_EDGE_ATTRIBUTE = "data-edge-id";
/** On each lifecycle lane's band, holding its lane id. */
export const GRAPH_LANE_ATTRIBUTE = "data-lane-id";
/** On each lifecycle note, holding its note id. */
export const GRAPH_NOTE_ATTRIBUTE = "data-note-id";
/** On the Status strip along the top of the lifecycle. */
export const GRAPH_STATUS_STRIP_ATTRIBUTE = "data-status-strip";
/** On the panel's list of repo paths behind the selection. */
export const GRAPH_CODE_ATTRIBUTE = "data-code-paths";
/** On the panel's line naming the selection's app screen, holding its path. */
export const GRAPH_SCREEN_ATTRIBUTE = "data-screen";
/** On a step's Status tag, holding the Status it shows (empty for none). */
export const GRAPH_STATUS_TAG_ATTRIBUTE = "data-status-tag";
/**
 * While the lifecycle is being walked, on each step, connection and note:
 * `GRAPH_EMPHASIS.current` for the current step, the edges into it and the
 * notes on it, `GRAPH_EMPHASIS.dimmed` for the rest. Absent while no step is
 * current.
 */
export const GRAPH_EMPHASIS_ATTRIBUTE = "data-emphasis";
export const GRAPH_EMPHASIS = {
  current: "current",
  dimmed: "dimmed",
} as const;
export type GraphEmphasis =
  (typeof GRAPH_EMPHASIS)[keyof typeof GRAPH_EMPHASIS];
