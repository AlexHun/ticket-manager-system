import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The holding screen for a route that can't render yet — either its code is
 * still downloading (the `Suspense` boundaries in `App.tsx` and `AppShell`) or
 * its session check hasn't answered (`ProtectedRoute` / `AdminRoute`).
 *
 * One component for all of them on purpose: they happen back to back on a cold
 * load, and different-looking placeholders would read as separate waits.
 *
 * Deliberately not a skeleton. It stands in for four pages with quite different
 * layouts, so any shape it borrowed from one of them would jump when a
 * different page arrived. Each page still renders its own matching skeleton
 * from its `isPending` branch once its code is here — this only covers the
 * moment before that, which is much shorter.
 *
 * `className` exists for the one caller inside the shell: there the fallback is
 * a flex child of the inset, not a page, so it swaps `min-h-dvh` for
 * `min-h-0 flex-1` and centres in the frame under the top bar instead of
 * pushing past it. tailwind-merge is what lets the caller's height win.
 */
export function RouteFallback({ className }: { className?: string }) {
  return (
    <div
      className={cn("grid min-h-dvh place-items-center", className)}
      aria-busy="true"
    >
      <Loader2
        className="size-6 animate-spin text-muted-foreground"
        aria-label="Loading"
      />
    </div>
  );
}
