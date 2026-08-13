import { Suspense, useEffect, useRef } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RouteFallback } from "@/components/RouteFallback";
import { useDocumentTitle } from "@/lib/use-document-title";
import { AppSidebar } from "./AppSidebar";
import { AppTopBar } from "./AppTopBar";
import { sectionTitle } from "./nav-items";

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
  const { pathname } = useLocation();

  // The section name, for every route. The ticket detail page sets its own
  // title from the subject once it has one and overwrites this — which is the
  // right order rather than a race: until the ticket has loaded, "Tickets" is
  // the honest name for what is on screen.
  useDocumentTitle(sectionTitle(pathname));

  // Where focus goes on a route change, and where the skip link lands.
  //
  // Both are the same problem. Following a nav link left focus on the link, so
  // the next Tab continued through the sidebar rather than entering the page
  // that had just replaced everything on screen — a keyboard user navigated,
  // then had to walk back out of the navigation they had just used. Moving
  // focus to the <main> landmark puts the next Tab at the top of the new page,
  // and gives a screen reader the page's own name to announce.
  //
  // Every navigation *except the first*. On a cold load the browser starts
  // focus at the top of the document, which is where it belongs: the skip link
  // is the first focusable element, and grabbing focus into <main> on mount
  // moves the caret past it — so the one Tab that should offer "Skip to
  // content" lands inside the page instead and the link can only be reached by
  // shift-Tabbing backwards out of it. Arriving already inside the content is
  // also simply correct on a first load; there is nothing to have skipped.
  //
  // Compares against the previous pathname rather than counting renders. A
  // "skip the first run" flag is the obvious way to write this and does not
  // work: StrictMode double-invokes effects on mount in development, so the
  // flag is spent by the first invocation and the second one focuses anyway —
  // which is the behaviour this guard exists to prevent, present only in dev,
  // where it is also the only place you could notice it. Seeding the ref with
  // the current pathname makes mount a no-op however many times it runs.
  const mainRef = useRef<HTMLElement>(null);
  const lastPathname = useRef(pathname);
  useEffect(() => {
    if (lastPathname.current === pathname) return;
    lastPathname.current = pathname;
    mainRef.current?.focus();
  }, [pathname]);

  return (
    // Not optional: the collapsed rail labels its items with shadcn Tooltips,
    // and Radix throws without a provider above them. SidebarProvider is not
    // one.
    //
    // 2s is a deliberate hover delay: tooltips here are a reveal for truncated
    // text, not a primary label, so they should only appear when a pointer has
    // clearly settled.
    //
    // `skipDelayDuration={0}` is what makes that hold for *every* tooltip
    // rather than only the first. Radix keeps one shared "a tooltip was just
    // open" flag per provider and, for `skipDelayDuration` ms after one closes,
    // opens the next trigger with no delay whatsoever. At the 300ms default,
    // dragging the pointer down a list of rows puts each row inside the
    // previous row's window, so they fire one after another — the delay applies
    // once and never again. Zero means each trigger waits out the full 2s on
    // its own.
    <TooltipProvider delayDuration={2000} skipDelayDuration={0}>
      <SidebarProvider
        defaultOpen={readSidebarDefaultOpen()}
        className="h-dvh overflow-hidden"
      >
        {/* First focusable thing in the document, so one Tab from a cold load
            offers it. Hidden until focused — `sr-only` alone would leave it
            invisible to the sighted keyboard user it is for. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:ring-2 focus:ring-ring"
        >
          Skip to content
        </a>

        {/* The sidebar gets its own, much shorter delay.

            The 2s above is right for what it was written for: a tooltip that
            reveals text a cell has truncated, where firing early turns every
            pass of the mouse into a popup. It is wrong here, and inverted —
            shadcn renders these only when the sidebar is collapsed
            (`hidden={state !== "collapsed"}` in SidebarMenuButton), so on the
            icon rail the tooltip is not a reveal, it is the only label the
            control has. Making someone rest on an icon for two seconds to learn
            what it is is not a delay, it is a hidden name — and now that the
            rail carries four saved views, two of them person-shaped icons, it
            is the difference between "Unassigned" and "Mine". */}
        <TooltipProvider delayDuration={300} skipDelayDuration={0}>
          <AppSidebar />
        </TooltipProvider>

        {/* SidebarInset is the app's one <main>, which is why no page renders
            its own. min-w-0 keeps a wide ticket table scrolling inside the flex
            item instead of inflating it.

            `tabIndex={-1}` makes it a focus target without putting it in the tab
            order — it is what both the skip link and the route-change effect
            move focus to. No focus ring: the focus arrives programmatically at a
            whole region, and outlining the entire page would read as an error. */}
        <SidebarInset
          ref={mainRef}
          id="main-content"
          tabIndex={-1}
          className="min-w-0 overflow-hidden outline-none"
        >
          <AppTopBar />
          {/* A second boundary, inside the shell. App.tsx's outer one would
              unmount the sidebar and top bar every time a route's chunk was
              fetched for the first time — the whole shell would blink. */}
          {/* Page transition, for every routed page at once.
           *
           * `key={pathname}` is what makes it a transition rather than a
           * one-time mount effect: changing the key remounts this wrapper on
           * every navigation, which restarts the animation. Without it the fade
           * would play once, on first load, and never again.
           *
           * It sits *inside* Suspense so a lazily-loaded route animates when its
           * content arrives rather than when its fallback does — otherwise the
           * fade plays on the spinner and the real page snaps in behind it.
           *
           * The wrapper repeats `flex min-h-0 flex-1 flex-col` rather than using
           * `display: contents`, which was the first attempt and does not work:
           * a `contents` box is not generated at all, so animations and
           * transforms simply do not apply to it. Since a real box is
           * unavoidable, it has to reproduce what SidebarInset's flex column
           * gave the page root — otherwise the height chain described above
           * terminates here instead of at the page, and every internally
           * scrolling page (the ticket list, the ticket detail panes) grows the
           * window instead of scrolling. */}
          <Suspense fallback={<RouteFallback className="min-h-0 flex-1" />}>
            <div
              key={pathname}
              className="flex min-h-0 flex-1 flex-col animate-page-in"
            >
              <Outlet />
            </div>
          </Suspense>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
