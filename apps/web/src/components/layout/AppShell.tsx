import { Suspense } from "react";
import { Outlet } from "react-router-dom";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RouteFallback } from "@/components/RouteFallback";
import { AppSidebar } from "./AppSidebar";
import { AppTopBar } from "./AppTopBar";

/**
 * SidebarProvider writes `sidebar_state` on every toggle but only ever *reads*
 * it on the server, which a Vite SPA does not have — so supplying the initial
 * value is ours to do, or the sidebar springs back open on every reload.
 */
function readSidebarDefaultOpen(): boolean {
  if (typeof document === "undefined") return true;
  return !/(?:^|;\s*)sidebar_state=false/.test(document.cookie);
}

/**
 * The app shell: sidebar, top bar, and the frame every authenticated page
 * renders into.
 *
 * The height chain is load-bearing and easy to break. `h-dvh overflow-hidden`
 * here is the only definite height in the app; the inset stretches to it, the
 * top bar refuses to shrink, and each page root takes `min-h-0 flex-1` so it
 * can be shorter than its content and scroll inside the frame rather than
 * growing the window. Pages that own their scrolling (the ticket list, the
 * ticket detail panes) depend on that chain terminating here.
 */
export function AppShell() {
  return (
    // Not optional: the collapsed rail labels its items with shadcn Tooltips,
    // and Radix throws without a provider above them. SidebarProvider is not
    // one.
    <TooltipProvider delayDuration={0}>
      <SidebarProvider
        defaultOpen={readSidebarDefaultOpen()}
        className="h-dvh overflow-hidden"
      >
        <AppSidebar />
        {/* SidebarInset is the app's one <main>, which is why no page renders
            its own. min-w-0 keeps a wide ticket table scrolling inside the flex
            item instead of inflating it. */}
        <SidebarInset className="min-w-0 overflow-hidden">
          <AppTopBar />
          {/* A second boundary, inside the shell. App.tsx's outer one would
              unmount the sidebar and top bar every time a route's chunk was
              fetched for the first time — the whole shell would blink. */}
          <Suspense fallback={<RouteFallback className="min-h-0 flex-1" />}>
            <Outlet />
          </Suspense>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
