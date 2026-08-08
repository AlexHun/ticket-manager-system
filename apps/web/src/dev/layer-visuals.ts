/**
 * How the map paints and names each layer.
 *
 * The palette is local to this module rather than added to `index.css` on
 * purpose. `index.css` documents a single dark theme with one hue family, and
 * these are eight categorical hues that exist only on a dev page — putting them
 * in the app's token set would imply the product may use them, which it may not.
 *
 * The eight hexes are the reference categorical palette's dark steps, in their
 * documented slot order, and they were re-validated against *this* surface
 * (`--card`, `#161b1d`) rather than assumed: lightness band, chroma floor,
 * adjacent-pair CVD separation (worst 8.4 ΔE protan), normal-vision separation
 * (worst 19.3) and ≥3:1 contrast all pass. A CVD figure in the 6–8 band is only
 * legal alongside secondary encoding, and there is some everywhere: every node in
 * the graph carries its filename, every row carries the layer's name in text, and
 * the legend spells all of them out. Colour is the fast channel here, never the
 * only one.
 *
 * `entry` and the vendored/incidental layers deliberately spend no hue. Entries
 * take plain foreground — they are the roots, and white reads as "start here"
 * without costing a slot. The rest take muted ink, which is the honest signal for
 * shadcn's vendored components, fixtures, seeds and config.
 */

import { LAYER, type Layer } from "./protocol";

export interface LayerVisual {
  /** What the legend and the badges call it. */
  label: string;
  /** One line on what belongs here. */
  blurb: string;
  /** Fill for graph nodes and legend swatches. */
  color: string;
  /** Column it occupies in the dependency graph, left to right. Layers sharing a
   *  number share a column. */
  depth: number;
}

/** Slot order from the reference palette — do not re-order to taste, the CVD
 *  separation was validated on adjacent pairs in exactly this sequence. */
const SLOT = {
  blue: "#3987e5",
  orange: "#d95926",
  aqua: "#199e70",
  yellow: "#c98500",
  magenta: "#d55181",
  green: "#008300",
  violet: "#9085e9",
  red: "#e66767",
} as const;

const INK = "var(--foreground)";
const MUTED = "var(--muted-foreground)";

export const LAYER_VISUAL: Record<Layer, LayerVisual> = {
  [LAYER.entry]: {
    label: "Entry",
    blurb: "main.tsx, App.tsx and the API's index.ts — where execution starts.",
    color: INK,
    depth: 0,
  },
  [LAYER.page]: {
    label: "Page",
    blurb: "A routed screen, or a piece only that screen uses.",
    color: SLOT.blue,
    depth: 1,
  },
  [LAYER.component]: {
    label: "Component",
    blurb: "Shared UI written for this app — the shell, the dashboard panels.",
    color: SLOT.orange,
    depth: 2,
  },
  [LAYER.ui]: {
    label: "shadcn/ui",
    blurb: "Vendored primitives under components/ui, added by the shadcn CLI.",
    color: MUTED,
    depth: 3,
  },
  [LAYER.lib]: {
    label: "Lib / hooks",
    blurb: "Client-side plumbing: the axios instance, query keys, hooks, formatters.",
    color: SLOT.aqua,
    depth: 4,
  },
  [LAYER.route]: {
    label: "API route",
    blurb: "Express routers and the RBAC middleware they mount.",
    color: SLOT.yellow,
    depth: 5,
  },
  [LAYER.server]: {
    label: "Server core",
    blurb: "Better Auth config, the Prisma client, message-id minting.",
    color: SLOT.magenta,
    depth: 6,
  },
  [LAYER.schema]: {
    label: "Schema",
    blurb: "packages/core — the zod schemas both sides validate against.",
    color: SLOT.violet,
    depth: 7,
  },
  [LAYER.contract]: {
    label: "Contract",
    blurb: "packages/shared — the types and constants both apps converge on.",
    color: SLOT.green,
    depth: 8,
  },
  [LAYER.test]: {
    label: "Component test",
    blurb: "Vitest + Testing Library, beside the module it covers.",
    color: SLOT.red,
    depth: 0,
  },
  [LAYER.e2e]: {
    label: "E2E spec",
    blurb: "Playwright, driving a real browser against a real database.",
    color: SLOT.red,
    depth: 0,
  },
  [LAYER.fixture]: {
    label: "Fixture",
    blurb: "Test setup and helpers. Named by config, so nothing imports them.",
    color: MUTED,
    depth: 0,
  },
  [LAYER.seed]: {
    label: "Seed",
    blurb: "Prisma seed scripts.",
    color: MUTED,
    depth: 0,
  },
  [LAYER.config]: {
    label: "Config",
    blurb: "Vite, Playwright and Prisma configuration.",
    color: MUTED,
    depth: 0,
  },
  [LAYER.devtools]: {
    label: "Dev tools",
    blurb: "This page and the Vite middleware behind it. Never built.",
    color: MUTED,
    depth: 0,
  },
};

/** Layer order for legends and breakdowns: the graph's own left-to-right depth,
 *  then the roots that share column 0. */
export const LAYER_ORDER: Layer[] = [
  LAYER.entry,
  LAYER.page,
  LAYER.component,
  LAYER.ui,
  LAYER.lib,
  LAYER.route,
  LAYER.server,
  LAYER.schema,
  LAYER.contract,
  LAYER.test,
  LAYER.e2e,
  LAYER.fixture,
  LAYER.seed,
  LAYER.config,
  LAYER.devtools,
];

/**
 * Layers the graph hides until asked.
 *
 * Tests and fixtures are roots — nothing imports them — so they add a column of
 * unconnected nodes and no structure. Config, seeds and the dev tools themselves
 * are the same. All of them are one checkbox away.
 */
export const INCIDENTAL_LAYERS: Layer[] = [
  LAYER.test,
  LAYER.e2e,
  LAYER.fixture,
  LAYER.seed,
  LAYER.config,
  LAYER.devtools,
];

export const WORKSPACE_LABEL: Record<string, string> = {
  web: "apps/web",
  api: "apps/api",
  core: "packages/core",
  shared: "packages/shared",
  e2e: "tests",
  root: "root",
};
