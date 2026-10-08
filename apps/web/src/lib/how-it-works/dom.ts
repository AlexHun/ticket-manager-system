/**
 * The names How it works puts in the DOM for a test to find: accessible names
 * and the data attributes on the drawing.
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
  lifecycleCanvas: "Ticket lifecycle drawing",
  lifecycleList: "Ticket lifecycle, step by step",
  details: "Details",
} as const;

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
/** On a step's Status tag, holding the Status it shows (empty for none). */
export const GRAPH_STATUS_TAG_ATTRIBUTE = "data-status-tag";
