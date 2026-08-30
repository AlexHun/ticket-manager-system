import { useMemo, useState } from "react";
import { Loader2, RefreshCw, Search, X } from "lucide-react";
import { Hint } from "@/components/Hint";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toggle } from "@/components/ui/toggle";
import { extractErrorMessage } from "@/lib/errors";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { cn } from "@/lib/utils";
import { DependencyGraph } from "./DependencyGraph";
import { useProjectGraph } from "./dev-api";
import { INCIDENTAL_LAYERS, LAYER_ORDER, LAYER_VISUAL, WORKSPACE_LABEL } from "./layer-visuals";
import { LayerBadge } from "./LayerBadge";
import { MapOverview } from "./MapOverview";
import { MapWiring } from "./MapWiring";
import { ModuleInspector } from "./ModuleInspector";
import { matchesQuery } from "./module-match";
import { ModuleTable } from "./ModuleTable";
import { LAYER, type Layer, type ProjectGraph, type Workspace } from "./protocol";

/**
 * Everything the repository is, on one page.
 *
 * Four views over one scan, sharing one filter bar and one selection. The
 * selection is the thing that makes them a single page rather than four: pick a
 * module anywhere — a node in the graph, a row in the table, a handler in the
 * wiring list — and the inspector on the right follows, so you can cross from
 * "which URL is this" to "what does it import" without losing your place.
 */

/** Radix reserves `""` for "cleared", so the "any workspace" row needs a token
 *  of its own. It never leaves this module. */
const ANY_WORKSPACE = "any";

const TAB = {
  overview: "overview",
  graph: "graph",
  modules: "modules",
  wiring: "wiring",
} as const;

export function ProjectMapPage() {
  const { data: graph, isPending, error, refetch, isFetching } = useProjectGraph();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [workspace, setWorkspace] = useState<Workspace | typeof ANY_WORKSPACE>(
    ANY_WORKSPACE,
  );
  const [showIncidental, setShowIncidental] = useState(false);
  const [showVendored, setShowVendored] = useState(false);

  // The graph redraws on every keystroke otherwise: the layout is memoised on the
  // filtered node list, and dimming is derived from this same term.
  const query = useDebouncedValue(search.trim().toLowerCase(), 150);

  const visible = useMemo(() => {
    if (!graph) return [];
    return graph.modules.filter((module) => {
      if (workspace !== ANY_WORKSPACE && module.workspace !== workspace) return false;
      if (!showIncidental && INCIDENTAL_LAYERS.includes(module.layer)) return false;
      if (!showVendored && module.layer === LAYER.ui) return false;
      return true;
    });
  }, [graph, workspace, showIncidental, showVendored]);

  /** `visible` narrowed by the search — what the Modules tab lists, and the
   *  number the filter bar reports. Kept apart from `visible` because the graph
   *  needs the unsearched set: it dims non-matches rather than dropping them, so
   *  the structure around a hit stays on screen. */
  const matching = useMemo(
    () => visible.filter((module) => matchesQuery(query, module.id)),
    [visible, query],
  );

  const selected = graph?.modules.find((m) => m.id === selectedId) ?? null;

  if (isPending) return <MapSkeleton />;

  if (error || !graph) {
    return (
      <div className="p-4">
        <Card size="sm">
          <CardHeader>
            <CardTitle>The scan did not answer</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">
              {extractErrorMessage(error, "The dev middleware returned an error.")}
            </p>
            <p className="text-xs text-muted-foreground">
              This page is served by the Vite plugin in{" "}
              <code className="font-mono">apps/web/dev/plugin.ts</code>. If the dev
              server was started before that file existed, restart it.
            </p>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RefreshCw aria-hidden="true" />
              Try again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  /**
   * Selecting from a view that is filtering the module out would otherwise show
   * an empty inspector, so a pick always widens the filters enough to include it.
   *
   * The search counts as one of those filters now that it reaches every tab, and
   * it is the only one cleared rather than widened — there is no "wider" search
   * than none. It is cleared *only* when the pick does not match, which is the
   * case that would otherwise strand you: a cycle in Findings comes back whole,
   * so clicking a module further round the ring is a click on something the term
   * never matched. A pick that does match leaves your search where it was.
   */
  const select = (id: string) => {
    const module = graph.modules.find((m) => m.id === id);
    if (module) {
      if (workspace !== ANY_WORKSPACE && module.workspace !== workspace) {
        setWorkspace(ANY_WORKSPACE);
      }
      if (INCIDENTAL_LAYERS.includes(module.layer)) setShowIncidental(true);
      if (module.layer === LAYER.ui) setShowVendored(true);
      // Against the live `search`, not the debounced `query`: a click landing
      // inside the 150 ms window would otherwise be judged against the previous
      // term and leave the box holding one that hides the pick.
      if (!matchesQuery(search.trim().toLowerCase(), module.id)) setSearch("");
    }
    setSelectedId(id);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <Header graph={graph} onRescan={() => void refetch()} isFetching={isFetching} />

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-56 flex-1 flex-col gap-1.5">
          <Label htmlFor="dev-map-search">Find a module</Label>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="dev-map-search"
              type="search"
              value={search}
              placeholder="path or filename"
              onChange={(event) => setSearch(event.target.value)}
              className="pl-8"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="dev-map-workspace">Workspace</Label>
          <Select
            value={workspace}
            onValueChange={(value) =>
              setWorkspace(value as Workspace | typeof ANY_WORKSPACE)
            }
          >
            <SelectTrigger id="dev-map-workspace" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_WORKSPACE}>All workspaces</SelectItem>
              {graph.workspaces.map((entry) => (
                <SelectItem key={entry.workspace} value={entry.workspace}>
                  {WORKSPACE_LABEL[entry.workspace]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1.5">
          <Toggle
            variant="outline"
            pressed={showIncidental}
            onPressedChange={setShowIncidental}
            aria-label="Show tests, fixtures, seeds and config"
          >
            Tests &amp; config
          </Toggle>
          <Toggle
            variant="outline"
            pressed={showVendored}
            onPressedChange={setShowVendored}
            aria-label="Show vendored shadcn/ui components"
          >
            shadcn/ui
          </Toggle>
        </div>

        {/* Two different reaches, so two different sentences — and the counter
            has to move when you type, because it is what people read to confirm
            the search took at all. The workspace and toggle filters still stop at
            Graph and Modules: Overview and Wiring report whole-project totals, and
            a project that shrank because you hid the tests would be worse than
            useless. The search reaches all four. */}
        <p className="ml-auto text-right text-xs text-muted-foreground tabular-nums">
          {query ? (
            <>
              {matching.length} of {visible.length} modules match — the search
              narrows every tab
            </>
          ) : (
            <>
              {visible.length} of {graph.totals.modules} modules in Graph and
              Modules
            </>
          )}
        </p>
      </div>

      <div className="grid min-h-0 grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Tabs defaultValue={TAB.overview} className="min-w-0">
          <TabsList>
            <TabsTrigger value={TAB.overview}>Overview</TabsTrigger>
            <TabsTrigger value={TAB.graph}>Graph</TabsTrigger>
            <TabsTrigger value={TAB.modules}>Modules</TabsTrigger>
            <TabsTrigger value={TAB.wiring}>Wiring</TabsTrigger>
          </TabsList>

          <TabsContent value={TAB.overview} className="mt-3">
            <MapOverview graph={graph} onSelect={select} query={query} />
          </TabsContent>

          <TabsContent value={TAB.graph} className="mt-3 flex flex-col gap-3">
            <Legend layers={usedLayers(visible)} />
            <DependencyGraph
              modules={visible}
              edges={graph.edges}
              selectedId={selectedId}
              onSelect={setSelectedId}
              query={query}
            />
            <p className="text-xs text-muted-foreground">
              Columns are architectural depth, left to right, so every curve means
              "imports". Both apps converge on the two rightmost columns —{" "}
              <code className="font-mono">packages/core</code> and{" "}
              <code className="font-mono">packages/shared</code> — which is the only
              code they share. Hover a node to light its edges and mark their
              direction; click to pin it in the inspector. Dashed is a type-only
              import (erased at runtime); dotted is a lazy{" "}
              <code className="font-mono">import()</code>.
            </p>
          </TabsContent>

          <TabsContent value={TAB.modules} className="mt-3">
            <ModuleTable
              modules={matching}
              selectedId={selectedId}
              onSelect={select}
            />
          </TabsContent>

          <TabsContent value={TAB.wiring} className="mt-3">
            <MapWiring graph={graph} onSelect={select} query={query} />
          </TabsContent>
        </Tabs>

        {/* Sticky rather than in the scroll flow: the inspector is the constant
            while the tab beside it changes, and a 20rem column that scrolled away
            would make walking the graph a lot of scrolling back up. */}
        <Card size="sm" className="xl:sticky xl:top-0 xl:max-h-[calc(100dvh-2rem)]">
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2">
              Inspector
              {selected && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Clear selection"
                  onClick={() => setSelectedId(null)}
                >
                  <X aria-hidden="true" />
                </Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-col">
            {selected ? (
              <ModuleInspector graph={graph} module={selected} onSelect={select} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Pick a module — a node in the graph, a row in the table, a handler
                in the wiring list — to see what it imports, what imports it, and
                what it exposes.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function usedLayers(modules: { layer: Layer }[]): Layer[] {
  const present = new Set(modules.map((m) => m.layer));
  return LAYER_ORDER.filter((layer) => present.has(layer));
}

function Header({
  graph,
  onRescan,
  isFetching,
}: {
  graph: ProjectGraph;
  onRescan: () => void;
  isFetching: boolean;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold">Project map</h1>
        <p className="text-sm text-muted-foreground">
          {graph.totals.modules} modules and {graph.totals.edges} imports, read
          from source {new Date(graph.generatedAt).toLocaleTimeString()} in{" "}
          {graph.scanMs}&nbsp;ms.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="outline">dev only</Badge>
        <Button variant="outline" size="sm" onClick={onRescan} disabled={isFetching}>
          {isFetching ? (
            <Loader2 aria-hidden="true" className="animate-spin" />
          ) : (
            <RefreshCw aria-hidden="true" />
          )}
          Rescan
        </Button>
      </div>
    </div>
  );
}

/**
 * The legend, which is not optional.
 *
 * Eight categorical hues sit at the edge of what is distinguishable under colour
 * vision deficiency, so the name beside each swatch is the primary channel and the
 * colour is the shortcut. Only the layers actually on screen are listed, so the
 * legend shrinks with the filters instead of describing colours that are not there.
 */
function Legend({ layers }: { layers: Layer[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-1.5">
      {layers.map((layer) => (
        <Hint key={layer} content={LAYER_VISUAL[layer].blurb}>
          <li>
            <LayerBadge layer={layer} />
          </li>
        </Hint>
      ))}
    </ul>
  );
}

function MapSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-4" aria-busy="true" aria-label="Scanning the project">
      <Skeleton className="h-10 w-72" />
      <Skeleton className="h-9 w-full" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className={cn("h-24")} />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
