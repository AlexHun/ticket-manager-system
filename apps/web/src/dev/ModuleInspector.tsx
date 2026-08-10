import type { ReactNode } from "react";
import { FileCode2, FlaskConical, TriangleAlert } from "lucide-react";
import { Hint } from "@/components/Hint";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { LayerBadge } from "./LayerBadge";
import { LAYER_VISUAL, WORKSPACE_LABEL } from "./layer-visuals";
import { EDGE_KIND, type ModuleNode, type ProjectGraph } from "./protocol";

/**
 * Everything the graph knows about one module.
 *
 * The neighbour lists are buttons rather than text, which is what turns the panel
 * into a way of walking the graph: pick a page, follow it to a hook, follow that
 * to the contract it reads its types from. Nothing else on the page offers a path
 * *through* the dependencies — the graph shows them and the table lists them.
 */

interface ModuleInspectorProps {
  graph: ProjectGraph;
  module: ModuleNode;
  onSelect: (id: string) => void;
}

export function ModuleInspector({ graph, module, onSelect }: ModuleInspectorProps) {
  // Kind is looked up per edge because a pair can be joined by more than one:
  // a module can import runtime values and types from the same neighbour.
  const kindsTo = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.from !== module.id) continue;
    const kinds = kindsTo.get(edge.to) ?? [];
    kinds.push(edge.kind);
    kindsTo.set(edge.to, kinds);
  }

  const defines = graph.endpoints.filter((e) => e.file === module.id);
  const calls = graph.endpoints.filter((e) => e.callers.includes(module.id));
  const servesRoutes = graph.routes.filter((r) => r.file === module.id);
  const covers = graph.modules.find((m) => m.testFile === module.id);

  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
      <div className="flex flex-col gap-2">
        <div className="flex items-start gap-2">
          <FileCode2
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0"
            style={{ color: LAYER_VISUAL[module.layer].color }}
          />
          <div className="min-w-0">
            <p className="truncate font-medium">{module.name}</p>
            <p className="truncate font-mono text-xs text-muted-foreground">
              {module.dir}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <LayerBadge layer={module.layer} />
          <Badge variant="secondary" className="font-mono font-normal">
            {WORKSPACE_LABEL[module.workspace] ?? module.workspace}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {LAYER_VISUAL[module.layer].blurb}
        </p>
      </div>

      <Separator />

      <dl className="grid grid-cols-3 gap-2 text-center">
        <Metric label="code" value={module.code} />
        <Metric label="comments" value={module.comments} />
        <Metric label="exports" value={module.exports.length} />
      </dl>

      <Separator />

      {module.testFile ? (
        <Field label="Covered by">
          <IdButton id={module.testFile} onSelect={onSelect} icon={<FlaskConical />} />
        </Field>
      ) : covers ? (
        <Field label="Covers">
          <IdButton id={covers.id} onSelect={onSelect} />
        </Field>
      ) : (
        !module.isTest && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <TriangleAlert aria-hidden="true" className="size-3.5" />
            No test file beside it.
          </p>
        )
      )}

      {servesRoutes.length > 0 && (
        <Field label={`Serves ${servesRoutes.length === 1 ? "route" : "routes"}`}>
          <div className="flex flex-wrap gap-1">
            {servesRoutes.map((route) => (
              <Badge key={route.path} variant="secondary" className="font-mono font-normal">
                {route.path}
              </Badge>
            ))}
          </div>
        </Field>
      )}

      {defines.length > 0 && (
        <Field label="Defines endpoints">
          <ul className="flex flex-col gap-1">
            {defines.map((endpoint) => (
              <li key={`${endpoint.method} ${endpoint.path}`} className="font-mono text-xs">
                <span className="text-muted-foreground">{endpoint.method}</span>{" "}
                {endpoint.path}
              </li>
            ))}
          </ul>
        </Field>
      )}

      {calls.length > 0 && (
        <Field label="Calls endpoints">
          <ul className="flex flex-col gap-1">
            {calls.map((endpoint) => (
              <li key={`${endpoint.method} ${endpoint.path}`} className="font-mono text-xs">
                <span className="text-muted-foreground">{endpoint.method}</span>{" "}
                {endpoint.path}
              </li>
            ))}
          </ul>
        </Field>
      )}

      <Field label={`Imports (${module.imports.length})`} empty="Imports nothing internal.">
        {module.imports.map((id) => (
          <IdButton
            key={id}
            id={id}
            onSelect={onSelect}
            note={
              // A pair joined only by `type` edges disappears at runtime. Worth
              // saying, because it is the difference between a real dependency
              // and a shape agreement.
              (kindsTo.get(id) ?? []).every((k) => k === EDGE_KIND.type)
                ? "type only"
                : (kindsTo.get(id) ?? []).includes(EDGE_KIND.dynamic)
                  ? "lazy"
                  : undefined
            }
          />
        ))}
      </Field>

      <Field
        label={`Imported by (${module.importedBy.length})`}
        empty={module.isTest ? "Nothing imports a test." : "Nothing imports this."}
      >
        {module.importedBy.map((id) => (
          <IdButton key={id} id={id} onSelect={onSelect} />
        ))}
      </Field>

      {module.externals.length > 0 && (
        <Field label={`Packages (${module.externals.length})`}>
          <div className="flex flex-wrap gap-1">
            {module.externals.map((name) => (
              <Badge key={name} variant="outline" className="font-mono font-normal">
                {name}
              </Badge>
            ))}
          </div>
        </Field>
      )}

      {module.unresolved.length > 0 && (
        <Field label="Not modules">
          <div className="flex flex-wrap gap-1">
            {module.unresolved.map((spec) => (
              <Badge key={spec} variant="outline" className="font-mono font-normal">
                {spec}
              </Badge>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Real imports the graph holds no node for — a stylesheet, or generated
            code the scan skips.
          </p>
        </Field>
      )}

      {module.exports.length > 0 && (
        <Field label="Exports">
          <div className="flex flex-wrap gap-1">
            {module.exports.map((name) => (
              <code
                key={name}
                className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs"
              >
                {name}
              </code>
            ))}
          </div>
        </Field>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-muted/50 py-1.5">
      <dt className="text-[10px] tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function Field({
  label,
  children,
  empty,
}: {
  label: string;
  children: ReactNode;
  /** Shown instead of the children when there are none. */
  empty?: string;
}) {
  const isEmpty = Array.isArray(children) && children.length === 0;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      {isEmpty ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <div className="flex flex-col gap-1">{children}</div>
      )}
    </div>
  );
}

/**
 * One neighbour, as a button.
 *
 * The path is shown split — directory in muted ink, filename in foreground —
 * because a column of full repo-relative paths is unreadable when the first
 * twenty characters are always the same. Only the directory truncates: a single
 * truncating string would eat the filename, which is the part being read.
 */
function IdButton({
  id,
  onSelect,
  note,
  icon,
}: {
  id: string;
  onSelect: (id: string) => void;
  note?: string;
  icon?: ReactNode;
}) {
  const cut = id.lastIndexOf("/");
  return (
    <Hint content={id} className="font-mono">
      <button
        type="button"
        onClick={() => onSelect(id)}
        className={cn(
          "flex w-full cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs",
          "hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
          "[&_svg]:size-3 [&_svg]:shrink-0 [&_svg]:text-muted-foreground",
        )}
      >
        {icon}
        <span className="flex min-w-0 items-baseline font-mono">
          <span className="truncate text-muted-foreground">{id.slice(0, cut + 1)}</span>
          <span className="shrink-0">{id.slice(cut + 1)}</span>
        </span>
        {note && (
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
            {note}
          </span>
        )}
      </button>
    </Hint>
  );
}
