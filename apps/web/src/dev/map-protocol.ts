/**
 * The project map's wire contract: what `apps/web/dev/scan.ts` produces and
 * what the pages under `/__dev/map` render.
 *
 * One of the three contracts `protocol.ts` split into (#284) — see
 * `./devtools-paths` for why it split and where the shared route table went.
 * Nothing here is read by a module that renders `/__dev/usage` or
 * `/__dev/tests`, and nothing here reads theirs.
 *
 * It lives under `src/` rather than beside the plugin so the browser half can
 * reach it through the `@/` alias; the node half imports it with a relative
 * path (see `apps/web/dev/scan.ts`), and `apps/web/tsconfig.node.json` lists
 * `dev` precisely so the two ends are typechecked against the same
 * declarations. Types only, and it has no imports of its own and must keep
 * none: the node half reaches it by relative path under Vite's native config
 * loader, which resolves the way Node does.
 *
 * None of this ships: the plugin is registered `apply: "serve"` and every
 * importer of these types sits behind `import.meta.env.DEV`.
 */

/**
 * Where a module sits in the architecture. Coarser than the directory tree on
 * purpose: this is the thing the map colours by, and a legend of thirty entries
 * is not a legend.
 */
export const LAYER = {
  entry: "entry",
  page: "page",
  component: "component",
  ui: "ui",
  lib: "lib",
  route: "route",
  server: "server",
  schema: "schema",
  contract: "contract",
  test: "test",
  e2e: "e2e",
  fixture: "fixture",
  seed: "seed",
  config: "config",
  devtools: "devtools",
} as const;

export type Layer = (typeof LAYER)[keyof typeof LAYER];

export const WORKSPACE = {
  web: "web",
  api: "api",
  core: "core",
  shared: "shared",
  e2e: "e2e",
  root: "root",
} as const;

export type Workspace = (typeof WORKSPACE)[keyof typeof WORKSPACE];

/**
 * How one module reaches another.
 *
 * `type` is worth separating from `static`: a type-only edge disappears at
 * runtime, so a cycle made of them is not a real cycle and a "heavy" dependency
 * reached only for its types costs nothing in the bundle. `dynamic` is the
 * `import()` that gives a route its own chunk.
 */
export const EDGE_KIND = {
  static: "static",
  dynamic: "dynamic",
  type: "type",
} as const;

export type EdgeKind = (typeof EDGE_KIND)[keyof typeof EDGE_KIND];

export interface ModuleNode {
  /** Repo-relative, forward slashes. Doubles as the graph key. */
  id: string;
  name: string;
  dir: string;
  workspace: Workspace;
  layer: Layer;
  /** Lines that are neither blank nor comment. */
  code: number;
  /** Lines inside a line or block comment. Tracked separately because in this
   *  codebase the comments are half the artefact. */
  comments: number;
  bytes: number;
  /** Exported symbol names, in source order. */
  exports: string[];
  /** Ids of internal modules this one imports. */
  imports: string[];
  /** Ids of internal modules that import this one. */
  importedBy: string[];
  /** Bare package specifiers, normalised to the package name. */
  externals: string[];
  /**
   * Specifiers that are real but not modules in this graph — a stylesheet, the
   * generated Prisma client. Surfaced rather than dropped so a blank
   * `imports` list never has to be taken on trust.
   */
  unresolved: string[];
  /** `Foo.test.tsx` for `Foo.tsx`, when one exists. */
  testFile: string | null;
  isTest: boolean;
  /**
   * Whether a unit test could reasonably cover it — this project's own modules,
   * excluding shadcn's vendored primitives, fixtures, seeds, config and the
   * entries. Sent per module rather than left to the page to re-derive, so the
   * ratio in `totals` and any list of untested files agree by construction.
   */
  testable: boolean;
}

export interface ModuleEdge {
  from: string;
  to: string;
  kind: EdgeKind;
}

export const GUARD = {
  admin: "requireAdmin",
  auth: "requireAuth",
  webhook: "webhook",
  none: "none",
} as const;

export type Guard = (typeof GUARD)[keyof typeof GUARD];

export interface Endpoint {
  method: string;
  /** Mount prefix + router path, already joined. */
  path: string;
  guard: Guard;
  /** Module that registers it. */
  file: string;
  /** Web modules that call it, matched by path shape. */
  callers: string[];
}

export interface RouteEntry {
  path: string;
  component: string;
  /** The page module, when the component resolves to one. Null for a route whose
   *  element comes from the router itself — a `<Navigate>` catch-all. */
  file: string | null;
  /** Reached through `lazy(() => import(...))`, so it gets its own chunk. */
  lazy: boolean;
  /** Wrapper routes it is nested inside, outermost first. */
  guards: string[];
  /** Where a redirect route sends you. */
  redirectTo: string | null;
}

export interface ExternalDep {
  name: string;
  /** Modules importing it. */
  users: string[];
  workspaces: Workspace[];
}

export interface PrismaField {
  name: string;
  type: string;
  optional: boolean;
  list: boolean;
  /** The model this field points at, for a relation field. */
  relationTo: string | null;
}

export interface PrismaModel {
  name: string;
  /** The `@@map`ped table name, when it differs. */
  table: string | null;
  fields: PrismaField[];
}

export interface WorkspaceSummary {
  workspace: Workspace;
  /** Directory the workspace lives in, repo-relative. */
  dir: string;
  modules: number;
  code: number;
  comments: number;
  /** Module count per layer, only the layers present. */
  layers: { layer: Layer; count: number }[];
}

export interface ProjectGraph {
  generatedAt: string;
  /** How long the scan took, so the page can say whether it is cheap. */
  scanMs: number;
  totals: {
    modules: number;
    code: number;
    comments: number;
    edges: number;
    externals: number;
    endpoints: number;
    routes: number;
    testFiles: number;
    /** Non-test modules with a `*.test.*` sibling, over the ones that could
     *  have one — the coverage claim the map is entitled to make. */
    testedModules: number;
    testableModules: number;
  };
  workspaces: WorkspaceSummary[];
  modules: ModuleNode[];
  edges: ModuleEdge[];
  endpoints: Endpoint[];
  routes: RouteEntry[];
  externals: ExternalDep[];
  models: PrismaModel[];
  /** Import cycles, each as the ring of ids that closes it. Runtime edges
   *  only — a ring made of `type` edges is not a cycle. */
  cycles: string[][];
  /** Modules nothing imports, minus the ones nothing is supposed to import
   *  (entries, tests, config, seeds). */
  orphans: string[];
  /** Anything the scan could not make sense of. Shown, not swallowed. */
  warnings: string[];
}
