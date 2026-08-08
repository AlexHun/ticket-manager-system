import { CornerDownRight, KeyRound, ShieldCheck, Webhook } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { GUARD, type Guard, type ProjectGraph } from "./protocol";

/**
 * How the two apps are joined: URL to page, URL to handler, and which client
 * module calls which endpoint.
 *
 * This is the part the import graph cannot show. `apps/web` and `apps/api` share
 * no code except the types in `packages/shared`, so nothing in the module graph
 * records that `TicketsPage` talks to `GET /api/tickets` — that edge exists only
 * as a string in an axios call and a string in an Express route. Both sides are
 * read out of source and matched by path shape, which is why the "called by"
 * column is evidence rather than documentation: nobody maintains it.
 */

interface MapWiringProps {
  graph: ProjectGraph;
  onSelect: (id: string) => void;
}

const GUARD_VISUAL: Record<Guard, { label: string; icon: ReactNode; className: string }> = {
  [GUARD.admin]: {
    label: "admin only",
    icon: <ShieldCheck />,
    // Status colours, and status colours only, carry state here — and each one
    // ships with a word, never the colour alone.
    className: "text-status-good",
  },
  [GUARD.auth]: {
    label: "signed in",
    icon: <KeyRound />,
    className: "text-muted-foreground",
  },
  [GUARD.webhook]: {
    label: "shared secret",
    icon: <Webhook />,
    className: "text-status-warning",
  },
  [GUARD.none]: {
    label: "open",
    icon: <span aria-hidden="true">·</span>,
    className: "text-muted-foreground",
  },
};

export function MapWiring({ graph, onSelect }: MapWiringProps) {
  return (
    <div className="flex flex-col gap-4">
      <Card size="sm">
        <CardHeader>
          <CardTitle>Client routes ({graph.routes.length})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border">
                  <Th>Path</Th>
                  <Th>Element</Th>
                  <Th>Behind</Th>
                  <Th>Chunk</Th>
                </tr>
              </thead>
              <tbody>
                {graph.routes.map((route) => (
                  <tr key={`${route.path}|${route.component}`} className="border-b border-border/50 last:border-0">
                    <td className="py-1.5 pr-3 font-mono text-xs whitespace-nowrap">
                      {route.path}
                      {route.redirectTo && (
                        <span className="ml-1.5 text-muted-foreground">
                          → {route.redirectTo}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3">
                      {route.file ? (
                        <ModuleLink id={route.file} label={route.component} onSelect={onSelect} />
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {route.component} — from the router
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3">
                      {route.guards.length === 0 ? (
                        <span className="text-xs text-muted-foreground">public</span>
                      ) : (
                        <span className="flex flex-wrap items-center gap-1">
                          {route.guards.map((guard) => (
                            <Badge key={guard} variant="secondary" className="font-normal">
                              {guard}
                            </Badge>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 text-xs text-muted-foreground whitespace-nowrap">
                      {route.lazy ? "own chunk" : "entry"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            "Behind" is the nesting in <code className="font-mono">App.tsx</code>,
            outermost first — read out of the JSX rather than assumed, so it is the
            gate the router actually applies. It is UX, not security: the check
            that matters is the middleware on the endpoint below.
          </p>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>API endpoints ({graph.endpoints.length})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border">
                  <Th>Method</Th>
                  <Th>Path</Th>
                  <Th>Guard</Th>
                  <Th>Handler</Th>
                  <Th>Called by</Th>
                </tr>
              </thead>
              <tbody>
                {graph.endpoints.map((endpoint) => {
                  const guard = GUARD_VISUAL[endpoint.guard];
                  return (
                    <tr
                      key={`${endpoint.method} ${endpoint.path}`}
                      className="border-b border-border/50 last:border-0 align-top"
                    >
                      <td className="py-1.5 pr-3 font-mono text-xs text-muted-foreground whitespace-nowrap">
                        {endpoint.method}
                      </td>
                      <td className="py-1.5 pr-3 font-mono text-xs whitespace-nowrap">
                        {endpoint.path}
                      </td>
                      <td className="py-1.5 pr-3">
                        <span
                          className={cn(
                            "flex items-center gap-1 text-xs whitespace-nowrap",
                            "[&_svg]:size-3.5 [&_svg]:shrink-0",
                            guard.className,
                          )}
                        >
                          {guard.icon}
                          {guard.label}
                        </span>
                      </td>
                      <td className="py-1.5 pr-3">
                        <ModuleLink
                          id={endpoint.file}
                          label={endpoint.file.replace("apps/api/src/", "")}
                          onSelect={onSelect}
                        />
                      </td>
                      <td className="py-1.5">
                        {endpoint.callers.length === 0 ? (
                          <span className="text-xs text-muted-foreground">
                            not from the SPA
                          </span>
                        ) : (
                          <div className="flex flex-col">
                            {endpoint.callers.map((caller) => (
                              <ModuleLink
                                key={caller}
                                id={caller}
                                label={caller.replace("apps/web/src/", "")}
                                onSelect={onSelect}
                                icon={<CornerDownRight />}
                              />
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Guards are read from the middleware in the route registration.
            "Not from the SPA" means no{" "}
            <code className="font-mono">api.*</code> call in{" "}
            <code className="font-mono">apps/web</code> matches this path — true of
            health, the Better Auth handler and the inbound-email webhook, all of
            which are reached from somewhere else.
          </p>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Data model ({graph.models.length} models)</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {graph.models.map((model) => (
            <div key={model.name} className="rounded-lg ring-1 ring-border">
              <div className="flex items-baseline justify-between gap-2 border-b border-border px-3 py-2">
                <p className="font-medium">{model.name}</p>
                {model.table && (
                  <code className="font-mono text-xs text-muted-foreground">
                    {model.table}
                  </code>
                )}
              </div>
              <ul className="flex flex-col px-3 py-2">
                {model.fields.map((field) => (
                  <li
                    key={field.name}
                    className="flex items-baseline justify-between gap-3 py-0.5 text-xs"
                  >
                    <span className="truncate font-mono">{field.name}</span>
                    <span
                      className={cn(
                        "shrink-0 font-mono",
                        field.relationTo ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {field.relationTo && "→ "}
                      {field.type}
                      {field.list && "[]"}
                      {field.optional && "?"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Th({ children }: { children: ReactNode }) {
  return (
    <th scope="col" className="py-1.5 pr-3 text-left text-xs font-medium last:pr-0">
      {children}
    </th>
  );
}

function ModuleLink({
  id,
  label,
  onSelect,
  icon,
}: {
  id: string;
  label: string;
  onSelect: (id: string) => void;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      title={id}
      className={cn(
        "flex cursor-pointer items-center gap-1 rounded text-left font-mono text-xs",
        "hover:underline focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
        "[&_svg]:size-3 [&_svg]:shrink-0 [&_svg]:text-muted-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
