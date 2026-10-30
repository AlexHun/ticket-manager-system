import { useEffect, useRef } from "react";
import { ArrowLeft } from "lucide-react";
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LogoMark } from "@/components/layout/Logo";
import { cn } from "@/lib/utils";
import { ROUTE } from "@/lib/routes";
import { DEV_NAV_ITEMS } from "@/components/layout/nav-items";
import { ProjectMapPage } from "./ProjectMapPage";
import { TestRunnerPage } from "./TestRunnerPage";
import { SessionsPage } from "./SessionsPage";
import { UsagePage } from "./UsagePage";

/** `"/__dev/"` — `ROUTE.dev.path` is the splat `"/__dev/*"`, less its `*`. */
const DEV_PREFIX = ROUTE.dev.path.replace(/\*$/, "");

/**
 * A dev route's own segment, taken off the path the record declares.
 *
 * The children of a splat route are matched relative to it, so React Router
 * wants `"map"` where `ROUTE.devMap.path` says `"/__dev/map"`. Deriving the
 * segment rather than retyping it is what keeps `routes.ts` the single
 * declaration these paths have (#151): renaming one there moves the nav item
 * and the route together, instead of leaving a link pointing at the catch-all.
 */
const segment = (route: { readonly path: string }): string =>
  route.path.slice(DEV_PREFIX.length);

/** Scroll a tab fully into the header's row, moving nothing vertically. */
const scrollIntoRow = (tab: Element): void =>
  tab.scrollIntoView({ block: "nearest", inline: "nearest" });

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
  const navRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  // Bring the current tab into the row's view on every page change: at phone
  // width the row opens scrolled to its start, where Sessions is out of sight.
  // Observed rather than scrolled once, because the first scroll lands before
  // Geist has loaded, and the swap widens the tabs and pushed Sessions 6px
  // back out of the row. The observer reports once on `observe` and again on
  // each change of the tab's size.
  useEffect(() => {
    const current = navRef.current?.querySelector('[aria-current="page"]');
    if (!current) return;
    const observer = new ResizeObserver(() => scrollIntoRow(current));
    observer.observe(current);
    return () => observer.disconnect();
  }, [pathname]);

  return (
    // The map's legend and the graph's column headings use shadcn Tooltips, and
    // Radix throws without a provider above them. AppShell has one; this tree is
    // not inside it — and it mirrors that provider's delay settings (see
    // `AppShell` for why `skipDelayDuration` is 0) so dev tools feel like the
    // app.
    <TooltipProvider delayDuration={2000} skipDelayDuration={0}>
      <div className="flex h-dvh flex-col overflow-hidden">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b px-3">
          <Link
            to={ROUTE.devMap.path}
            className="flex shrink-0 items-center gap-2"
          >
            <LogoMark className="size-4 shrink-0" />
            <span className="text-sm font-semibold whitespace-nowrap">
              Dev tools
            </span>
          </Link>
          <Separator
            orientation="vertical"
            className="h-6 data-vertical:self-center"
          />
          {/* At phone width the four tabs are wider than the room left, so the
              row scrolls rather than squeezing them (#617). Each tab is a link,
              so Tab reaches every one without the row being a tab stop of its
              own. Whichever takes focus is scrolled fully into view, since
              Chrome's own focus scroll leaves a half-clipped tab where it is,
              and the current one is scrolled to on arrival. */}
          <nav
            ref={navRef}
            aria-label="Dev tools"
            className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
            onFocus={(event) => scrollIntoRow(event.target)}
          >
            {DEV_NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    "flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-sm whitespace-nowrap",
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
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <Link to={ROUTE.dashboard.path}>
              <ArrowLeft aria-hidden="true" />
              {/* Icon-only below `sm`, still named, to leave the tabs room. */}
              <span className="sr-only sm:not-sr-only">Back to app</span>
            </Link>
          </Button>
        </header>

        <Routes>
          {/* Paths are relative to the `/__dev/*` route that mounts this. */}
          <Route index element={<ProjectMapPage />} />
          <Route path={segment(ROUTE.devMap)} element={<ProjectMapPage />} />
          <Route path={segment(ROUTE.devTests)} element={<TestRunnerPage />} />
          <Route path={segment(ROUTE.devUsage)} element={<UsagePage />} />
          <Route path={segment(ROUTE.devSessions)} element={<SessionsPage />} />
          {/* Absolute rather than relative: a relative target inside a splat
              route resolves against the matched splat, not the parent path. */}
          <Route
            path="*"
            element={<Navigate to={ROUTE.devMap.path} replace />}
          />
        </Routes>
      </div>
    </TooltipProvider>
  );
}
