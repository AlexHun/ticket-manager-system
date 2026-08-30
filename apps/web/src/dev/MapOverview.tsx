import type { ReactNode } from "react";
import { AlertTriangle, PackageOpen, RotateCcw, Unplug } from "lucide-react";
import { Hint } from "@/components/Hint";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { StatTile } from "@/components/dashboard/StatTile";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { LayerBadge } from "./LayerBadge";
import { LAYER_VISUAL, WORKSPACE_LABEL } from "./layer-visuals";
import { countLabel, matchesQuery } from "./module-match";
import type { ProjectGraph } from "./protocol";

/**
 * The numbers, the shape, and the things that look wrong.
 *
 * `StatTile` is the dashboard's own tile, reused rather than reimplemented — the
 * count-up, the accessible-name handling and the hover lift are all already
 * solved there, and a second tile that looked almost the same would be the worse
 * outcome. It is the one place this dev page reaches into app code, and it shows
 * up as an edge from `Dev tools` to `Component` in the graph.
 *
 * The search narrows the *lists* here and never the *totals*, which is a line
 * worth holding: the tiles, the coverage ratio and the workspace bars answer
 * "how big is this project", and a project that got smaller because you typed
 * into a box would be a worse answer than no answer. Every list that names
 * modules does narrow — that is where a search is actually useful.
 */

interface MapOverviewProps {
  graph: ProjectGraph;
  onSelect: (id: string) => void;
  /** Trimmed, lowercased search term; empty means "not searching". */
  query: string;
}

export function MapOverview({ graph, onSelect, query }: MapOverviewProps) {
  const { totals } = graph;
  const covered =
    totals.testableModules === 0 ? 0 : totals.testedModules / totals.testableModules;

  // `testable` comes from the scan rather than being re-derived here, so this
  // list can never disagree with the ratio above it.
  const untested = graph.modules
    .filter((m) => m.testable && !m.testFile)
    .sort((a, b) => b.importedBy.length - a.importedBy.length);
  const untestedHits = untested.filter((m) => matchesQuery(query, m.id));

  // A package is a hit on its own name *or* on any module that imports it, so
  // typing a filename answers "what does this file pull in" as well as the more
  // obvious "who uses axios".
  const externals = graph.externals.filter((dep) =>
    matchesQuery(query, dep.name, ...dep.users),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Modules" value={totals.modules} sub="TypeScript files scanned" />
        <StatTile label="Lines of code" value={totals.code} sub="blank and comment lines excluded" />
        <StatTile
          label="Lines of comment"
          value={totals.comments}
          sub={`${formatPercent(totals.comments / Math.max(1, totals.code))} of the code`}
        />
        <StatTile label="Import edges" value={totals.edges} sub="module → module" />
        <StatTile label="API endpoints" value={totals.endpoints} sub={`${totals.routes} client routes`} />
        <StatTile label="Test files" value={totals.testFiles} sub="component specs + E2E" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card size="sm">
          <CardHeader>
            <CardTitle>Modules with a test beside them</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl leading-none font-semibold">
                {totals.testedModules}
              </span>
              <span className="text-sm text-muted-foreground">
                of {totals.testableModules} ({formatPercent(covered)})
              </span>
            </div>
            <Progress
              value={covered * 100}
              aria-label={`${totals.testedModules} of ${totals.testableModules} modules have a test`}
            />
            <p className="text-xs text-muted-foreground">
              Counted over this project's own modules — pages, components, libs,
              routes, schemas. shadcn's vendored primitives, fixtures, seeds and
              config are excluded, so this is not diluted by files a unit test
              would never cover.
            </p>
            {untested.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                  Most-depended-on without one
                </p>
                {/* The cap stays at 6 *after* the search rather than before it:
                    slicing first would hand the filter six rows and usually find
                    nothing in them, which reads as "no such module" when the
                    module is simply seventh. */}
                {untestedHits.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    None of these match the search.
                  </p>
                )}
                <ul className="flex flex-col">
                  {untestedHits.slice(0, 6).map((module) => (
                    <li key={module.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(module.id)}
                        className="flex w-full cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        <span className="truncate font-mono">{module.id}</span>
                        <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                          {module.importedBy.length} importers
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle>Workspaces</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {graph.workspaces.map((workspace) => (
              <div key={workspace.workspace} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <code className="font-mono">{WORKSPACE_LABEL[workspace.workspace]}</code>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {workspace.modules} modules · {workspace.code} lines
                  </span>
                </div>
                {/* Segments are separated by a 2px surface gap rather than
                    butting together, so adjacent hues read as two marks. */}
                <div className="flex h-2 gap-0.5 overflow-hidden">
                  {workspace.layers.map((entry) => (
                    <Hint
                      key={entry.layer}
                      content={`${LAYER_VISUAL[entry.layer].label}: ${entry.count}`}
                    >
                      <div
                        style={{
                          backgroundColor: LAYER_VISUAL[entry.layer].color,
                          flexGrow: entry.count,
                        }}
                        className="rounded-sm"
                      />
                    </Hint>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1">
                  {workspace.layers.map((entry) => (
                    <LayerBadge
                      key={entry.layer}
                      layer={entry.layer}
                      className="text-[10px]"
                    />
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Findings graph={graph} onSelect={onSelect} query={query} />

      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PackageOpen aria-hidden="true" className="size-4 text-muted-foreground" />
            External packages ({countLabel(externals.length, graph.externals.length)})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {externals.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No package matches the search, by its own name or by an importer.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {externals.map((dep) => (
                <li key={dep.name}>
                  <Badge variant="outline" className="font-mono font-normal">
                    {dep.name}
                    <span className="text-foreground/70 tabular-nums">{dep.users.length}</span>
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            The number is how many modules import it, and it counts every importer
            rather than only the matching ones — it says how load-bearing the
            package is, which does not change because you searched. Counted from
            source, so a transitive dependency nothing imports directly does not
            appear.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * What the scan found that is worth a second look.
 *
 * Each finding says plainly what it does *not* mean. An unused shadcn component
 * is not a bug, and a cycle drawn through type-only imports is not a cycle at
 * all — a panel that flagged either as a problem would train you to ignore it.
 */
function Findings({
  graph,
  onSelect,
  query,
}: {
  graph: ProjectGraph;
  onSelect: (id: string) => void;
  query: string;
}) {
  const hasNothing =
    graph.cycles.length === 0 && graph.orphans.length === 0 && graph.warnings.length === 0;

  // A ring is a hit if any module on it is: you search for the file you suspect,
  // and the cycle it sits in comes back whole rather than clipped to the one
  // name you typed — a partial ring would not be a cycle.
  const cycles = graph.cycles.filter((ring) => matchesQuery(query, ...ring));
  const orphans = graph.orphans.filter((id) => matchesQuery(query, id));
  const searching = query.length > 0;

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Findings</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {hasNothing && (
          <p className="text-sm text-muted-foreground">
            No import cycles, no unimported modules, nothing the scan could not
            parse.
          </p>
        )}

        <Finding
          icon={<RotateCcw />}
          title={`Import cycles (${countLabel(cycles.length, graph.cycles.length)})`}
          note="Type-only edges are excluded: verbatimModuleSyntax erases them, so a ring closed by one does not exist at runtime."
          empty={cycles.length === 0}
          emptyText={
            searching && graph.cycles.length > 0
              ? "No cycle runs through a module matching the search."
              : "None."
          }
        >
          <ul className="flex flex-col gap-1">
            {cycles.map((ring) => (
              <li key={ring.join(">")} className="font-mono text-xs">
                {ring.join(" → ")} → {ring[0]}
              </li>
            ))}
          </ul>
        </Finding>

        <Finding
          icon={<Unplug />}
          title={`Nothing imports these (${countLabel(orphans.length, graph.orphans.length)})`}
          note="Entries, tests, fixtures, seeds and config are excluded — nothing is supposed to import those. What is left is usually a shadcn component added and not yet used."
          empty={orphans.length === 0}
          emptyText={
            searching && graph.orphans.length > 0
              ? "No unimported module matches the search."
              : "Every module has at least one importer."
          }
        >
          <ul className="flex flex-wrap gap-1">
            {orphans.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => onSelect(id)}
                  className="cursor-pointer rounded bg-muted px-1.5 py-0.5 font-mono text-xs hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {id}
                </button>
              </li>
            ))}
          </ul>
        </Finding>

        {/* Deliberately not filtered by the search. A warning says the map you
            are reading is incomplete, so it has to outrank whatever you happened
            to type — a search that could hide one would let you conclude a module
            has no importers when the truth is the scan failed to read it. */}
        {graph.warnings.length > 0 && (
          <Finding
            icon={<AlertTriangle />}
            title={`Scan warnings (${graph.warnings.length})`}
            note="Things the extractor could not make sense of. Reported rather than dropped, because a silently missing edge is worse than a visible gap — and shown whatever the search says, for the same reason."
            empty={false}
            emptyText=""
          >
            <ul className="flex flex-col gap-1 text-xs">
              {graph.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </Finding>
        )}
      </CardContent>
    </Card>
  );
}

function Finding({
  icon,
  title,
  note,
  empty,
  emptyText,
  children,
}: {
  icon: ReactNode;
  title: string;
  note: string;
  empty: boolean;
  emptyText: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p
        className={cn(
          "flex items-center gap-2 text-sm font-medium",
          "[&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-muted-foreground",
        )}
      >
        {icon}
        {title}
      </p>
      {empty ? (
        <p className="text-xs text-muted-foreground">{emptyText}</p>
      ) : (
        children
      )}
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  );
}
