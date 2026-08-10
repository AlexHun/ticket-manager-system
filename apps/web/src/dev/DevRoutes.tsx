import { ArrowLeft } from "lucide-react";
import { Link, NavLink, Navigate, Route, Routes } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LogoMark } from "@/components/layout/Logo";
import { cn } from "@/lib/utils";
import { DEV_NAV_ITEMS } from "@/components/layout/nav-items";
import { ProjectMapPage } from "./ProjectMapPage";
import { TestRunnerPage } from "./TestRunnerPage";

/**
 * The dev tools' own shell, and everything under `/__dev`.
 *
 * Deliberately outside `ProtectedRoute` and outside `AppShell`, for one practical
 * reason: the project map reads the filesystem through the Vite dev server and
 * needs neither the API nor Postgres. Nesting it in the app shell would put a
 * session check in front of a page that describes the source tree — so the one
 * time you most want to look at the map, with the API refusing to start, is
 * exactly when you could not reach it.
 *
 * The consequence is that it does not look like the app, which is the honest
 * signal: this is not part of the product. The sidebar still links here (see
 * `DEV_NAV_ITEMS`), so it stays discoverable.
 *
 * Loaded through a single `lazy()` in `App.tsx` that is guarded by
 * `import.meta.env.DEV`, so in a production build the import is dead code and
 * neither this module nor its chunk is emitted.
 */
export function DevRoutes() {
  return (
    // The map's legend and the graph's column headings use shadcn Tooltips, and
    // Radix throws without a provider above them. AppShell has one; this tree is
    // not inside it — and it mirrors that provider's delay settings (see
    // `AppShell` for why `skipDelayDuration` is 0) so dev tools feel like the
    // app.
    <TooltipProvider delayDuration={2000} skipDelayDuration={0}>
      <div className="flex h-dvh flex-col overflow-hidden">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b px-3">
          <Link to="/__dev/map" className="flex items-center gap-2">
            <LogoMark className="size-4 shrink-0" />
            <span className="text-sm font-semibold">Dev tools</span>
          </Link>
          <Separator orientation="vertical" className="h-6 data-vertical:self-center" />
          <nav aria-label="Dev tools" className="flex items-center gap-1">
            {DEV_NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-1.5 rounded-md px-2 py-1 text-sm",
                    "[&_svg]:size-4 [&_svg]:shrink-0",
                    isActive
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )
                }
              >
                <item.icon aria-hidden="true" />
                {item.label}
              </NavLink>
            ))}
          </nav>
          <Button asChild variant="outline" size="sm" className="ml-auto">
            <Link to="/">
              <ArrowLeft aria-hidden="true" />
              Back to app
            </Link>
          </Button>
        </header>

        <Routes>
          {/* Paths are relative to the `/__dev/*` route that mounts this. */}
          <Route index element={<ProjectMapPage />} />
          <Route path="map" element={<ProjectMapPage />} />
          <Route path="tests" element={<TestRunnerPage />} />
          {/* Absolute rather than relative: a relative target inside a splat
              route resolves against the matched splat, not the parent path. */}
          <Route path="*" element={<Navigate to="/__dev/map" replace />} />
        </Routes>
      </div>
    </TooltipProvider>
  );
}
