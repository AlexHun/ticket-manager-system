/**
 * Reads the repository and derives the module graph the `/__dev/map` page draws.
 *
 * Node-side, dev-only, and deliberately dependency-free: no TypeScript compiler
 * API, no AST. That is a real trade — the extraction below is regex over source
 * with comments stripped first, so it is accurate for the import styles this
 * repo actually uses and would need revisiting for exotic ones. What it buys is
 * a scan that costs milliseconds and adds nothing to `package.json`. Anything it
 * cannot make sense of lands in `warnings` rather than being dropped, so the map
 * never quietly under-reports.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  EDGE_KIND,
  GUARD,
  LAYER,
  WORKSPACE,
  type Endpoint,
  type ExternalDep,
  type Guard,
  type Layer,
  type ModuleEdge,
  type ModuleNode,
  type PrismaField,
  type PrismaModel,
  type ProjectGraph,
  type RouteEntry,
  type Workspace,
  type WorkspaceSummary,
} from "../src/dev/protocol.ts";

/** Directory trees the scan walks, repo-relative. */
const SCAN_DIRS = [
  "apps/api/src",
  "apps/api/prisma",
  "apps/web/src",
  "apps/web/dev",
  "packages/core/src",
  "packages/shared/src",
  "tests/e2e",
] as const;

/** Single files worth a node of their own — the configs that wire it together. */
const SCAN_FILES = [
  "playwright.config.ts",
  "apps/web/vite.config.ts",
  "apps/api/prisma.config.ts",
] as const;

/**
 * `generated` is the Prisma client: ~6k lines of machine output that would
 * outweigh every hand-written module on the page and tell you nothing. Imports
 * that reach into it are still reported, as `unresolved`.
 */
const SKIP_DIRS = new Set(["node_modules", "dist", ".vite", "generated"]);

const MODULE_EXTS = [".ts", ".tsx"];

/** Extension probe order for a specifier with none, matching bundler resolution. */
const RESOLVE_SUFFIXES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

const WORKSPACE_DIRS: { dir: string; workspace: Workspace }[] = [
  { dir: "apps/web", workspace: WORKSPACE.web },
  { dir: "apps/api", workspace: WORKSPACE.api },
  { dir: "packages/core", workspace: WORKSPACE.core },
  { dir: "packages/shared", workspace: WORKSPACE.shared },
  { dir: "tests", workspace: WORKSPACE.e2e },
];

/** Workspace package name → the module a bare import of it resolves to. */
const PACKAGE_ENTRIES: Record<string, string> = {
  "@ticket/shared": "packages/shared/src/index.ts",
  "@ticket/core": "packages/core/src/index.ts",
};

/**
 * Layers whose modules nothing is expected to import, so absent importers is not
 * a finding. Anything else with no importers is an orphan.
 *
 * `fixture` is in here for a reason worth knowing: `src/test/setup.ts` and
 * `tests/e2e/global-setup.ts` are named as *strings* in `vite.config.ts` and
 * `playwright.config.ts`. No import reaches them, so an import graph will always
 * call them dead — and they are the opposite of dead.
 */
const ROOTED_LAYERS = new Set<Layer>([
  LAYER.entry,
  LAYER.test,
  LAYER.e2e,
  LAYER.config,
  LAYER.seed,
  LAYER.fixture,
  LAYER.devtools,
]);

/* ── Comment stripping ───────────────────────────────────────────────────── */

interface StrippedSource {
  /** The file with every comment blanked out, newlines preserved so line
   *  numbers and the regexes below still line up. */
  code: string;
  codeLines: number;
  commentLines: number;
}

/**
 * Characters after which a `/` opens a regex literal rather than dividing.
 *
 * The distinction is decidable from the previous non-space character, because
 * division always follows a *value* — an identifier, a number, `)` or `]`. None
 * of those are in here, so anything else means a regex is starting.
 */
const REGEX_MAY_FOLLOW = new Set([
  "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", ";", "+", "-", "*", "%",
  "<", ">", "~", "^", "\n",
]);

/** Past the closing quote of the string starting at `start`. */
function skipQuoted(source: string, start: number, quote: string): number {
  let at = start + 1;
  while (at < source.length) {
    const ch = source[at]!;
    if (ch === "\\") {
      at += 2;
      continue;
    }
    if (ch === quote) return at + 1;
    // A `'` or `"` string cannot span a line. Bailing on the newline stops one
    // stray apostrophe from swallowing the rest of the file.
    if (quote !== "`" && ch === "\n") return at;
    at += 1;
  }
  return at;
}

/** Past the closing `/` of the regex starting at `start`. */
function skipRegex(source: string, start: number): number {
  let at = start + 1;
  let inClass = false;
  while (at < source.length) {
    const ch = source[at]!;
    if (ch === "\\") {
      at += 2;
      continue;
    }
    // A `/` inside `[...]` is a literal slash, not the terminator.
    if (ch === "[") inClass = true;
    else if (ch === "]") inClass = false;
    else if (ch === "/" && !inClass) return at + 1;
    else if (ch === "\n") return at;
    at += 1;
  }
  return at;
}

/**
 * Blank out comments, preserving every other character and all newlines.
 *
 * A character scanner rather than a line-based one, and the reason is a bug this
 * replaced: `path="/__dev/*"` contains `/*`, so a scanner that does not know it
 * is inside a string opens a block comment there and swallows the rest of the
 * file. Two routes silently vanished from the map. Strings, template literals and
 * regex literals are therefore all skipped over as units.
 *
 * The one shape it still gets wrong is a template literal nested inside another
 * template's `${…}`. Nothing in this repo does that, and the cost if something
 * did would be a missed edge in one file rather than a wrong one.
 *
 * Template contents are *preserved*, not blanked — `api.get(\`/api/tickets/${id}\`)`
 * is read back out of this text by the endpoint matcher.
 */
function stripComments(source: string): StrippedSource {
  const chars = source.split("");
  const blank = (from: number, to: number): void => {
    for (let at = from; at < to && at < chars.length; at += 1) {
      if (chars[at] !== "\n") chars[at] = " ";
    }
  };

  let at = 0;
  // Line start counts as "a statement may begin here", so a regex on its own
  // line is recognised.
  let previous = "\n";

  while (at < source.length) {
    const ch = source[at]!;
    const next = source[at + 1];

    if (ch === "/" && next === "/") {
      const eol = source.indexOf("\n", at);
      const end = eol === -1 ? source.length : eol;
      blank(at, end);
      at = end;
      continue;
    }

    if (ch === "/" && next === "*") {
      const close = source.indexOf("*/", at + 2);
      const end = close === -1 ? source.length : close + 2;
      blank(at, end);
      at = end;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      at = skipQuoted(source, at, ch);
      previous = ch;
      continue;
    }

    if (ch === "/" && REGEX_MAY_FOLLOW.has(previous)) {
      at = skipRegex(source, at);
      previous = "/";
      continue;
    }

    if (ch === "\n") previous = "\n";
    else if (ch !== " " && ch !== "\t" && ch !== "\r") previous = ch;
    at += 1;
  }

  // Counted from the result rather than tracked during the scan: a line is code
  // if anything survived, a comment if something was there and nothing did.
  const code = chars.join("");
  const before = source.split("\n");
  const after = code.split("\n");
  let codeLines = 0;
  let commentLines = 0;
  for (let line = 0; line < after.length; line += 1) {
    if (after[line]!.trim().length > 0) codeLines += 1;
    else if ((before[line] ?? "").trim().length > 0) commentLines += 1;
  }

  return { code, codeLines, commentLines };
}

/* ── Import extraction ───────────────────────────────────────────────────── */

interface RawImport {
  spec: string;
  typeOnly: boolean;
  dynamic: boolean;
}

/**
 * `import`/`export … from "x"`.
 *
 * The clause is `[^;()=]*?` and not `[\s\S]*?` on purpose: an import clause can
 * span lines (this codebase's are formatted that way) but never contains `;`,
 * `(`, `)` or `=`. Without that fence, `export const x = …` earlier in a file
 * would lazily match forward to some later `from "…"` and invent an edge.
 */
const FROM_RE = /^[ \t]*(?:import|export)\s+([^;()=]*?)\s+from\s*["']([^"']+)["']/gm;
const BARE_IMPORT_RE = /^[ \t]*import\s*["']([^"']+)["']/gm;
const DYNAMIC_IMPORT_RE = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

function extractImports(code: string): RawImport[] {
  const found: RawImport[] = [];

  for (const m of code.matchAll(FROM_RE)) {
    const clause = m[1] ?? "";
    found.push({
      spec: m[2]!,
      // `import type { A }` and `export type { A }` — the whole clause is types.
      // A mixed `import { type A, b }` is a runtime import and stays `static`.
      typeOnly: /^type\b/.test(clause.trim()),
      dynamic: false,
    });
  }
  for (const m of code.matchAll(BARE_IMPORT_RE)) {
    found.push({ spec: m[1]!, typeOnly: false, dynamic: false });
  }
  for (const m of code.matchAll(DYNAMIC_IMPORT_RE)) {
    found.push({ spec: m[1]!, typeOnly: false, dynamic: true });
  }

  return found;
}

const EXPORT_DECL_RE =
  /^[ \t]*export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:const|let|var|function|class|type|interface|enum)\s+(\w+)/gm;
const EXPORT_LIST_RE = /^[ \t]*export\s*\{([^}]*)\}/gm;

function extractExports(code: string): string[] {
  const names = new Set<string>();

  for (const m of code.matchAll(EXPORT_DECL_RE)) names.add(m[1]!);
  for (const m of code.matchAll(EXPORT_LIST_RE)) {
    for (const part of m[1]!.split(",")) {
      // `a as b` is exported under `b`; `type A` is exported as `A`.
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop();
      if (name) names.add(name);
    }
  }

  return [...names];
}

/* ── Classification ─────────────────────────────────────────────────────── */

function workspaceOf(id: string): Workspace {
  for (const entry of WORKSPACE_DIRS) {
    if (id === entry.dir || id.startsWith(`${entry.dir}/`)) return entry.workspace;
  }
  return WORKSPACE.root;
}

const ENTRY_FILES = new Set([
  "apps/web/src/main.tsx",
  "apps/web/src/App.tsx",
  "apps/api/src/index.ts",
]);

function layerOf(id: string): Layer {
  if (ENTRY_FILES.has(id)) return LAYER.entry;
  if (/\.(test|spec)\.tsx?$/.test(id)) {
    return id.startsWith("tests/") ? LAYER.e2e : LAYER.test;
  }
  if (/\.config\.tsx?$/.test(id)) return LAYER.config;
  if (id.startsWith("tests/")) return LAYER.fixture;
  if (id.startsWith("apps/api/prisma/")) return LAYER.seed;
  if (id.startsWith("apps/web/dev/") || id.startsWith("apps/web/src/dev/")) {
    return LAYER.devtools;
  }
  if (id.startsWith("apps/web/src/test/")) return LAYER.fixture;
  if (id.startsWith("apps/web/src/components/ui/")) return LAYER.ui;
  if (id.startsWith("apps/web/src/pages/")) return LAYER.page;
  if (id.startsWith("apps/web/src/components/")) return LAYER.component;
  if (id.startsWith("apps/web/src/lib/")) return LAYER.lib;
  if (id.startsWith("apps/api/src/routes/")) return LAYER.route;
  if (id.startsWith("apps/api/src/middleware/")) return LAYER.route;
  if (id.startsWith("apps/api/src/")) return LAYER.server;
  if (id.startsWith("packages/core/")) return LAYER.schema;
  if (id.startsWith("packages/shared/")) return LAYER.contract;
  return LAYER.config;
}

/** `better-auth/node` → `better-auth`, `@tanstack/react-query` unchanged. */
function packageNameOf(spec: string): string {
  if (spec.startsWith("node:")) return spec;
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

/* ── The walk ────────────────────────────────────────────────────────────── */

function walk(root: string, dir: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(path.join(root, dir), { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(root, rel, out);
    } else if (
      MODULE_EXTS.includes(path.extname(entry.name)) &&
      // `.d.ts` is ambient declarations, not a module: it imports nothing, is
      // imported by nothing, and would sit in the graph as a permanent orphan.
      !entry.name.endsWith(".d.ts")
    ) {
      out.push(rel);
    }
  }
}

/* ── Endpoints, routes, models ───────────────────────────────────────────── */

const MOUNT_RE = /app\.use\(\s*["']([^"']+)["']\s*,\s*(\w+)\s*\)/g;
const APP_HANDLER_RE = /app\.(get|post|patch|put|delete|all)\(\s*["']([^"']+)["']/g;
const ROUTER_DECL_RE = /export\s+const\s+(\w+)\s*=\s*Router\(\)/g;
const ROUTER_HANDLER_RE = /(\w+)\.(get|post|patch|put|delete|all)\(\s*["']([^"']*)["']/g;

/** How far past the path to look for a guard — far enough to clear a formatted
 *  argument list, short enough not to reach the next handler. */
const GUARD_WINDOW = 200;

function joinPath(prefix: string, sub: string): string {
  const joined = `${prefix}/${sub}`.replace(/\/{2,}/g, "/");
  return joined.length > 1 ? joined.replace(/\/$/, "") : joined;
}

function extractEndpoints(
  sources: Map<string, string>,
  warnings: string[],
): Endpoint[] {
  const serverEntry = "apps/api/src/index.ts";
  const entrySource = sources.get(serverEntry);
  if (!entrySource) {
    warnings.push(`No ${serverEntry} — API endpoints could not be read.`);
    return [];
  }

  // Which module declares which router, so a mount can be traced to a file.
  const routerFile = new Map<string, string>();
  for (const [id, source] of sources) {
    if (!id.startsWith("apps/api/")) continue;
    for (const m of source.matchAll(ROUTER_DECL_RE)) routerFile.set(m[1]!, id);
  }

  const endpoints: Endpoint[] = [];

  for (const m of entrySource.matchAll(APP_HANDLER_RE)) {
    endpoints.push({
      method: m[1]!.toUpperCase(),
      path: m[2]!,
      guard: GUARD.none,
      file: serverEntry,
      callers: [],
    });
  }

  for (const mount of entrySource.matchAll(MOUNT_RE)) {
    const [prefix, routerName] = [mount[1]!, mount[2]!];
    const file = routerFile.get(routerName);
    if (!file) {
      warnings.push(`Router \`${routerName}\` is mounted at ${prefix} but not declared in any scanned module.`);
      continue;
    }
    const source = sources.get(file)!;

    for (const handler of source.matchAll(ROUTER_HANDLER_RE)) {
      if (handler[1] !== routerName) continue;
      const after = source.slice(
        handler.index + handler[0].length,
        handler.index + handler[0].length + GUARD_WINDOW,
      );
      endpoints.push({
        method: handler[2]!.toUpperCase(),
        path: joinPath(prefix, handler[3]!),
        guard: guardIn(after, file),
        file,
        callers: [],
      });
    }
  }

  return endpoints.sort(
    (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
  );
}

function guardIn(window: string, file: string): Guard {
  if (window.includes("requireAdmin")) return GUARD.admin;
  if (window.includes("requireAuth")) return GUARD.auth;
  // A webhook is authenticated by a shared secret inside the handler rather than
  // by middleware, so "no guard" would misreport it.
  if (file.includes("/webhooks/")) return GUARD.webhook;
  return GUARD.none;
}

/** `api.get<T>("/api/x")`, including the template-literal form. */
const API_CALL_RE =
  /\bapi\.(get|post|patch|put|delete)(?:<[^>(]*>)?\(\s*(?:"([^"]+)"|`([^`]+)`)/g;

/** Every `${…}` becomes one wildcard segment, so a call site's path can be
 *  compared against a router's `:param` shape. */
function normaliseCallPath(raw: string): string {
  return raw.replace(/\$\{[^}]*\}/g, "*");
}

interface ApiCall {
  method: string;
  path: string;
  file: string;
}

function extractApiCalls(sources: Map<string, string>): ApiCall[] {
  const calls: ApiCall[] = [];
  for (const [id, source] of sources) {
    if (!id.startsWith("apps/web/src/") || /\.test\.tsx?$/.test(id)) continue;
    for (const m of source.matchAll(API_CALL_RE)) {
      calls.push({
        method: m[1]!.toUpperCase(),
        path: normaliseCallPath(m[2] ?? m[3] ?? ""),
        file: id,
      });
    }
  }
  return calls;
}

/**
 * Attach call sites to endpoints.
 *
 * Scored rather than first-match, because `/api/tickets/stats` and
 * `/api/tickets/:id` have the same shape: a literal agreeing with a literal
 * outscores anything matched through a placeholder, which is the same precedence
 * Express itself applies.
 *
 * *Every* endpoint at the winning score is credited, not just one — and that is
 * the point rather than a hedge. `api.patch(\`/api/tickets/${id}/${field}\`)` is
 * a single call site that really does reach the status, category and assignee
 * routes, so naming only one of them would be the wrong answer.
 */
function linkCallers(endpoints: Endpoint[], calls: ApiCall[]): void {
  for (const call of calls) {
    const callSegs = call.path.split("/");
    let best: Endpoint[] = [];
    let bestScore = 0;

    for (const endpoint of endpoints) {
      if (endpoint.method !== call.method) continue;
      const segs = endpoint.path.split("/");
      if (segs.length !== callSegs.length) continue;

      let score = 0;
      let ok = true;
      for (let i = 0; i < segs.length; i += 1) {
        const a = segs[i]!;
        const b = callSegs[i]!;
        // A `*` is a `${…}` the call site interpolates, so it can stand for
        // either a route parameter or a literal segment — one point either way,
        // which is what keeps a literal/literal agreement ahead of it.
        if (a === b) score += 2;
        else if (b === "*" || a.startsWith(":") || a.startsWith("{")) score += 1;
        else {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      if (score > bestScore) {
        best = [endpoint];
        bestScore = score;
      } else if (score === bestScore) {
        best.push(endpoint);
      }
    }

    for (const endpoint of best) {
      if (!endpoint.callers.includes(call.file)) endpoint.callers.push(call.file);
    }
  }
}

/** A route object's own `lazy: () => import("spec").then((m) => ({ Component:
 *  m.Name }))` — the shape every code-split leaf in `App.tsx` uses since the
 *  data-router migration (#129). Captures the import spec and the member
 *  pulled off the resolved module. */
const LAZY_COMPONENT_RE =
  /lazy:\s*\(\)\s*=>\s*import\(\s*["']([^"']+)["']\s*\)\s*\.then\(\s*\(?\s*\w+\s*\)?\s*=>\s*\(\{\s*Component:\s*\w+\.(\w+)/;

/** A route object's own `Component: Name` — a statically imported page or a
 *  wrapper (`ProtectedRoute`, `AdminRoute`, `AppShell`). */
const STATIC_COMPONENT_RE = /(?:^|[{,\s])Component:\s*(\w+)/;

const PATH_RE = /path:\s*["']([^"']+)["']/;

/**
 * Layout routes that render nothing but an `<Outlet>` and wrap the whole tree,
 * kept out of a route's "Behind" chain.
 *
 * Not a cosmetic filter. That column earns its keep by saying which routes are
 * gated, and it says `public` only when the chain is empty — so a wrapper that
 * sits above *every* route adds the same badge to every row while turning off
 * the one signal that distinguishes `/login` from `/users`. `ProtectedRoute`,
 * `AdminRoute` and `AppShell` all wrap a real subset of the tree and stay.
 *
 * A name list because nothing in the route object itself distinguishes a gate
 * from a pass-through — this is regex over source, not a running router. Keep
 * it to wrappers that genuinely decide nothing.
 */
const PASS_THROUGH_WRAPPERS = new Set(["RouteTimingLayout"]);

/**
 * `const NAME: RouteObject[] = COND ? [ … ] : []` — a route array assembled
 * outside the `createBrowserRouter` call (today, just the
 * `import.meta.env.DEV`-gated dev routes) and spread back into the tree with
 * `...NAME`.
 */
const ROUTE_ARRAY_CONST_RE = /const\s+(\w+)\s*:\s*RouteObject\[\]\s*=/g;

/**
 * The source between `source[openIndex]` — an opening `[` or `{` — and its
 * match, tracking nesting depth of that one bracket type.
 *
 * Hand-scanned rather than matched with a regex, because the obvious
 * `\[[\s\S]*?\]` is wrong in a way that looks right: it stops at the first
 * `]`, which is correct only as long as nothing between the brackets ever
 * contains one of its own. Depth tracking is what the old `<Route>` tag
 * scanner here used for the equivalent `{}` problem in JSX attributes; the
 * data-router route tree replaced JSX with object literals, so the bracket
 * type changed but the underlying bug shape didn't.
 */
function bracketSpan(
  source: string,
  openIndex: number,
): { start: number; end: number } | null {
  const open = source[openIndex];
  const close = open === "[" ? "]" : open === "{" ? "}" : null;
  if (!close) return null;
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    if (source[i] === open) depth += 1;
    else if (source[i] === close) {
      depth -= 1;
      if (depth === 0) return { start: openIndex + 1, end: i };
    }
  }
  return null;
}

/** Top-level comma-separated elements of an array's inner text, respecting
 *  `{}`/`[]`/`()` nesting so a comma inside a nested route object doesn't
 *  split one element into two. */
function splitTopLevel(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (ch === "{" || ch === "[" || ch === "(") depth += 1;
    else if (ch === "}" || ch === "]" || ch === ")") depth -= 1;
    else if (ch === "," && depth === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inner.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/**
 * The router tree, read out of `App.tsx`'s `createBrowserRouter([…])` call —
 * a nested `RouteObject[]` literal rather than JSX since #129.
 *
 * Nesting is tracked with a stack rather than matched by regex, which is what
 * lets a leaf route report the wrappers above it — the difference between
 * "`/users` exists" and "`/users` is behind `AdminRoute`".
 */
function extractRoutes(
  sources: Map<string, string>,
  resolve: (spec: string, from: string) => string | null,
  warnings: string[],
): RouteEntry[] {
  const appFile = "apps/web/src/App.tsx";
  const source = sources.get(appFile);
  if (!source) {
    warnings.push(`No ${appFile} — client routes could not be read.`);
    return [];
  }

  const staticFiles = new Map<string, string>();
  for (const m of source.matchAll(FROM_RE)) {
    const file = resolve(m[2]!, appFile);
    if (!file) continue;
    for (const name of (m[1] ?? "").matchAll(/\b([A-Z]\w*)\b/g)) {
      staticFiles.set(name[1]!, file);
    }
  }

  const routeArrayConsts = new Map<string, string>();
  for (const m of source.matchAll(ROUTE_ARRAY_CONST_RE)) {
    const bracket = source.indexOf("[", m.index + m[0].length);
    const span = bracket === -1 ? null : bracketSpan(source, bracket);
    if (span) routeArrayConsts.set(m[1]!, source.slice(span.start, span.end));
  }

  const callIndex = source.indexOf("createBrowserRouter(");
  const arrayStart = callIndex === -1 ? -1 : source.indexOf("[", callIndex);
  const topSpan = arrayStart === -1 ? null : bracketSpan(source, arrayStart);
  if (!topSpan) {
    warnings.push(
      `Could not find createBrowserRouter([...]) in ${appFile} — client routes could not be read.`,
    );
    return [];
  }

  const routes: RouteEntry[] = [];
  const stack: string[] = [];

  function parseArray(inner: string): void {
    for (const element of splitTopLevel(inner)) {
      if (element.startsWith("...")) {
        const name = element.slice(3).trim();
        const arrayText = routeArrayConsts.get(name);
        if (arrayText === undefined) {
          warnings.push(
            `App.tsx spreads \`...${name}\` into the route tree, but no \`const ${name}: RouteObject[]\` was found — client routes may be incomplete.`,
          );
          continue;
        }
        parseArray(arrayText);
        continue;
      }

      if (!element.startsWith("{")) {
        warnings.push(`Unrecognized entry in App.tsx's route tree: ${element.slice(0, 60)}`);
        continue;
      }
      const span = bracketSpan(element, 0);
      if (!span) {
        warnings.push(`Unbalanced route object in App.tsx: ${element.slice(0, 60)}`);
        continue;
      }
      const body = element.slice(span.start, span.end);
      const childrenIdx = body.indexOf("children:");
      const ownText = childrenIdx === -1 ? body : body.slice(0, childrenIdx);

      let childrenInner: string | null = null;
      if (childrenIdx !== -1) {
        const bracket = body.indexOf("[", childrenIdx);
        const childSpan = bracket === -1 ? null : bracketSpan(body, bracket);
        if (childSpan) childrenInner = body.slice(childSpan.start, childSpan.end);
      }

      const routePath = PATH_RE.exec(ownText)?.[1] ?? null;
      const lazyMatch = LAZY_COMPONENT_RE.exec(ownText);
      const component = lazyMatch ? lazyMatch[2]! : (STATIC_COMPONENT_RE.exec(ownText)?.[1] ?? null);
      const isLazy = lazyMatch !== null;

      if (routePath && component) {
        routes.push({
          path: routePath,
          component,
          file: isLazy ? resolve(lazyMatch![1]!, appFile) : (staticFiles.get(component) ?? null),
          lazy: isLazy,
          guards: [...stack],
          redirectTo: null,
        });
        if (childrenInner !== null) parseArray(childrenInner);
        continue;
      }

      // A pathless wrapper (`ProtectedRoute`, `AdminRoute`, `AppShell`) — or a
      // pass-through, which is a wrapper the "Behind" column is better off not
      // naming (see PASS_THROUGH_WRAPPERS).
      const wrapper =
        component && !PASS_THROUGH_WRAPPERS.has(component) ? component : null;
      if (wrapper) stack.push(wrapper);
      if (childrenInner !== null) parseArray(childrenInner);
      if (wrapper) stack.pop();

      if (!routePath && !component && childrenInner === null) {
        warnings.push(`Unrecognized route object in App.tsx: ${body.slice(0, 60)}`);
      }
    }
  }

  parseArray(source.slice(topSpan.start, topSpan.end));
  return routes;
}

const MODEL_RE = /model\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
const MAP_RE = /@@map\("([^"]+)"\)/;

function extractModels(root: string, warnings: string[]): PrismaModel[] {
  let source: string;
  try {
    source = readFileSync(path.join(root, "apps/api/prisma/schema.prisma"), "utf8");
  } catch {
    warnings.push("No apps/api/prisma/schema.prisma — the data model is absent from this map.");
    return [];
  }

  const raw = [...source.matchAll(MODEL_RE)].map((m) => ({
    name: m[1]!,
    body: m[2]!,
  }));
  const modelNames = new Set(raw.map((m) => m.name));

  return raw.map(({ name, body }) => {
    const fields: PrismaField[] = [];
    for (const line of body.split("\n")) {
      const m = /^\s*(\w+)\s+(\w+)(\[\])?(\?)?/.exec(line);
      // Skip block attributes (`@@index`) and anything that isn't `name Type`.
      if (!m || line.trim().startsWith("@@")) continue;
      const type = m[2]!;
      fields.push({
        name: m[1]!,
        type,
        list: m[3] === "[]",
        optional: m[4] === "?",
        relationTo: modelNames.has(type) ? type : null,
      });
    }
    return { name, table: MAP_RE.exec(body)?.[1] ?? null, fields };
  });
}

/* ── Cycles ─────────────────────────────────────────────────────────────── */

/**
 * Every distinct runtime import cycle, by colour-marking DFS.
 *
 * Type-only edges are excluded by the caller: `verbatimModuleSyntax` erases
 * them, so a ring closed by one does not exist at runtime and reporting it would
 * be a false alarm.
 */
function findCycles(adjacency: Map<string, string[]>): string[][] {
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const colour = new Map<string, number>();
  const stack: string[] = [];
  const seen = new Set<string>();
  const cycles: string[][] = [];

  const visit = (id: string): void => {
    colour.set(id, GREY);
    stack.push(id);

    for (const next of adjacency.get(id) ?? []) {
      const c = colour.get(next) ?? WHITE;
      if (c === WHITE) visit(next);
      else if (c === GREY) {
        const ring = stack.slice(stack.indexOf(next));
        // Rotate to a canonical start so the same ring found from two entry
        // points is reported once.
        const pivot = ring.indexOf([...ring].sort()[0]!);
        const canonical = [...ring.slice(pivot), ...ring.slice(0, pivot)];
        const key = canonical.join(">");
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push(canonical);
        }
      }
    }

    stack.pop();
    colour.set(id, BLACK);
  };

  for (const id of adjacency.keys()) {
    if ((colour.get(id) ?? WHITE) === WHITE) visit(id);
  }

  return cycles;
}

/* ── Entry point ────────────────────────────────────────────────────────── */

export function scanProject(root: string): ProjectGraph {
  const startedAt = Date.now();
  const warnings: string[] = [];

  const ids: string[] = [];
  for (const dir of SCAN_DIRS) walk(root, dir, ids);
  for (const file of SCAN_FILES) {
    try {
      if (statSync(path.join(root, file)).isFile()) ids.push(file);
    } catch {
      warnings.push(`Listed config ${file} was not found.`);
    }
  }
  ids.sort();

  // Read and strip once; every extractor below works off the stripped text.
  const sources = new Map<string, string>();
  const nodes = new Map<string, ModuleNode>();

  for (const id of ids) {
    const abs = path.join(root, id);
    let source: string;
    try {
      source = readFileSync(abs, "utf8");
    } catch {
      warnings.push(`Could not read ${id}.`);
      continue;
    }
    const stripped = stripComments(source);
    sources.set(id, stripped.code);

    // `ROOTED_LAYERS` already names the layers nothing imports; "testable" is
    // that same set inverted, plus shadcn's vendored `ui`. Defined here, once,
    // and shipped per module so the page never restates it.
    const layer = layerOf(id);
    const isTest = /\.(test|spec)\.tsx?$/.test(id);

    nodes.set(id, {
      id,
      name: path.basename(id),
      dir: path.dirname(id),
      workspace: workspaceOf(id),
      layer,
      code: stripped.codeLines,
      comments: stripped.commentLines,
      bytes: Buffer.byteLength(source),
      exports: extractExports(stripped.code),
      imports: [],
      importedBy: [],
      externals: [],
      unresolved: [],
      testFile: null,
      isTest,
      testable: !isTest && !ROOTED_LAYERS.has(layer) && layer !== LAYER.ui,
    });
  }

  const has = (id: string) => nodes.has(id);

  /** Specifier → module id, or null when it is not a module in this graph. */
  const resolve = (spec: string, from: string): string | null => {
    let base: string | null = null;

    if (spec.startsWith(".")) {
      base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
    } else if (spec.startsWith("@/")) {
      base = `apps/web/src/${spec.slice(2)}`;
    } else {
      const pkg = packageNameOf(spec);
      const entry = PACKAGE_ENTRIES[pkg];
      if (!entry) return null;
      if (pkg === spec) return has(entry) ? entry : null;
      base = `${path.posix.dirname(entry)}/${spec.slice(pkg.length + 1)}`;
    }

    for (const suffix of RESOLVE_SUFFIXES) {
      const candidate = `${base}${suffix}`;
      if (has(candidate)) return candidate;
    }
    return null;
  };

  const edges: ModuleEdge[] = [];
  const externalUsers = new Map<string, Set<string>>();

  for (const [id, code] of sources) {
    const node = nodes.get(id)!;
    const seenEdge = new Set<string>();

    for (const raw of extractImports(code)) {
      const target = resolve(raw.spec, id);

      if (!target) {
        if (raw.spec.startsWith(".") || raw.spec.startsWith("@/")) {
          // A real file that is simply not a module here — a stylesheet, or the
          // generated Prisma client.
          if (!node.unresolved.includes(raw.spec)) node.unresolved.push(raw.spec);
        } else {
          const pkg = packageNameOf(raw.spec);
          if (!node.externals.includes(pkg)) node.externals.push(pkg);
          const users = externalUsers.get(pkg) ?? new Set();
          users.add(id);
          externalUsers.set(pkg, users);
        }
        continue;
      }

      if (target === id) continue;
      const kind = raw.dynamic
        ? EDGE_KIND.dynamic
        : raw.typeOnly
          ? EDGE_KIND.type
          : EDGE_KIND.static;
      const key = `${target}|${kind}`;
      if (seenEdge.has(key)) continue;
      seenEdge.add(key);

      edges.push({ from: id, to: target, kind });
      if (!node.imports.includes(target)) node.imports.push(target);
      const to = nodes.get(target)!;
      if (!to.importedBy.includes(id)) to.importedBy.push(id);
    }
  }

  // Pair each module with its test sibling: `Foo.tsx` ↔ `Foo.test.tsx`, and the
  // `.ts` twin of a `.tsx` test (several helpers are tested that way).
  for (const node of nodes.values()) {
    if (!node.isTest) continue;
    const stem = node.id.replace(/\.(test|spec)\.tsx?$/, "");
    for (const ext of MODULE_EXTS) {
      const subject = nodes.get(`${stem}${ext}`);
      if (subject) {
        subject.testFile = node.id;
        break;
      }
    }
  }

  const endpoints = extractEndpoints(sources, warnings);
  linkCallers(endpoints, extractApiCalls(sources));
  const routes = extractRoutes(sources, resolve, warnings);
  const models = extractModels(root, warnings);

  const runtimeAdjacency = new Map<string, string[]>();
  for (const id of nodes.keys()) runtimeAdjacency.set(id, []);
  for (const edge of edges) {
    if (edge.kind === EDGE_KIND.type) continue;
    runtimeAdjacency.get(edge.from)!.push(edge.to);
  }
  const cycles = findCycles(runtimeAdjacency);

  const moduleList = [...nodes.values()];

  const orphans = moduleList
    .filter((m) => m.importedBy.length === 0 && !ROOTED_LAYERS.has(m.layer))
    .map((m) => m.id);

  const externals: ExternalDep[] = [...externalUsers.entries()]
    .map(([name, users]) => ({
      name,
      users: [...users].sort(),
      workspaces: [...new Set([...users].map(workspaceOf))],
    }))
    .sort((a, b) => b.users.length - a.users.length || a.name.localeCompare(b.name));

  const workspaces: WorkspaceSummary[] = WORKSPACE_DIRS.map(({ dir, workspace }) => {
    const members = moduleList.filter((m) => m.workspace === workspace);
    const layers = new Map<Layer, number>();
    for (const m of members) layers.set(m.layer, (layers.get(m.layer) ?? 0) + 1);
    return {
      workspace,
      dir,
      modules: members.length,
      code: members.reduce((sum, m) => sum + m.code, 0),
      comments: members.reduce((sum, m) => sum + m.comments, 0),
      layers: [...layers.entries()]
        .map(([layer, count]) => ({ layer, count }))
        .sort((a, b) => b.count - a.count),
    };
  }).filter((w) => w.modules > 0);

  const testable = moduleList.filter((m) => m.testable);

  return {
    generatedAt: new Date().toISOString(),
    scanMs: Date.now() - startedAt,
    totals: {
      modules: moduleList.length,
      code: moduleList.reduce((sum, m) => sum + m.code, 0),
      comments: moduleList.reduce((sum, m) => sum + m.comments, 0),
      edges: edges.length,
      externals: externals.length,
      endpoints: endpoints.length,
      routes: routes.length,
      testFiles: moduleList.filter((m) => m.isTest).length,
      testedModules: testable.filter((m) => m.testFile).length,
      testableModules: testable.length,
    },
    workspaces,
    modules: moduleList,
    edges,
    endpoints,
    routes,
    externals,
    models,
    cycles,
    orphans,
    warnings,
  };
}
